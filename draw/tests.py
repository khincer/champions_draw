import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from django.contrib.auth.models import User
from django.core.management import call_command
from django.core.management.base import CommandError
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APITestCase

from .models import Association, DrawMethodChoices, DrawStatusChoices, InteractiveDrawPick, KnockoutPrediction, League, LeagueMatch, LeagueMatchPrediction, LeagueStanding, MatchPrediction, PlayoffPrediction, Prediction, QualifiedViaChoices, RealFixturePrediction, RealFixtureResult, Season, SeasonDraw, SeasonMatchup, SeasonMatchupHistory, SeasonTeam, Team
from .serializers import CompactSeasonTeamSerializer
from .services.draw import DrawError, compute_forbidden_directions, generate_season_draw, previous_season_names
from .services.import_seed_input import import_seed_input_payload
from .services.interactive_draw import assign_opponents_for_pick, current_pot, finalize, pick_team, start_or_resume
from .services.seeding import seed_season_entries


class DrawApiTests(APITestCase):
	def setUp(self):
		self.season = Season.objects.create(name='2024-25', is_active=True)
		self.entries = []

		for index in range(36):
			association = Association.objects.create(
				name=f'Association {index + 1}',
				code=f'{index + 1:03}',
			)
			team = Team.objects.create(
				name=f'Team {index + 1}',
				short_name=f'T{index + 1}',
				association=association,
			)
			entry = SeasonTeam.objects.create(
				season=self.season,
				team=team,
				uefa_club_coefficient=Decimal('120.000') - Decimal(index),
				qualified_via=QualifiedViaChoices.LEAGUE_POSITION,
				is_title_holder=False,
			)
			self.entries.append(entry)

		self.title_holder = self.entries[-1]
		self.title_holder.is_title_holder = True
		self.title_holder.qualified_via = QualifiedViaChoices.TITLE_HOLDER
		self.title_holder.uefa_club_coefficient = Decimal('15.000')
		self.title_holder.save(update_fields=['is_title_holder', 'qualified_via', 'uefa_club_coefficient'])

	def test_seeding_places_title_holder_first_and_builds_four_pots(self):
		summary = seed_season_entries(self.season)

		seeded_entries = list(SeasonTeam.objects.filter(season=self.season).order_by('seeding_position'))

		self.assertEqual(summary.total_teams, 36)
		self.assertEqual(summary.pot_sizes, {1: 9, 2: 9, 3: 9, 4: 9})
		self.assertEqual(seeded_entries[0].pk, self.title_holder.pk)
		self.assertEqual(seeded_entries[0].pot, 1)
		self.assertEqual(seeded_entries[0].seeding_position, 1)
		self.assertEqual(seeded_entries[-1].pot, 4)
		self.assertEqual(seeded_entries[-1].seeding_position, 36)

	def test_seed_endpoint_assigns_pots_and_returns_payload(self):
		User.objects.create_user(username='operator', password='password')
		self.client.login(username='operator', password='password')

		response = self.client.post(reverse('draw:season-seed', args=[self.season.pk]))

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.data['summary']['pot_sizes'], {1: 9, 2: 9, 3: 9, 4: 9})
		self.assertEqual(len(response.data['teams']), 36)

		self.title_holder.refresh_from_db()
		self.assertEqual(self.title_holder.seeding_position, 1)
		self.assertEqual(self.title_holder.pot, 1)

	def test_team_list_uses_active_season_by_default(self):
		seed_season_entries(self.season)

		response = self.client.get(reverse('draw:team-list'))

		self.assertEqual(response.status_code, 200)
		self.assertEqual(len(response.data), 36)
		self.assertEqual(response.data[0]['team']['name'], self.title_holder.team.name)

	def test_team_overview_returns_season_summary_and_teams(self):
		seed_season_entries(self.season)

		response = self.client.get(reverse('draw:team-overview'))

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.data['season']['name'], '2024-25')
		self.assertEqual(response.data['summary']['team_count'], 36)
		self.assertEqual(response.data['summary']['seeded_team_count'], 36)
		self.assertEqual(response.data['summary']['pot_sizes'], {1: 9, 2: 9, 3: 9, 4: 9})
		self.assertEqual(len(response.data['teams']), 36)
		self.assertEqual(response.data['teams'][0]['team']['name'], self.title_holder.team.name)

	def test_public_ui_route_serves_preact_app(self):
		response = self.client.get('/')

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response['Content-Type'], 'text/html')

	def test_console_ui_route_redirects_to_public_app(self):
		response = self.client.get('/console/')

		self.assertEqual(response.status_code, 302)
		self.assertEqual(response['Location'], '/')

	def test_admin_route_is_not_exposed(self):
		response = self.client.get('/admin/')

		self.assertEqual(response.status_code, 404)

	def test_generate_draw_creates_valid_league_phase_matchups(self):
		seed_season_entries(self.season)

		summary = generate_season_draw(self.season, draw_seed='unit-test-draw', player_name='Ada')
		draw_record = SeasonDraw.objects.get(pk=summary.draw_id)

		self.assertEqual(summary.status, DrawStatusChoices.COMPLETED)
		self.assertEqual(summary.player_name, 'Ada')
		self.assertEqual(summary.total_matchups, 144)
		self.assertEqual(draw_record.status, DrawStatusChoices.COMPLETED)
		self.assertEqual(draw_record.draw_seed, 'unit-test-draw')
		self.assertEqual(draw_record.player_name, 'Ada')
		self.assertEqual(draw_record.matchups_created, 144)
		self.assertIsNotNone(draw_record.completed_at)
		self.assertEqual(SeasonMatchup.objects.filter(season=self.season).count(), 144)
		self.assert_draw_constraints(self.season)

	def test_generate_draw_for_checked_in_2025_seed_input(self):
		seed_input_path = Path(__file__).resolve().parent / 'data' / 'ucl_league_phase_seed_input_2025_26.json'
		payload = json.loads(seed_input_path.read_text(encoding='utf-8'))
		summary = import_seed_input_payload(payload, set_active=True)
		season = Season.objects.get(pk=summary.season_id)
		seed_season_entries(season)

		draw_summary = generate_season_draw(season, draw_seed='checked-in-seed-test')

		self.assertEqual(draw_summary.total_matchups, 144)
		self.assert_draw_constraints(season)

	def test_draw_endpoint_generates_matchups(self):
		seed_season_entries(self.season)

		response = self.client.post(
			reverse('draw:season-draw', args=[self.season.pk]),
			{'seed': 'api-test-draw', 'player_name': 'Marta'},
			format='json',
		)

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.data['summary']['status'], DrawStatusChoices.COMPLETED)
		self.assertEqual(response.data['summary']['player_name'], 'Marta')
		self.assertIsNotNone(response.data['summary']['draw_id'])
		self.assertEqual(response.data['summary']['total_matchups'], 144)
		self.assertEqual(len(response.data['matchups']), 144)
		self.assertEqual(SeasonDraw.objects.get(pk=response.data['summary']['draw_id']).player_name, 'Marta')
		self.assert_draw_constraints(self.season)

	def test_draw_history_endpoint_returns_draw_metadata(self):
		seed_season_entries(self.season)
		summary = generate_season_draw(self.season, draw_seed='history-test-draw', player_name='History Player')

		response = self.client.get(reverse('draw:season-draw-list', args=[self.season.pk]))

		self.assertEqual(response.status_code, 200)
		self.assertEqual(len(response.data), 1)
		self.assertEqual(response.data[0]['id'], summary.draw_id)
		self.assertEqual(response.data[0]['draw_seed'], 'history-test-draw')
		self.assertEqual(response.data[0]['player_name'], 'History Player')
		self.assertEqual(response.data[0]['status'], DrawStatusChoices.COMPLETED)

	def test_ui_season_state_returns_compact_payload(self):
		seed_season_entries(self.season)
		generate_season_draw(self.season, draw_seed='ui-state-test', player_name='UI Player')

		response = self.client.get(reverse('draw:ui-season-state', args=[self.season.pk]))

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.data['summary']['team_count'], 36)
		self.assertEqual(response.data['summary']['matchup_count'], 144)
		self.assertEqual(len(response.data['teams']), 36)
		self.assertEqual(len(response.data['matchups']), 144)
		self.assertIn('name', response.data['teams'][0])
		self.assertIn('logo_url', response.data['teams'][0])
		self.assertIn('home_team', response.data['matchups'][0])
		self.assertEqual(response.data['draws'][0]['player_name'], 'UI Player')

	def test_matchup_list_endpoint_returns_generated_matchups(self):
		seed_season_entries(self.season)
		generate_season_draw(self.season, draw_seed='list-test-draw')

		response = self.client.get(reverse('draw:season-matchup-list', args=[self.season.pk]))

		self.assertEqual(response.status_code, 200)
		self.assertEqual(len(response.data), 144)

	def test_draw_endpoint_rejects_unseeded_season(self):
		response = self.client.post(reverse('draw:season-draw', args=[self.season.pk]))
		draw_record = SeasonDraw.objects.get(season=self.season)

		self.assertEqual(response.status_code, 400)
		self.assertIn('seeded', response.data['detail'])
		self.assertEqual(draw_record.status, DrawStatusChoices.FAILED)
		self.assertIn('seeded', draw_record.error_message)
		self.assertIsNotNone(draw_record.completed_at)

	def test_seed_endpoint_requires_authentication(self):
		response = self.client.post(reverse('draw:season-seed', args=[self.season.pk]))

		self.assertIn(response.status_code, [401, 403])

	def test_seed_endpoint_accepts_authenticated_user(self):
		User.objects.create_user(username='operator', password='password')
		self.client.login(username='operator', password='password')

		response = self.client.post(reverse('draw:season-seed', args=[self.season.pk]))

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.data['summary']['total_teams'], 36)

	def test_draw_endpoint_rejects_incomplete_season(self):
		incomplete_season = Season.objects.create(name='2026-27')
		for index in range(35):
			association = Association.objects.create(
				name=f'Incomplete Association {index + 1}',
				code=f'I{index + 1:02}',
			)
			team = Team.objects.create(
				name=f'Incomplete Team {index + 1}',
				short_name=f'IT{index + 1}',
				association=association,
			)
			SeasonTeam.objects.create(
				season=incomplete_season,
				team=team,
				uefa_club_coefficient=Decimal('100.000') - Decimal(index),
				seeding_position=index + 1,
				pot=(index // 9) + 1,
			)

		response = self.client.post(reverse('draw:season-draw', args=[incomplete_season.pk]))

		self.assertEqual(response.status_code, 400)
		self.assertIn('exactly 36 teams', response.data['detail'])

	def test_draw_endpoint_rejects_duplicate_draw_without_reset(self):
		seed_season_entries(self.season)

		first_response = self.client.post(
			reverse('draw:season-draw', args=[self.season.pk]),
			{'seed': 'duplicate-test'},
			format='json',
		)
		second_response = self.client.post(
			reverse('draw:season-draw', args=[self.season.pk]),
			{'seed': 'duplicate-test'},
			format='json',
		)

		self.assertEqual(first_response.status_code, 200)
		self.assertEqual(second_response.status_code, 400)
		self.assertIn('already has generated matchups', second_response.data['detail'])
		self.assertEqual(SeasonDraw.objects.filter(season=self.season, status=DrawStatusChoices.COMPLETED).count(), 1)
		self.assertEqual(SeasonDraw.objects.filter(season=self.season, status=DrawStatusChoices.FAILED).count(), 1)

	def test_draw_endpoint_reset_replaces_existing_draw(self):
		seed_season_entries(self.season)
		self.client.post(
			reverse('draw:season-draw', args=[self.season.pk]),
			{'seed': 'reset-test-1'},
			format='json',
		)

		response = self.client.post(
			reverse('draw:season-draw', args=[self.season.pk]),
			{'seed': 'reset-test-2', 'reset': True},
			format='json',
		)

		self.assertEqual(response.status_code, 200)
		self.assertEqual(SeasonMatchup.objects.filter(season=self.season).count(), 144)
		self.assertEqual(SeasonDraw.objects.filter(season=self.season, status=DrawStatusChoices.COMPLETED).count(), 2)
		self.assert_draw_constraints(self.season)

	def test_draw_reset_deletes_season_predictions(self):
		seed_season_entries(self.season)
		self.client.post(
			reverse('draw:season-draw', args=[self.season.pk]),
			{'seed': 'pred-test-1'},
			format='json',
		)
		home = self.entries[0]
		away = self.entries[1]
		matchup = SeasonMatchup.objects.filter(season=self.season).first()
		prediction = Prediction.objects.create(season=self.season, player_name='Ada')
		MatchPrediction.objects.create(prediction=prediction, matchup=matchup, home_goals=2, away_goals=1)
		PlayoffPrediction.objects.create(
			prediction=prediction,
			matchup_index=1,
			home_team=home,
			away_team=away,
			leg1_home_goals=1,
			leg1_away_goals=0,
			leg2_home_goals=2,
			leg2_away_goals=1,
		)
		KnockoutPrediction.objects.create(
			prediction=prediction,
			round='R16',
			bracket_position=1,
			home_team=home,
			away_team=away,
			home_goals=2,
			away_goals=0,
		)
		self.assertEqual(Prediction.objects.filter(season=self.season).count(), 1)

		response = self.client.post(
			reverse('draw:season-draw', args=[self.season.pk]),
			{'seed': 'pred-test-2', 'reset': True},
			format='json',
		)

		self.assertEqual(response.status_code, 200)
		self.assertEqual(Prediction.objects.filter(season=self.season).count(), 0)
		self.assertEqual(MatchPrediction.objects.count(), 0)
		self.assertEqual(PlayoffPrediction.objects.count(), 0)
		self.assertEqual(KnockoutPrediction.objects.count(), 0)

	def test_generate_draw_management_command_creates_matchups_and_metadata(self):
		seed_season_entries(self.season)

		call_command('generate_draw', self.season.name, '--seed', 'command-test-draw', '--player-name', 'CLI Player')

		draw_record = SeasonDraw.objects.get(season=self.season)
		self.assertEqual(draw_record.status, DrawStatusChoices.COMPLETED)
		self.assertEqual(draw_record.draw_seed, 'command-test-draw')
		self.assertEqual(draw_record.player_name, 'CLI Player')
		self.assertEqual(draw_record.matchups_created, 144)
		self.assertEqual(SeasonMatchup.objects.filter(season=self.season).count(), 144)
		self.assert_draw_constraints(self.season)

	def test_draw_endpoint_rejects_impossible_association_constraints(self):
		season = Season.objects.create(name='2027-28')
		association = Association.objects.create(name='One Association', code='ONE')
		for index in range(36):
			team = Team.objects.create(
				name=f'Same Association Team {index + 1}',
				short_name=f'SA{index + 1}',
				association=association,
			)
			SeasonTeam.objects.create(
				season=season,
				team=team,
				uefa_club_coefficient=Decimal('100.000') - Decimal(index),
				seeding_position=index + 1,
				pot=(index // 9) + 1,
			)

		response = self.client.post(reverse('draw:season-draw', args=[season.pk]))

		self.assertEqual(response.status_code, 400)
		self.assertIn('eligible opponents', response.data['detail'])

	def assert_draw_constraints(self, season):
		entries = list(SeasonTeam.objects.select_related('team__association').filter(season=season))
		entries_by_id = {entry.pk: entry for entry in entries}
		matchups = list(
			SeasonMatchup.objects.select_related(
				'home_team__team__association',
				'away_team__team__association',
			).filter(season=season)
		)
		home_counts = {}
		away_counts = {}
		opponent_pot_counts = {entry.pk: {} for entry in entries}
		opponent_association_counts = {entry.pk: {} for entry in entries}
		matchday_counts = {entry.pk: {} for entry in entries}
		undirected_edges = set()

		self.assertEqual(len(matchups), 144)

		for matchup in matchups:
			home_id = matchup.home_team_id
			away_id = matchup.away_team_id
			home_entry = entries_by_id[home_id]
			away_entry = entries_by_id[away_id]
			edge = tuple(sorted((home_id, away_id)))

			self.assertNotIn(edge, undirected_edges)
			undirected_edges.add(edge)
			self.assertNotEqual(home_entry.team.association_id, away_entry.team.association_id)
			self.assertIsNotNone(matchup.matchday)
			self.assertGreaterEqual(matchup.matchday, 1)
			self.assertLessEqual(matchup.matchday, 8)

			home_counts[home_id] = home_counts.get(home_id, 0) + 1
			away_counts[away_id] = away_counts.get(away_id, 0) + 1
			opponent_pot_counts[home_id][away_entry.pot] = opponent_pot_counts[home_id].get(away_entry.pot, 0) + 1
			opponent_pot_counts[away_id][home_entry.pot] = opponent_pot_counts[away_id].get(home_entry.pot, 0) + 1
			opponent_association_counts[home_id][away_entry.team.association_id] = (
				opponent_association_counts[home_id].get(away_entry.team.association_id, 0) + 1
			)
			opponent_association_counts[away_id][home_entry.team.association_id] = (
				opponent_association_counts[away_id].get(home_entry.team.association_id, 0) + 1
			)
			matchday_counts[home_id][matchup.matchday] = matchday_counts[home_id].get(matchup.matchday, 0) + 1
			matchday_counts[away_id][matchup.matchday] = matchday_counts[away_id].get(matchup.matchday, 0) + 1

		for entry in entries:
			self.assertEqual(home_counts.get(entry.pk, 0), 4)
			self.assertEqual(away_counts.get(entry.pk, 0), 4)
			for pot in range(1, 5):
				self.assertEqual(opponent_pot_counts[entry.pk].get(pot, 0), 2)
			for association_count in opponent_association_counts[entry.pk].values():
				self.assertLessEqual(association_count, 2)
			for matchday in range(1, 9):
				self.assertEqual(matchday_counts[entry.pk].get(matchday, 0), 1)


class SeedInputImportTests(TestCase):
	def build_payload(self, entries):
		return {
			'season': {
				'name': '2025-26',
				'competition': 'UCL',
			},
			'entries': entries,
		}

	def build_entry(self, rank, team_name, short_name, association_name, association_code, coefficient, *, title_holder=False):
		return {
			'rank': rank,
			'team': {
				'name': team_name,
				'short_name': short_name,
				'association': {
					'name': association_name,
					'code': association_code,
				},
				'api_football_logo': f'https://example.test/{short_name}.png',
				'uefa_reference_name': team_name,
			},
			'uefa_club_coefficient': coefficient,
			'is_title_holder': title_holder,
			'qualified_via': 'TITLE_HOLDER' if title_holder else 'LEAGUE_POSITION',
		}

	def test_import_seed_input_payload_upserts_and_prunes_entries(self):
		initial_payload = self.build_payload([
			self.build_entry(1, 'Arsenal', 'ARS', 'England', 'ENG', '98.0'),
			self.build_entry(2, 'Real Madrid', 'RMA', 'Spain', 'ESP', '143.5', title_holder=True),
		])

		summary = import_seed_input_payload(initial_payload, set_active=True)

		self.assertTrue(summary.season_created)
		self.assertEqual(Association.objects.count(), 2)
		self.assertEqual(Team.objects.count(), 2)
		self.assertEqual(SeasonTeam.objects.count(), 2)
		self.assertEqual(Season.objects.get(name='2025-26').is_active, True)

		updated_payload = self.build_payload([
			self.build_entry(1, 'Arsenal FC', 'ARS', 'England', 'ENG', '99.5'),
			self.build_entry(2, 'Barcelona', 'BAR', 'Spain', 'ESP', '103.25', title_holder=True),
		])

		summary = import_seed_input_payload(updated_payload, set_active=True)

		self.assertFalse(summary.season_created)
		self.assertEqual(summary.season_entries_deleted, 1)
		self.assertEqual(SeasonTeam.objects.count(), 2)
		self.assertTrue(Team.objects.filter(name='Arsenal FC', short_name='ARS').exists())
		self.assertFalse(SeasonTeam.objects.filter(team__name='Real Madrid').exists())
		self.assertTrue(SeasonTeam.objects.filter(team__name='Barcelona', is_title_holder=True).exists())
		self.assertEqual(SeasonTeam.objects.get(team__name='Arsenal FC').uefa_club_coefficient, Decimal('99.5'))
		self.assertEqual(Team.objects.get(name='Arsenal FC').logo_url, 'https://example.test/ARS.png')

	def test_import_seed_input_command_reads_json_file(self):
		payload = self.build_payload([
			self.build_entry(1, 'Liverpool', 'LIV', 'England', 'ENG', '125.5'),
			self.build_entry(2, 'Benfica', 'BEN', 'Portugal', 'POR', '87.75', title_holder=True),
		])

		with TemporaryDirectory() as temp_dir:
			file_path = Path(temp_dir) / 'seed_input.json'
			file_path.write_text(json.dumps(payload), encoding='utf-8')

			call_command('import_seed_input', str(file_path), '--set-active')

		self.assertTrue(Season.objects.filter(name='2025-26', is_active=True).exists())
		self.assertTrue(SeasonTeam.objects.filter(team__name='Liverpool').exists())
		self.assertTrue(SeasonTeam.objects.filter(team__name='Benfica', is_title_holder=True).exists())

	def test_import_seed_input_reuses_existing_association_by_name(self):
		Association.objects.create(name='England', code='OLD')
		payload = self.build_payload([
			self.build_entry(1, 'Arsenal', 'ARS', 'England', 'ENG', '98.0', title_holder=True),
		])

		summary = import_seed_input_payload(payload, set_active=True)

		self.assertEqual(summary.associations_created, 0)
		self.assertEqual(summary.associations_updated, 1)
		self.assertEqual(Association.objects.count(), 1)
		self.assertTrue(Association.objects.filter(name='England', code='ENG').exists())

	def test_import_seed_input_does_not_merge_distinct_teams_with_same_short_name(self):
		payload = self.build_payload([
			self.build_entry(1, 'Bayern München', 'BAY', 'Germany', 'GER', '135.25', title_holder=True),
			self.build_entry(2, 'Bayer Leverkusen', 'BAY', 'Germany', 'GER', '95.25'),
		])

		import_seed_input_payload(payload, set_active=True)

		self.assertEqual(Team.objects.filter(association__code='GER', short_name='BAY').count(), 2)
		self.assertTrue(SeasonTeam.objects.filter(team__name='Bayern München').exists())
		self.assertTrue(SeasonTeam.objects.filter(team__name='Bayer Leverkusen').exists())

	def test_import_seed_input_updates_existing_team_logo_url(self):
		initial_payload = self.build_payload([
			self.build_entry(1, 'Arsenal', 'ARS', 'England', 'ENG', '98.0', title_holder=True),
		])
		import_seed_input_payload(initial_payload, set_active=True)

		updated_entry = self.build_entry(1, 'Arsenal', 'ARS', 'England', 'ENG', '98.0', title_holder=True)
		updated_entry['team']['api_football_logo'] = 'https://example.test/arsenal-new.png'
		import_seed_input_payload(self.build_payload([updated_entry]), set_active=True)

		self.assertEqual(Team.objects.get(name='Arsenal').logo_url, 'https://example.test/arsenal-new.png')


class SeasonMatchupModelTests(TestCase):
	def setUp(self):
		self.season = Season.objects.create(name='2025-26')
		self.other_season = Season.objects.create(name='2026-27')
		self.association = Association.objects.create(name='England', code='ENG')
		self.home_team = Team.objects.create(name='Arsenal', short_name='ARS', association=self.association)
		self.away_team = Team.objects.create(name='Liverpool', short_name='LIV', association=self.association)
		self.other_team = Team.objects.create(name='Chelsea', short_name='CHE', association=self.association)
		self.home_entry = SeasonTeam.objects.create(season=self.season, team=self.home_team, uefa_club_coefficient=Decimal('98.0'))
		self.away_entry = SeasonTeam.objects.create(season=self.season, team=self.away_team, uefa_club_coefficient=Decimal('125.5'))
		self.other_season_entry = SeasonTeam.objects.create(season=self.other_season, team=self.other_team, uefa_club_coefficient=Decimal('109.0'))

	def test_valid_matchup_is_saved(self):
		matchup = SeasonMatchup.objects.create(
			season=self.season,
			home_team=self.home_entry,
			away_team=self.away_entry,
		)

		self.assertEqual(matchup.season, self.season)
		self.assertEqual(SeasonMatchup.objects.count(), 1)

	def test_reverse_matchup_is_rejected(self):
		SeasonMatchup.objects.create(
			season=self.season,
			home_team=self.home_entry,
			away_team=self.away_entry,
		)

		with self.assertRaises(ValidationError):
			SeasonMatchup.objects.create(
				season=self.season,
				home_team=self.away_entry,
				away_team=self.home_entry,
			)

	def test_cross_season_matchup_is_rejected(self):
		with self.assertRaises(ValidationError):
			SeasonMatchup.objects.create(
				season=self.season,
				home_team=self.home_entry,
				away_team=self.other_season_entry,
			)


class PreviousSeasonNamesTests(TestCase):
	def test_derives_two_consecutive_previous_seasons(self):
		self.assertEqual(previous_season_names('2026-27'), ['2025-26', '2024-25'])
		self.assertEqual(previous_season_names('2025-26'), ['2024-25', '2023-24'])

	def test_returns_none_for_malformed_name(self):
		self.assertIsNone(previous_season_names('not-a-season'))
		self.assertIsNone(previous_season_names('2026'))


class Rule6Tests(TestCase):
	def setUp(self):
		# Season 2026-27, whose two previous consecutive seasons are 2025-26 and 2024-25.
		self.season = Season.objects.create(name='2026-27', is_active=True)
		self.entries = []
		for index in range(36):
			association = Association.objects.create(name=f'Assoc {index + 1}', code=f'{index + 1:03}')
			team = Team.objects.create(name=f'Team {index + 1}', short_name=f'T{index + 1}', association=association)
			entry = SeasonTeam.objects.create(
				season=self.season,
				team=team,
				uefa_club_coefficient=Decimal('120.000') - Decimal(index),
				qualified_via=QualifiedViaChoices.LEAGUE_POSITION,
			)
			self.entries.append(entry)

		title_holder = self.entries[-1]
		title_holder.is_title_holder = True
		title_holder.qualified_via = QualifiedViaChoices.TITLE_HOLDER
		title_holder.uefa_club_coefficient = Decimal('15.000')
		title_holder.save(update_fields=['is_title_holder', 'qualified_via', 'uefa_club_coefficient'])

		seed_season_entries(self.season)

	def test_previous_season_names_map_to_rule_six(self):
		self.assertEqual(previous_season_names('2026-27'), ['2025-26', '2024-25'])

	def test_sync_match_history_derives_seasons_from_the_active_season(self):
		"""--seasons must default to the exact window Rule 6 reads.

		That is what lets the command run on a schedule instead of being handed
		hardcoded years that silently go stale as seasons roll forward.
		"""
		from draw.management.commands.sync_match_history import Command

		self.assertEqual(Command().default_seasons(), ['2025-26', '2024-25'])
		# Must agree with the solver's own notion of the window, or the two drift.
		self.assertEqual(Command().default_seasons(), previous_season_names(self.season.name))

	def test_sync_match_history_derives_nothing_without_an_active_season(self):
		Season.objects.update(is_active=False)
		from draw.management.commands.sync_match_history import Command

		self.assertEqual(Command().default_seasons(), [])

	def test_sync_match_history_writes_crosses_for_the_league_phase_only(self):
		"""Runs the real handle() against a stubbed fetch.

		Guards the name->Team lookup (it was built by unpacking .values('name')
		into two names, which raised before anything was written) and the
		matchday 1..8 filter.
		"""
		import os
		from unittest.mock import patch

		from draw.management.commands.sync_match_history import Command

		home = self.entries[0].team
		away = self.entries[1].team
		payload = {
			'matches': [
				{'matchday': 3, 'homeTeam': {'name': home.name}, 'awayTeam': {'name': away.name}},
				# Outside the league phase: must be ignored.
				{'matchday': 12, 'homeTeam': {'name': away.name}, 'awayTeam': {'name': home.name}},
			]
		}

		with patch.dict(os.environ, {'API_FOOTBALL_DATA_KEY': 'test-key'}), \
				patch.object(Command, 'fetch', return_value=payload):
			Command().handle(seasons='2025-26', dry_run=False)

		self.assertTrue(
			SeasonMatchupHistory.objects.filter(
				season_name='2025-26', home_team=home, away_team=away
			).exists()
		)
		self.assertFalse(
			SeasonMatchupHistory.objects.filter(
				season_name='2025-26', home_team=away, away_team=home
			).exists()
		)

	def test_compute_forbidden_directions_blocks_repeated_home_pairing(self):
		home = self.entries[0]
		away = self.entries[1]
		SeasonMatchupHistory.objects.create(season_name='2025-26', home_team=home.team, away_team=away.team)
		SeasonMatchupHistory.objects.create(season_name='2024-25', home_team=home.team, away_team=away.team)

		forbidden = compute_forbidden_directions(self.season)

		self.assertIn((home.team_id, away.team_id), forbidden)

	def test_single_previous_occurrence_is_not_blocked(self):
		home = self.entries[0]
		away = self.entries[1]
		SeasonMatchupHistory.objects.create(season_name='2025-26', home_team=home.team, away_team=away.team)

		forbidden = compute_forbidden_directions(self.season)

		self.assertNotIn((home.team_id, away.team_id), forbidden)

	def test_opposite_direction_is_not_blocked_by_rule_six(self):
		home = self.entries[0]
		away = self.entries[1]
		# home vs away blocked, but away vs home (reverse) remains legal.
		SeasonMatchupHistory.objects.create(season_name='2025-26', home_team=home.team, away_team=away.team)
		SeasonMatchupHistory.objects.create(season_name='2024-25', home_team=home.team, away_team=away.team)

		forbidden = compute_forbidden_directions(self.season)

		self.assertIn((home.team_id, away.team_id), forbidden)
		self.assertNotIn((away.team_id, home.team_id), forbidden)

	def test_generated_draw_never_places_blocked_team_as_home(self):
		home = self.entries[0]
		away = self.entries[1]
		SeasonMatchupHistory.objects.create(season_name='2025-26', home_team=home.team, away_team=away.team)
		SeasonMatchupHistory.objects.create(season_name='2024-25', home_team=home.team, away_team=away.team)

		for seed in ('rule6-a', 'rule6-b', 'rule6-c', 'rule6-d'):
			summary = generate_season_draw(self.season, draw_seed=seed, reset=True)
			self.assertEqual(summary.status, DrawStatusChoices.COMPLETED)

			# Whenever the undirected pairing is drawn, the blocked team must be the away side.
			violations = SeasonMatchup.objects.filter(
				season=self.season,
				home_team__team=home.team,
				away_team__team=away.team,
			)
			self.assertEqual(violations.count(), 0)


class SequentialDrawTests(TestCase):
	"""Sequential (UEFA-style extraction) draw generation."""

	def setUp(self):
		# Season 2026-27: its two previous consecutive seasons are 2025-26 and 2024-25.
		self.season = Season.objects.create(name='2026-27', is_active=True)
		self.entries = []

		for index in range(36):
			association = Association.objects.create(
				name=f'Assoc {index + 1}',
				code=f'{index + 1:03}',
			)
			team = Team.objects.create(
				name=f'Team {index + 1}',
				short_name=f'T{index + 1}',
				association=association,
			)
			entry = SeasonTeam.objects.create(
				season=self.season,
				team=team,
				uefa_club_coefficient=Decimal('120.000') - Decimal(index),
				qualified_via=QualifiedViaChoices.LEAGUE_POSITION,
			)
			self.entries.append(entry)

		title_holder = self.entries[-1]
		title_holder.is_title_holder = True
		title_holder.qualified_via = QualifiedViaChoices.TITLE_HOLDER
		title_holder.uefa_club_coefficient = Decimal('15.000')
		title_holder.save(update_fields=['is_title_holder', 'qualified_via', 'uefa_club_coefficient'])

		seed_season_entries(self.season)

	def test_sequential_draw_produces_valid_matchups(self):
		summary = generate_season_draw(self.season, draw_seed='seq-1', method='sequential')
		draw_record = SeasonDraw.objects.get(pk=summary.draw_id)

		self.assertEqual(summary.status, DrawStatusChoices.COMPLETED)
		self.assertEqual(summary.total_matchups, 144)
		self.assertEqual(draw_record.method, DrawMethodChoices.SEQUENTIAL)
		self.assert_draw_constraints(self.season)

	def test_sat_draw_defaults_method_to_sat(self):
		summary = generate_season_draw(self.season, draw_seed='sat-1', method='sat')
		draw_record = SeasonDraw.objects.get(pk=summary.draw_id)

		self.assertEqual(summary.status, DrawStatusChoices.COMPLETED)
		self.assertEqual(summary.total_matchups, 144)
		self.assertEqual(draw_record.method, DrawMethodChoices.SAT)

	def test_sequential_draw_multiple_seeds(self):
		for seed in ('seq-multi-1', 'seq-multi-2', 'seq-multi-3'):
			summary = generate_season_draw(self.season, draw_seed=seed, reset=True, method='sequential')

			self.assertEqual(summary.status, DrawStatusChoices.COMPLETED)
			self.assertEqual(summary.total_matchups, 144)
			self.assert_draw_constraints(self.season)

	def test_sequential_draw_respects_rule_six(self):
		home = self.entries[0]
		away = self.entries[1]
		SeasonMatchupHistory.objects.create(season_name='2025-26', home_team=home.team, away_team=away.team)
		SeasonMatchupHistory.objects.create(season_name='2024-25', home_team=home.team, away_team=away.team)

		for seed in ('seq-rule6-a', 'seq-rule6-b', 'seq-rule6-c'):
			summary = generate_season_draw(self.season, draw_seed=seed, reset=True, method='sequential')

			self.assertEqual(summary.status, DrawStatusChoices.COMPLETED)

			# Whenever the undirected pairing is drawn, the blocked team must be the away side.
			violations = SeasonMatchup.objects.filter(
				season=self.season,
				home_team__team=home.team,
				away_team__team=away.team,
			)
			self.assertEqual(violations.count(), 0)

	def assert_draw_constraints(self, season):
		entries = list(SeasonTeam.objects.select_related('team__association').filter(season=season))
		entries_by_id = {entry.pk: entry for entry in entries}
		matchups = list(
			SeasonMatchup.objects.select_related(
				'home_team__team__association',
				'away_team__team__association',
			).filter(season=season)
		)
		home_counts = {}
		away_counts = {}
		opponent_pot_counts = {entry.pk: {} for entry in entries}
		opponent_association_counts = {entry.pk: {} for entry in entries}
		matchday_counts = {entry.pk: {} for entry in entries}
		undirected_edges = set()

		self.assertEqual(len(matchups), 144)

		for matchup in matchups:
			home_id = matchup.home_team_id
			away_id = matchup.away_team_id
			home_entry = entries_by_id[home_id]
			away_entry = entries_by_id[away_id]
			edge = tuple(sorted((home_id, away_id)))

			self.assertNotIn(edge, undirected_edges)
			undirected_edges.add(edge)
			self.assertNotEqual(home_entry.team.association_id, away_entry.team.association_id)
			self.assertIsNotNone(matchup.matchday)
			self.assertGreaterEqual(matchup.matchday, 1)
			self.assertLessEqual(matchup.matchday, 8)

			home_counts[home_id] = home_counts.get(home_id, 0) + 1
			away_counts[away_id] = away_counts.get(away_id, 0) + 1
			opponent_pot_counts[home_id][away_entry.pot] = opponent_pot_counts[home_id].get(away_entry.pot, 0) + 1
			opponent_pot_counts[away_id][home_entry.pot] = opponent_pot_counts[away_id].get(home_entry.pot, 0) + 1
			opponent_association_counts[home_id][away_entry.team.association_id] = (
				opponent_association_counts[home_id].get(away_entry.team.association_id, 0) + 1
			)
			opponent_association_counts[away_id][home_entry.team.association_id] = (
				opponent_association_counts[away_id].get(home_entry.team.association_id, 0) + 1
			)
			matchday_counts[home_id][matchup.matchday] = matchday_counts[home_id].get(matchup.matchday, 0) + 1
			matchday_counts[away_id][matchup.matchday] = matchday_counts[away_id].get(matchup.matchday, 0) + 1

		for entry in entries:
			self.assertEqual(home_counts.get(entry.pk, 0), 4)
			self.assertEqual(away_counts.get(entry.pk, 0), 4)
			for pot in range(1, 5):
				self.assertEqual(opponent_pot_counts[entry.pk].get(pot, 0), 2)
			for association_count in opponent_association_counts[entry.pk].values():
				self.assertLessEqual(association_count, 2)
			for matchday in range(1, 9):
				self.assertEqual(matchday_counts[entry.pk].get(matchday, 0), 1)


class InteractiveDrawTests(TestCase):
	"""Interactive (manual pot-by-pot) draw ceremony: model, session, picks, finalize."""

	def setUp(self):
		# Season 2026-27: its two previous consecutive seasons are 2025-26 and 2024-25.
		self.season = Season.objects.create(name='2026-27', is_active=True)
		self.entries = []

		for index in range(36):
			association = Association.objects.create(
				name=f'IAssoc {index + 1}',
				code=f'{index + 1:03}',
			)
			team = Team.objects.create(
				name=f'ITeam {index + 1}',
				short_name=f'IT{index + 1}',
				association=association,
			)
			entry = SeasonTeam.objects.create(
				season=self.season,
				team=team,
				uefa_club_coefficient=Decimal('120.000') - Decimal(index),
				qualified_via=QualifiedViaChoices.LEAGUE_POSITION,
			)
			self.entries.append(entry)

		title_holder = self.entries[-1]
		title_holder.is_title_holder = True
		title_holder.qualified_via = QualifiedViaChoices.TITLE_HOLDER
		title_holder.uefa_club_coefficient = Decimal('15.000')
		title_holder.save(update_fields=['is_title_holder', 'qualified_via', 'uefa_club_coefficient'])

		seed_season_entries(self.season)

	def pot_entries(self, pot):
		return list(SeasonTeam.objects.filter(season=self.season, pot=pot).order_by('seeding_position'))

	def run_full_ceremony(self, draw):
		for pot in range(1, 5):
			for entry in self.pot_entries(pot):
				pick_team(season=self.season, draw=draw, season_team_id=entry.pk)

	def assert_draw_constraints(self, season):
		entries = list(SeasonTeam.objects.select_related('team__association').filter(season=season))
		entries_by_id = {entry.pk: entry for entry in entries}
		matchups = list(
			SeasonMatchup.objects.select_related(
				'home_team__team__association',
				'away_team__team__association',
			).filter(season=season)
		)
		home_counts = {}
		away_counts = {}
		opponent_pot_counts = {entry.pk: {} for entry in entries}
		opponent_association_counts = {entry.pk: {} for entry in entries}
		matchday_counts = {entry.pk: {} for entry in entries}
		undirected_edges = set()

		self.assertEqual(len(matchups), 144)

		for matchup in matchups:
			home_id = matchup.home_team_id
			away_id = matchup.away_team_id
			home_entry = entries_by_id[home_id]
			away_entry = entries_by_id[away_id]
			edge = tuple(sorted((home_id, away_id)))

			self.assertNotIn(edge, undirected_edges)
			undirected_edges.add(edge)
			self.assertNotEqual(home_entry.team.association_id, away_entry.team.association_id)
			self.assertIsNotNone(matchup.matchday)
			self.assertGreaterEqual(matchup.matchday, 1)
			self.assertLessEqual(matchup.matchday, 8)

			home_counts[home_id] = home_counts.get(home_id, 0) + 1
			away_counts[away_id] = away_counts.get(away_id, 0) + 1
			opponent_pot_counts[home_id][away_entry.pot] = opponent_pot_counts[home_id].get(away_entry.pot, 0) + 1
			opponent_pot_counts[away_id][home_entry.pot] = opponent_pot_counts[away_id].get(home_entry.pot, 0) + 1
			opponent_association_counts[home_id][away_entry.team.association_id] = (
				opponent_association_counts[home_id].get(away_entry.team.association_id, 0) + 1
			)
			opponent_association_counts[away_id][home_entry.team.association_id] = (
				opponent_association_counts[away_id].get(home_entry.team.association_id, 0) + 1
			)
			matchday_counts[home_id][matchup.matchday] = matchday_counts[home_id].get(matchup.matchday, 0) + 1
			matchday_counts[away_id][matchup.matchday] = matchday_counts[away_id].get(matchup.matchday, 0) + 1

		for entry in entries:
			self.assertEqual(home_counts.get(entry.pk, 0), 4)
			self.assertEqual(away_counts.get(entry.pk, 0), 4)
			for pot in range(1, 5):
				self.assertEqual(opponent_pot_counts[entry.pk].get(pot, 0), 2)
			for association_count in opponent_association_counts[entry.pk].values():
				self.assertLessEqual(association_count, 2)
			for matchday in range(1, 9):
				self.assertEqual(matchday_counts[entry.pk].get(matchday, 0), 1)

	def test_interactive_method_exposes_choice_and_creates_running_session(self):
		self.assertEqual(DrawMethodChoices.INTERACTIVE, 'interactive')

		draw = SeasonDraw.objects.create(
			season=self.season,
			draw_seed='manual-1',
			method=DrawMethodChoices.INTERACTIVE,
		)
		self.assertEqual(draw.status, DrawStatusChoices.RUNNING)

	def test_duplicate_pick_for_same_team_rejected_by_constraint(self):
		draw = start_or_resume(season=self.season, draw_seed='manual-1')
		team = self.pot_entries(1)[0]
		InteractiveDrawPick.objects.create(draw=draw, season_team=team, pick_order=1)

		with transaction.atomic():
			with self.assertRaises(IntegrityError):
				InteractiveDrawPick.objects.create(draw=draw, season_team=team, pick_order=2)

	def test_start_creates_running_interactive_session(self):
		draw = start_or_resume(season=self.season, draw_seed='manual-1', player_name='Ada')

		self.assertEqual(draw.method, DrawMethodChoices.INTERACTIVE)
		self.assertEqual(draw.status, DrawStatusChoices.RUNNING)
		self.assertEqual(draw.player_name, 'Ada')
		self.assertEqual(current_pot(draw), 1)

	def test_start_resumes_existing_session_with_picks_intact(self):
		draw = start_or_resume(season=self.season, draw_seed='manual-1')
		pick_team(season=self.season, draw=draw, season_team_id=self.pot_entries(1)[0].pk)

		resumed = start_or_resume(season=self.season, draw_seed='manual-1')
		self.assertEqual(resumed.pk, draw.pk)
		self.assertEqual(InteractiveDrawPick.objects.filter(draw=draw).count(), 1)
		self.assertEqual(current_pot(resumed), 1)

	def test_reset_clears_picks_matchups_and_stale_predictions(self):
		draw = start_or_resume(season=self.season, draw_seed='manual-1')
		pick_team(season=self.season, draw=draw, season_team_id=self.pot_entries(1)[0].pk)
		matchup = SeasonMatchup.objects.filter(season=self.season).first()
		prediction = Prediction.objects.create(season=self.season, player_name='Ada')
		MatchPrediction.objects.create(prediction=prediction, matchup=matchup, home_goals=1, away_goals=0)

		fresh = start_or_resume(season=self.season, draw_seed='manual-1', reset=True)

		self.assertNotEqual(fresh.pk, draw.pk)
		self.assertEqual(InteractiveDrawPick.objects.filter(draw=fresh).count(), 0)
		self.assertEqual(SeasonMatchup.objects.filter(season=self.season).count(), 0)
		self.assertEqual(MatchPrediction.objects.count(), 0)
		self.assertEqual(current_pot(fresh), 1)
		self.assertEqual(
			SeasonDraw.objects.filter(
				season=self.season,
				method=DrawMethodChoices.INTERACTIVE,
				status=DrawStatusChoices.RUNNING,
			).count(),
			1,
		)

	def test_only_one_running_interactive_session_per_season(self):
		first = start_or_resume(season=self.season, draw_seed='manual-1')
		second = start_or_resume(season=self.season, draw_seed='manual-1')

		self.assertEqual(first.pk, second.pk)
		self.assertEqual(
			SeasonDraw.objects.filter(
				season=self.season,
				method=DrawMethodChoices.INTERACTIVE,
				status=DrawStatusChoices.RUNNING,
			).count(),
			1,
		)

	def test_one_shot_reset_cancels_running_interactive_session(self):
		draw = start_or_resume(season=self.season, draw_seed='manual-1')
		pick_team(season=self.season, draw=draw, season_team_id=self.pot_entries(1)[0].pk)

		summary = generate_season_draw(self.season, draw_seed='oneshot-1', method='sequential', reset=True)

		self.assertEqual(summary.status, DrawStatusChoices.COMPLETED)
		self.assertEqual(summary.total_matchups, 144)
		self.assertEqual(
			SeasonDraw.objects.filter(
				season=self.season,
				method=DrawMethodChoices.INTERACTIVE,
				status=DrawStatusChoices.RUNNING,
			).count(),
			0,
		)
		self.assertEqual(InteractiveDrawPick.objects.filter(draw=draw).count(), 0)

	def test_pick_counts_follow_ceremony_math(self):
		draw = start_or_resume(season=self.season, draw_seed='manual-1')

		pot1 = self.pot_entries(1)
		pick_team(season=self.season, draw=draw, season_team_id=pot1[0].pk)
		self.assertEqual(SeasonMatchup.objects.count(), 8)
		for entry in pot1[1:]:
			pick_team(season=self.season, draw=draw, season_team_id=entry.pk)
		self.assertEqual(SeasonMatchup.objects.count(), 63)
		self.assertEqual(current_pot(draw), 2)

		pot2 = self.pot_entries(2)
		pick_team(season=self.season, draw=draw, season_team_id=pot2[0].pk)
		self.assertEqual(SeasonMatchup.objects.count(), 63 + 6)
		for entry in pot2[1:]:
			pick_team(season=self.season, draw=draw, season_team_id=entry.pk)
		self.assertEqual(SeasonMatchup.objects.count(), 108)
		self.assertEqual(current_pot(draw), 3)

		pot3 = self.pot_entries(3)
		pick_team(season=self.season, draw=draw, season_team_id=pot3[0].pk)
		self.assertEqual(SeasonMatchup.objects.count(), 108 + 4)
		for entry in pot3[1:]:
			pick_team(season=self.season, draw=draw, season_team_id=entry.pk)
		self.assertEqual(SeasonMatchup.objects.count(), 135)
		self.assertEqual(current_pot(draw), 4)

		pot4 = self.pot_entries(4)
		pick_team(season=self.season, draw=draw, season_team_id=pot4[0].pk)
		self.assertEqual(SeasonMatchup.objects.count(), 135 + 2)

		last = None
		for entry in pot4[1:]:
			last = pick_team(season=self.season, draw=draw, season_team_id=entry.pk)

		draw.refresh_from_db()
		self.assertEqual(last.auto_finalized, True)
		self.assertEqual(SeasonMatchup.objects.count(), 144)
		self.assertEqual(draw.status, DrawStatusChoices.COMPLETED)
		self.assertEqual(draw.matchups_created, 144)
		self.assertEqual(current_pot(draw), None)
		self.assert_draw_constraints(self.season)

	def test_full_ceremony_auto_finalizes_and_holds_constraints(self):
		draw = start_or_resume(season=self.season, draw_seed='manual-1')

		last = None
		for pot in range(1, 5):
			for entry in self.pot_entries(pot):
				last = pick_team(season=self.season, draw=draw, season_team_id=entry.pk)

		draw.refresh_from_db()
		self.assertEqual(last.auto_finalized, True)
		self.assertEqual(draw.status, DrawStatusChoices.COMPLETED)
		self.assertEqual(draw.matchups_created, 144)
		self.assertIsNotNone(draw.completed_at)
		self.assert_draw_constraints(self.season)

	def test_every_pick_leaves_four_home_four_away(self):
		draw = start_or_resume(season=self.season, draw_seed='manual-1')

		# The ceremony display must never show an unbalanced home/away split:
		# from the moment a team is picked it holds exactly 4 home and 4 away.
		for pot in range(1, 5):
			for entry in self.pot_entries(pot):
				pick_team(season=self.season, draw=draw, season_team_id=entry.pk)
				home_rows = SeasonMatchup.objects.filter(season=self.season, home_team_id=entry.pk).count()
				away_rows = SeasonMatchup.objects.filter(season=self.season, away_team_id=entry.pk).count()
				self.assertEqual(
					home_rows, 4,
					f'{entry.team.name} must hold exactly 4 home games after its pick',
				)
				self.assertEqual(
					away_rows, 4,
					f'{entry.team.name} must hold exactly 4 away games after its pick',
				)

		draw.refresh_from_db()
		self.assertEqual(draw.status, DrawStatusChoices.COMPLETED)
		self.assert_draw_constraints(self.season)

	def test_pick_rejects_team_not_in_current_pot(self):
		draw = start_or_resume(season=self.season, draw_seed='manual-1')
		for entry in self.pot_entries(1):
			pick_team(season=self.season, draw=draw, season_team_id=entry.pk)

		stray = self.pot_entries(1)[0]
		with self.assertRaises(DrawError):
			pick_team(season=self.season, draw=draw, season_team_id=stray.pk)
		self.assertEqual(SeasonMatchup.objects.count(), 63)
		self.assertEqual(InteractiveDrawPick.objects.filter(draw=draw).count(), 9)

	def test_pick_rejects_already_drawn_team(self):
		draw = start_or_resume(season=self.season, draw_seed='manual-1')
		team = self.pot_entries(1)[0]
		pick_team(season=self.season, draw=draw, season_team_id=team.pk)

		with self.assertRaises(DrawError):
			pick_team(season=self.season, draw=draw, season_team_id=team.pk)
		self.assertEqual(SeasonMatchup.objects.count(), 8)
		self.assertEqual(InteractiveDrawPick.objects.filter(draw=draw).count(), 1)

	def test_pick_rejects_when_draw_not_running(self):
		draw = SeasonDraw.objects.create(
			season=self.season,
			draw_seed='done-1',
			method=DrawMethodChoices.INTERACTIVE,
			status=DrawStatusChoices.COMPLETED,
		)
		with self.assertRaises(DrawError):
			pick_team(season=self.season, draw=draw, season_team_id=self.pot_entries(1)[0].pk)

	def _rigged_season(self):
		season = Season.objects.create(name='2025-26')
		entries = []

		def make_entry(index, coefficient, association_name, association_code):
			association = Association.objects.create(name=association_name, code=association_code)
			team = Team.objects.create(name=f'Rig {index + 1}', short_name=f'R{index + 1}', association=association)
			return SeasonTeam.objects.create(
				season=season,
				team=team,
				uefa_club_coefficient=Decimal(str(coefficient)),
				qualified_via=QualifiedViaChoices.LEAGUE_POSITION,
			)

		for index in range(27):  # pots 1-3: one unique association each
			entries.append(make_entry(index, Decimal('120.000') - Decimal(index), f'RAssoc {index + 1}', f'{index + 100:03}'))

		england = Association.objects.create(name='England', code='ENG')
		for index in range(8):  # pot 4: eight English clubs
			team = Team.objects.create(name=f'ENG {index + 1}', short_name=f'E{index + 1}', association=england)
			entries.append(SeasonTeam.objects.create(
				season=season,
				team=team,
				uefa_club_coefficient=Decimal('90.000') - Decimal(index),
				qualified_via=QualifiedViaChoices.LEAGUE_POSITION,
			))

		espana = Association.objects.create(name='Spain', code='ESP')
		team = Team.objects.create(name='Real Betis', short_name='BET', association=espana)
		title_holder = SeasonTeam.objects.create(
			season=season,
			team=team,
			uefa_club_coefficient=Decimal('82.000'),
			qualified_via=QualifiedViaChoices.TITLE_HOLDER,
		)
		title_holder.is_title_holder = True
		title_holder.save(update_fields=['is_title_holder', 'qualified_via'])
		entries.append(title_holder)

		seed_season_entries(season)
		return season

	def test_dead_end_guard_rejects_without_persisting(self):
		season = self._rigged_season()
		draw = start_or_resume(season=season, draw_seed='rigged-1')
		first_pot1 = SeasonTeam.objects.filter(season=season, pot=1).order_by('seeding_position').first()

		with self.assertRaises(DrawError) as ctx:
			pick_team(season=season, draw=draw, season_team_id=first_pot1.pk)

		self.assertIn('dead-end', str(ctx.exception))
		self.assertEqual(SeasonMatchup.objects.filter(season=season).count(), 0)
		self.assertEqual(InteractiveDrawPick.objects.filter(draw=draw).count(), 0)

	def test_ceremony_respects_rule_six_blocked_pair_never_drawn(self):
		home, away = self.pot_entries(1)[:2]
		for season_name in ('2025-26', '2024-25'):
			SeasonMatchupHistory.objects.create(season_name=season_name, home_team=home.team, away_team=away.team)
			SeasonMatchupHistory.objects.create(season_name=season_name, home_team=away.team, away_team=home.team)

		draw = start_or_resume(season=self.season, draw_seed='rule6-blocked')
		self.run_full_ceremony(draw)

		self.assert_draw_constraints(self.season)
		self.assertEqual(
			SeasonMatchup.objects.filter(
				season=self.season,
				home_team__team__in=[home.team, away.team],
				away_team__team__in=[home.team, away.team],
			).count(),
			0,
		)

	def test_ceremony_never_places_blocked_team_as_home(self):
		home, away = self.pot_entries(1)[:2]
		for season_name in ('2025-26', '2024-25'):
			SeasonMatchupHistory.objects.create(season_name=season_name, home_team=home.team, away_team=away.team)

		draw = start_or_resume(season=self.season, draw_seed='rule6-home')
		self.run_full_ceremony(draw)

		self.assert_draw_constraints(self.season)
		self.assertEqual(
			SeasonMatchup.objects.filter(season=self.season, home_team=home, away_team=away).count(),
			0,
		)

	def test_assign_opponents_is_deterministic_for_same_state(self):
		draw = start_or_resume(season=self.season, draw_seed='manual-1')
		team = self.pot_entries(1)[0]

		first = assign_opponents_for_pick(season=self.season, draw=draw, season_team=team)
		second = assign_opponents_for_pick(season=self.season, draw=draw, season_team=team)
		self.assertEqual(first, second)
		self.assertEqual(len(first), 8)

		pick_team(season=self.season, draw=draw, season_team_id=team.pk)
		for entry in self.pot_entries(1)[1:3]:
			pick_team(season=self.season, draw=draw, season_team_id=entry.pk)

		team2 = self.pot_entries(1)[3]
		third = assign_opponents_for_pick(season=self.season, draw=draw, season_team=team2)
		fourth = assign_opponents_for_pick(season=self.season, draw=draw, season_team=team2)
		self.assertEqual(third, fourth)

	def test_finalize_incomplete_draw_is_refused(self):
		draw = start_or_resume(season=self.season, draw_seed='manual-1')
		pick_team(season=self.season, draw=draw, season_team_id=self.pot_entries(1)[0].pk)

		with self.assertRaises(DrawError):
			finalize(draw)

		draw.refresh_from_db()
		self.assertEqual(draw.status, DrawStatusChoices.RUNNING)
		self.assertEqual(SeasonMatchup.objects.filter(season=self.season, matchday__isnull=False).count(), 0)

	def test_finalize_is_idempotent_after_auto_finalize(self):
		draw = start_or_resume(season=self.season, draw_seed='manual-1')
		self.run_full_ceremony(draw)

		draw = finalize(draw)
		self.assertEqual(draw.status, DrawStatusChoices.COMPLETED)
		self.assertEqual(SeasonMatchup.objects.filter(season=self.season).count(), 144)

	def test_full_ceremony_on_real_seed_data_holds_constraints(self):
		data_path = Path(__file__).resolve().parent / 'data' / 'ucl_league_phase_seed_input_2025_26.json'
		payload = json.loads(data_path.read_text(encoding='utf-8'))
		import_seed_input_payload(payload, set_active=True)
		season = Season.objects.get(name=payload['season']['name'])
		seed_season_entries(season)

		draw = start_or_resume(season=season, draw_seed='manual-real')
		for pot in range(1, 5):
			for entry in SeasonTeam.objects.filter(season=season, pot=pot).order_by('seeding_position'):
				pick_team(season=season, draw=draw, season_team_id=entry.pk)

		draw.refresh_from_db()
		self.assertEqual(draw.status, DrawStatusChoices.COMPLETED)
		self.assertEqual(draw.matchups_created, 144)
		self.assert_draw_constraints(season)


class DomesticStandingJoinTests(TestCase):
	def test_domestic_field_joins_latest_standing_and_returns_none_when_unmatched(self):
		assoc = Association.objects.create(name='Italy', code='ITA')
		season = Season.objects.create(name='2025-26')

		como = Team.objects.create(name='Como', short_name='Como', association=assoc)
		entry = SeasonTeam.objects.create(season=season, team=como, uefa_club_coefficient=Decimal('6.000'))

		shakhtar = Team.objects.create(name='Shakhtar Donetsk', short_name='Shakhtar', association=assoc)
		entry2 = SeasonTeam.objects.create(season=season, team=shakhtar, uefa_club_coefficient=Decimal('35.000'))

		league = League.objects.create(code='SA', name='Serie A', country='Italy')
		LeagueStanding.objects.create(
			league=league,
			season_year=2025,
			position=2,
			team_name='Como',
			played=8,
			goals_for=10,
			goals_against=9,
			goal_difference=1,
		)
		LeagueStanding.objects.create(
			league=league,
			season_year=2026,
			position=4,
			team_name='Como',
			played=10,
			goals_for=12,
			goals_against=8,
			goal_difference=4,
		)

		self.assertEqual(
			CompactSeasonTeamSerializer(entry).data['domestic'],
			{
				'position': 4,
				'played': 10,
				'goals_for': 12,
				'goals_against': 8,
				'goal_difference': 4,
			},
		)
		# A team with no standing row for its association gets null.
		self.assertIsNone(CompactSeasonTeamSerializer(entry2).data['domestic'])


class RealPredictionSyncApiTests(APITestCase):
	"""Exercises /api/ui/seasons/<pk>/real-predictions/ against the real
	league-phase fixtures file (2026-27), which is what ships in the repo."""

	@staticmethod
	def _make_datetime_stub(fixed_now):
		"""Stub for draw.selectors.datetime: real parsing, pinned now()."""
		class _Stub:
			fromisoformat = staticmethod(datetime.fromisoformat)

			@staticmethod
			def now(tz=None):
				return fixed_now

		return _Stub

	def setUp(self):
		self.season = Season.objects.create(name='2026-27')
		# The real-fixtures view iterates every fixture in the shipped JSON and
		# 404s when a team is missing, so the whole 36-team field must exist.
		with open(
			Path(__file__).resolve().parent / 'data' / 'ucl_league_phase_real_fixtures_2026_27.json',
			encoding='utf-8',
		) as f:
			fixtures = json.load(f)['fixtures']
		team_names = sorted({fx['home'] for fx in fixtures} | {fx['away'] for fx in fixtures})
		assert len(team_names) == 36
		for index, name in enumerate(team_names):
			association = Association.objects.create(name=name, code=f'{index + 1:03}')
			team = Team.objects.create(name=name, short_name=name[:3], association=association)
			SeasonTeam.objects.create(
				season=self.season,
				team=team,
				uefa_club_coefficient=Decimal('50.000'),
			)
		# Matchday 1 kickoffs are 2026-09-08 (Paris) -> closed after
		# 2026-09-08T16:35Z; matchday 8 kicks off 2027-01-27.

	def test_put_saves_predictions_and_get_returns_them(self):
		now = datetime(2026, 1, 1, tzinfo=timezone.utc)
		with mock.patch('draw.selectors.datetime', self._make_datetime_stub(now)):
			url = reverse('draw:ui-season-real-predictions', args=[self.season.pk])
			response = self.client.put(
				url,
				{
					'player_name': 'Tester',
					'predictions': [
						{'id': 'real-1-1', 'home_goals': 2, 'away_goals': 1},
						{'id': 'real-8-1', 'home_goals': 0, 'away_goals': 0},
					],
				},
				format='json',
			)

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.data, {'synced': 2})
		self.assertEqual(RealFixturePrediction.objects.count(), 2)

		with mock.patch('draw.selectors.datetime', self._make_datetime_stub(now)):
			response = self.client.get(url, {'player_name': 'Tester'})

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.data['player_name'], 'Tester')
		self.assertEqual({p['id'] for p in response.data['predictions']}, {'real-1-1', 'real-8-1'})
		by_id = {p['id']: p for p in response.data['predictions']}
		self.assertEqual(by_id['real-1-1']['home_goals'], 2)
		self.assertEqual(by_id['real-1-1']['away_goals'], 1)

	def test_put_with_closed_fixture_is_rejected_and_saves_nothing(self):
		# After matchday 1 has kicked off, real-1-1 is closed but real-8-1 is not.
		now = datetime(2026, 9, 9, tzinfo=timezone.utc)
		with mock.patch('draw.selectors.datetime', self._make_datetime_stub(now)):
			url = reverse('draw:ui-season-real-predictions', args=[self.season.pk])
			response = self.client.put(
				url,
				{
					'player_name': 'Tester',
					'predictions': [
						{'id': 'real-1-1', 'home_goals': 2, 'away_goals': 1},
						{'id': 'real-8-1', 'home_goals': 0, 'away_goals': 0},
					],
				},
				format='json',
			)

		self.assertEqual(response.status_code, 400)
		self.assertEqual(response.data['detail'], 'Prediction closed for some fixtures')
		self.assertEqual(response.data['closed'], ['real-1-1'])
		self.assertEqual(RealFixturePrediction.objects.count(), 0)

	def test_get_unknown_player_returns_empty_predictions(self):
		url = reverse('draw:ui-season-real-predictions', args=[self.season.pk])
		response = self.client.get(url, {'player_name': 'Nobody'})

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.data, {'player_name': 'Nobody', 'predictions': []})

	def test_fixtures_endpoint_merges_db_result_over_static_json(self):
		RealFixtureResult.objects.create(fixture_id='real-1-1', home_goals=4, away_goals=0)

		response = self.client.get(reverse('draw:ui-season-real-fixtures', args=[self.season.pk]))

		self.assertEqual(response.status_code, 200)
		self.assertEqual(len(response.data['matchups']), 144)
		by_id = {m['id']: m for m in response.data['matchups']}
		# The shipped JSON carries a static 1-0 for real-1-1; the DB must win.
		self.assertEqual(by_id['real-1-1']['result'], {'home_goals': 4, 'away_goals': 0})

	def test_fixtures_endpoint_falls_back_to_static_json_result(self):
		response = self.client.get(reverse('draw:ui-season-real-fixtures', args=[self.season.pk]))

		self.assertEqual(response.status_code, 200)
		by_id = {m['id']: m for m in response.data['matchups']}
		# No DB row: the checked-in static result (AEK Athens 1-0 LASK) is served.
		self.assertEqual(by_id['real-1-1']['result'], {'home_goals': 1, 'away_goals': 0})
		# A fixture with no result anywhere stays null.
		self.assertIsNone(by_id['real-8-1']['result'])

	def test_live_scores_maps_in_play_matches_to_fixture_ids(self):
		url = reverse('draw:ui-season-live-scores', args=[self.season.pk])
		with mock.patch('draw.views.fetch_promiedos_live_html', return_value='cached'):
			with mock.patch('draw.views.parse_promiedos_live', return_value=[
				{'home': 'fc barcelona', 'away': 'feyenoord', 'home_goals': 2, 'away_goals': 0, 'status': "28'"},
				{'home': 'not a team', 'away': 'either', 'home_goals': 0, 'away_goals': 0, 'status': 'HT'},
			]):
				response = self.client.get(url)

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.data, {
			'live': {
				'real-1-7': {'home_goals': 2, 'away_goals': 0, 'status': "28'"},
			},
		})

	def test_live_scores_unreachable_source_returns_502(self):
		url = reverse('draw:ui-season-live-scores', args=[self.season.pk])
		with mock.patch('draw.views.fetch_promiedos_live_html', side_effect=RuntimeError('boom')):
			response = self.client.get(url)

		self.assertEqual(response.status_code, 502)
		self.assertEqual(response.data['live'], {})


class MatchDetailsApiTests(APITestCase):
	"""Tests for GET /api/ui/seasons/<pk>/match-details/<fixture_id>/"""

	@staticmethod
	def _make_datetime_stub(fixed_now):
		"""Stub for draw.views.datetime: real parsing, pinned now()."""
		class _Stub:
			fromisoformat = staticmethod(datetime.fromisoformat)

			@staticmethod
			def now(tz=None):
				return fixed_now

		return _Stub

	def setUp(self):
		from draw.services.match_details import clear_listing_cache
		clear_listing_cache()

		self.season = Season.objects.create(name='2026-27')
		with open(
			Path(__file__).resolve().parent / 'data' / 'ucl_league_phase_real_fixtures_2026_27.json',
			encoding='utf-8',
		) as f:
			fixtures = json.load(f)['fixtures']
		team_names = sorted({fx['home'] for fx in fixtures} | {fx['away'] for fx in fixtures})
		assert len(team_names) == 36
		for index, name in enumerate(team_names):
			association = Association.objects.create(name=name, code=f'{index + 1:03}')
			team = Team.objects.create(name=name, short_name=name[:3], association=association)
			SeasonTeam.objects.create(
				season=self.season,
				team=team,
				uefa_club_coefficient=Decimal('50.000'),
			)

		# Fake fixture list for patched _load_real_fixtures
		self._fake_fixtures = [
			{
				'id': 'real-1-1',
				'home_team': {'name': 'AEK Athens', 'logo_url': 'http://test/aek.png'},
				'away_team': {'name': 'LASK', 'logo_url': 'http://test/lask.png'},
				'matchday': 1,
				'home_goals': 1,
				'away_goals': 0,
				'status': 'SCHEDULED',
				'kickoff': '2026-09-08T18:45:00Z',
				'result': {'home_goals': 1, 'away_goals': 0},
				'closed': True,
			},
			{
				'id': 'real-8-1',
				'home_team': {'name': 'AEK Athens', 'logo_url': 'http://test/aek.png'},
				'away_team': {'name': 'LASK', 'logo_url': 'http://test/lask.png'},
				'matchday': 8,
				'home_goals': None,
				'away_goals': None,
				'status': 'SCHEDULED',
				'kickoff': '2027-01-27T21:00:00Z',
				'result': None,
				'closed': False,
			},
		]

		# Fake football-data listing for patched load_football_data_listing
		self._fake_listing = {
			'matches': [
				{
					'stage': 'LEAGUE_STAGE',
					'matchday': 1,
					'status': 'FINISHED',
					'homeTeam': {'name': 'AEK Athens'},
					'awayTeam': {'name': 'LASK'},
					'score': {'fullTime': {'home': 1, 'away': 0}},
					'venue': 'Agia Sophia Stadium',
					'referees': [{'name': 'S. Marciniak', 'type': 'REFEREE'}],
					'odds': {'homeWin': 2.1, 'draw': 3.4, 'awayWin': 3.5},
					'utcDate': '2026-09-08T16:45:00Z',
				},
			],
		}

	def _get(self, fixture_id, now):
		with mock.patch('draw.views.datetime', self._make_datetime_stub(now)):
			with mock.patch('draw.views.load_real_fixtures', return_value=self._fake_fixtures):
				return self.client.get(
					reverse('draw:ui-season-match-details', args=[self.season.pk, fixture_id])
				)

	def test_played_fixture_returns_200_with_header_and_detail(self):
		now = datetime(2026, 9, 9, tzinfo=timezone.utc)
		with mock.patch(
			'draw.views.load_football_data_listing',
			return_value=self._fake_listing,
		):
			response = self._get('real-1-1', now)

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.data['header']['status'], 'FINISHED')
		self.assertEqual(response.data['header']['score']['home_goals'], 1)
		self.assertEqual(response.data['header']['score']['away_goals'], 0)
		self.assertIsNotNone(response.data['detail'])
		self.assertEqual(response.data['detail']['venue'], 'Agia Sophia Stadium')
		self.assertEqual(response.data['detail']['referees'][0]['name'], 'S. Marciniak')
		self.assertEqual(response.data['detail']['odds']['homeWin'], 2.1)
		self.assertIsNone(response.data['timeline'])
		self.assertIsNone(response.data['lineups'])

	def test_scheduled_fixture_returns_404(self):
		now = datetime(2026, 1, 1, tzinfo=timezone.utc)
		response = self._get('real-8-1', now)
		self.assertEqual(response.status_code, 404)

	def test_unknown_fixture_id_returns_404(self):
		now = datetime(2026, 9, 9, tzinfo=timezone.utc)
		response = self._get('real-99-99', now)
		self.assertEqual(response.status_code, 404)

	def test_missing_season_returns_404(self):
		now = datetime(2026, 9, 9, tzinfo=timezone.utc)
		with mock.patch('draw.views.datetime', self._make_datetime_stub(now)):
			with mock.patch('draw.views.load_real_fixtures', return_value=self._fake_fixtures):
				response = self.client.get(
					reverse('draw:ui-season-match-details', args=[9999, 'real-1-1'])
				)
		self.assertEqual(response.status_code, 404)

	def test_upstream_failure_returns_200_with_detail_error(self):
		now = datetime(2026, 9, 9, tzinfo=timezone.utc)
		with mock.patch(
			'draw.views.load_football_data_listing',
			side_effect=RuntimeError('football-data fetch failed'),
		):
			response = self._get('real-1-1', now)

		self.assertEqual(response.status_code, 200)
		self.assertIsNone(response.data['detail'])
		self.assertIn('Upstream listing unavailable', response.data['detail_error'])
		self.assertIsNotNone(response.data['header'])

	def test_unmapped_teams_returns_200_with_detail_error(self):
		now = datetime(2026, 9, 9, tzinfo=timezone.utc)
		empty_listing = {'matches': []}
		with mock.patch(
			'draw.views.load_football_data_listing',
			return_value=empty_listing,
		):
			response = self._get('real-1-1', now)

		self.assertEqual(response.status_code, 200)
		self.assertIsNone(response.data['detail'])
		self.assertIn('No football-data mapping found', response.data['detail_error'])

	def test_cache_reuse_across_two_loads(self):
		from draw.services.match_details import load_football_data_listing
		with mock.patch.dict('os.environ', {'API_FOOTBALL_DATA_KEY': 'test-key'}):
			with mock.patch(
				'draw.services.match_details.fetch_football_data',
				return_value=self._fake_listing,
			) as mock_fetch:
				load_football_data_listing('2026-27')
				load_football_data_listing('2026-27')
				self.assertEqual(mock_fetch.call_count, 1)

	def test_clear_listing_cache_resets_state(self):
		from draw.services.match_details import load_football_data_listing, clear_listing_cache
		with mock.patch.dict('os.environ', {'API_FOOTBALL_DATA_KEY': 'test-key'}):
			with mock.patch(
				'draw.services.match_details.fetch_football_data',
				return_value=self._fake_listing,
			) as mock_fetch:
				load_football_data_listing('2026-27')
				self.assertEqual(mock_fetch.call_count, 1)
				clear_listing_cache()
				load_football_data_listing('2026-27')
				self.assertEqual(mock_fetch.call_count, 2)


class LeagueMatchDetailsApiTests(APITestCase):
	"""Tests for GET /api/leagues/<league_id>/matches/<match_id>/details/"""

	def setUp(self):
		from draw.services.match_details import clear_listing_cache
		clear_listing_cache()

		self.league = League.objects.create(name='Premier League', code='PL', country='England')
		self.other_league = League.objects.create(name='Bundesliga', code='BL1', country='Germany')
		kickoff = datetime(2026, 3, 15, 14, 0, tzinfo=timezone.utc)
		self.match = LeagueMatch.objects.create(
			league=self.league,
			match_id=500001,
			home_name='Arsenal',
			away_name='Chelsea',
			home_short='ARS',
			away_short='CHE',
			home_crest='https://crests.example/arsenal.png',
			away_crest='https://crests.example/chelsea.png',
			kickoff=kickoff,
			status='FINISHED',
			matchday=29,
			home_goals=2,
			away_goals=1,
		)
		# Same fixture id would 404 through the league filter; this one exists
		# under a different league and must not resolve.
		LeagueMatch.objects.create(
			league=self.other_league,
			match_id=500002,
			home_name='Bayern',
			away_name='Dortmund',
			kickoff=kickoff,
			status='FINISHED',
			home_goals=1,
			away_goals=1,
		)

		# Fake football-data league listing (matched by fixture id).
		self._fake_listing = {
			'matches': [
				{
					'id': 500001,
					'matchday': 29,
					'status': 'FINISHED',
					'homeTeam': {'name': 'Arsenal'},
					'awayTeam': {'name': 'Chelsea'},
					'score': {
						'fullTime': {'home': 2, 'away': 1},
						'halfTime': {'home': 1, 'away': 0},
					},
					'referees': [{'name': 'M. Oliver', 'type': 'REFEREE'}],
					'utcDate': '2026-03-15T14:00:00Z',
				},
			],
		}

	def _url(self, match_id):
		return reverse('draw:league-match-details', args=[self.league.pk, match_id])

	def test_finished_match_returns_referees_and_half_time(self):
		with mock.patch.dict('os.environ', {'API_FOOTBALL_DATA_KEY': 'test-key'}):
			with mock.patch(
				'draw.services.match_details.fetch_competition_matches',
				return_value=self._fake_listing,
			):
				response = self.client.get(self._url(500001))

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.data['header']['status'], 'FINISHED')
		self.assertEqual(response.data['header']['score'], {'home_goals': 2, 'away_goals': 1})
		self.assertEqual(response.data['header']['matchday'], 29)
		self.assertEqual(response.data['header']['home_team']['name'], 'Arsenal')
		self.assertIsNone(response.data['detail_error'])
		self.assertEqual(response.data['detail']['referees'][0]['name'], 'M. Oliver')
		self.assertEqual(
			response.data['detail']['half_time'],
			{'home_goals': 1, 'away_goals': 0},
		)
		# This API plan carries no venue/odds for leagues: the envelope omits
		# both keys so the UI cannot render empty rows.
		self.assertNotIn('venue', response.data['detail'])
		self.assertNotIn('odds', response.data['detail'])
		self.assertIsNone(response.data['timeline'])
		self.assertIsNone(response.data['lineups'])

	def test_foreign_or_unknown_match_id_returns_404(self):
		self.assertEqual(self.client.get(self._url(500002)).status_code, 404)
		self.assertEqual(self.client.get(self._url(999999)).status_code, 404)

	def test_missing_api_key_returns_detail_error_not_500(self):
		# Empty key makes load_football_data_league raise before any network
		# call, which the view must degrade to detail_error.
		with mock.patch.dict('os.environ', {'API_FOOTBALL_DATA_KEY': ''}):
			response = self.client.get(self._url(500001))

		self.assertEqual(response.status_code, 200)
		self.assertIsNone(response.data['detail'])
		self.assertIn('Upstream listing unavailable', response.data['detail_error'])
		self.assertIsNotNone(response.data['header'])


class SyncRealFixtureResultsTests(TestCase):
	def test_parse_schedule_keeps_played_league_phase_rows_only(self):
		from draw.management.commands.sync_real_fixture_results import parse_schedule

		html_text = '''
		<table>
			<tr><td>League phase</td><td>1</td><td>Tue</td><td>2026-09-08</td><td>21:00</td>
				<td><a href="/en/squads/abc/RB-Leipzig">RB Leipzig</a> de</td>
				<td>2&ndash;1</td>
				<td><a href="/en/squads/def/PSV-Eindhoven">PSV</a> nl</td></tr>
			<tr><td>League phase</td><td>1</td><td>Tue</td><td>2026-09-08</td><td>21:00</td>
				<td><a href="/en/squads/ghi/Feyenoord">Feyenoord</a></td>
				<td></td>
				<td><a href="/en/squads/jkl/Como">Como</a></td></tr>
			<tr><td>Third qualifying round</td><td>Wed</td><td>2026-08-05</td><td>19:10</td>
				<td><a href="/en/squads/mno/AGF">AGF</a></td>
				<td>2&ndash;1</td>
				<td><a href="/en/squads/pqr/Sabah-FK">Sabah FK</a></td></tr>
		</table>
		'''
		matches = parse_schedule(html_text)
		self.assertEqual(matches, [{
			'home': 'RB Leipzig', 'away': 'PSV',
			'home_goals': 2, 'away_goals': 1,
	}])

	def test_match_results_pairs_by_normalized_names(self):
		from draw.management.commands.sync_real_fixture_results import match_results, normalize

		self.assertEqual(normalize('Bodø/Glimt'), 'bodo/glimt')
		self.assertEqual(normalize('Bayern Munich'), 'bayern munich')

		data = {'fixtures': [
			{'home': 'RB Leipzig', 'away': 'PSV Eindhoven', 'result': None},
			{'home': 'Bodo/Glimt', 'away': 'Bayern Munchen', 'result': None},
		]}
		matches = [
			{'home': 'Bodø/Glimt', 'away': 'Bayern Munich', 'home_goals': 3, 'away_goals': 2},
		]
		updates, unmatched = match_results(data, matches)
		self.assertEqual(unmatched, [])
		self.assertEqual(updates[0]['index'], 1)
		self.assertEqual(updates[0]['home_goals'], 3)
		self.assertEqual(updates[0]['away_goals'], 2)

	def test_football_data_parser_keeps_finished_league_stage_only(self):
		from draw.management.commands.sync_real_fixture_results import parse_football_data

		payload = {'matches': [
			{
				'stage': 'LEAGUE_STAGE', 'matchday': 1, 'status': 'FINISHED',
				'homeTeam': {'name': 'FC Bayern München'},
				'awayTeam': {'name': 'Club Brugge KV'},
				'score': {'fullTime': {'home': 2, 'away': 1}},
			},
			{
				'stage': 'LEAGUE_STAGE', 'matchday': 1, 'status': 'IN_PLAY',
				'homeTeam': {'name': 'Real Madrid CF'},
				'awayTeam': {'name': 'FC Internazionale Milano'},
				'score': {'fullTime': {'home': 1, 'away': 0}},
			},
			{
				'stage': 'LEAGUE_STAGE', 'matchday': 1, 'status': 'FINISHED',
				'homeTeam': {'name': 'Arsenal FC'},
				'awayTeam': {'name': 'PSV'},
				'score': {'fullTime': None},
			},
			{
				'stage': 'KNOCKOUT_STAGE', 'matchday': 9, 'status': 'FINISHED',
				'homeTeam': {'name': 'Real Madrid CF'},
				'awayTeam': {'name': 'FC Barcelona'},
				'score': {'fullTime': {'home': 3, 'away': 3}},
			},
		]}
		matches = parse_football_data(payload)
		self.assertEqual(matches, [{
			'home': 'FC Bayern München', 'away': 'Club Brugge KV',
			'home_goals': 2, 'away_goals': 1,
		}])

	def test_football_data_aliases_resolve_to_fixture_names(self):
		from draw.management.commands.sync_real_fixture_results import resolve

		self.assertEqual(resolve('FC Bayern München'), 'bayern munchen')
		self.assertEqual(resolve('Club Atlético de Madrid'), 'atletico madrid')
		self.assertEqual(resolve('FC Internazionale Milano'), 'inter')
		self.assertEqual(resolve('PAE AEK'), 'aek athens')
		self.assertEqual(resolve('ŠK Slovan Bratislava'), 'slovan bratislava')
		self.assertEqual(resolve('Sporting Clube de Portugal'), 'sporting cp')
		self.assertEqual(resolve('AS Roma'), 'as roma')

	def test_parse_promiedos_keeps_finished_matches_only(self):
		import json
		from draw.management.commands.sync_real_fixture_results import parse_promiedos

		payload = {
			'props': {'pageProps': {'data': {'games': {'filters': [
				{'name': 'Partidos actuales', 'games': [
					{'id': 'a', 'game_time_status_to_display': 'Final',
					 'teams': [{'name': 'Brujas', 'url_name': 'club-brugge'},
					           {'name': 'Aston Villa', 'url_name': 'aston-villa'}],
					 'scores': [2, 3]},
					{'id': 'b', 'game_time_status_to_display': 'Prog.',
					 'teams': [{'name': 'FC Porto', 'url_name': 'fc-porto'},
					           {'name': 'Manchester City', 'url_name': 'manchester-city'}],
					 'scores': []},
					{'id': 'c', 'game_time_status_to_display': 'Final',
					 'teams': [{'name': 'AEK Atenas', 'url_name': 'aek-athens'},
					           {'name': 'LASK Linz', 'url_name': 'lask-linz'}],
					 'scores': [1, 0]},
				]},
			]}}},
		}}
		html_text = (
			'<div id="root"></div>'
			'<script id="__NEXT_DATA__" type="application/json">'
			f'{json.dumps(payload)}'
			'</script>'
		)
		matches = parse_promiedos(html_text)
		self.assertEqual(matches, [
			{'home': 'club brugge', 'away': 'aston villa', 'home_goals': 2, 'away_goals': 3},
			{'home': 'aek athens', 'away': 'lask linz', 'home_goals': 1, 'away_goals': 0},
		])

	def test_parse_promiedos_live_keeps_in_play_matches_only(self):
		import json
		from draw.management.commands.sync_real_fixture_results import parse_promiedos_live

		payload = {
			'props': {'pageProps': {'data': {'games': {'filters': [
				{'name': 'Partidos actuales', 'games': [
					{'id': 'a', 'game_time_status_to_display': 'Final',
					 'teams': [{'name': 'Brujas', 'url_name': 'club-brugge'},
					           {'name': 'Aston Villa', 'url_name': 'aston-villa'}],
					 'scores': [2, 3]},
					{'id': 'b', 'game_time_status_to_display': 'Prog.',
					 'teams': [{'name': 'FC Porto', 'url_name': 'fc-porto'},
					           {'name': 'Manchester City', 'url_name': 'manchester-city'}],
					 'scores': []},
					{'id': 'c', 'game_time_status_to_display': "28'",
					 'teams': [{'name': 'Stuttgart', 'url_name': 'stuttgart'},
					           {'name': 'Viking', 'url_name': 'viking'}],
					 'scores': [2, 1]},
				]},
			]}}},
		}}
		html_text = (
			'<div id="root"></div>'
			'<script id="__NEXT_DATA__" type="application/json">'
			f'{json.dumps(payload)}'
			'</script>'
		)
		matches = parse_promiedos_live(html_text)
		self.assertEqual(matches, [
			{'home': 'stuttgart', 'away': 'viking', 'home_goals': 2, 'away_goals': 1, 'status': "28'"},
		])

	def test_promiedos_names_resolve_to_fixture_names(self):
		from draw.management.commands.sync_real_fixture_results import resolve

		self.assertEqual(resolve('club brugge'), 'club brugge kv')
		self.assertEqual(resolve('aek athens'), 'aek athens')
		self.assertEqual(resolve('lask linz'), 'lask')
		self.assertEqual(resolve('fc porto'), 'porto')
		self.assertEqual(resolve('inter milan'), 'inter')
		self.assertEqual(resolve('fc barcelona'), 'barcelona')
		self.assertEqual(resolve('bayern munich'), 'bayern munchen')
		self.assertEqual(resolve('bodo glimt'), 'bodo/glimt')
		self.assertEqual(resolve('fenerbahce sk'), 'fenerbahce')
		self.assertEqual(resolve('stuttgart'), 'vfb stuttgart')
		self.assertEqual(resolve('viking'), 'viking fk')
		self.assertEqual(resolve('lens'), 'rc lens')
		self.assertEqual(resolve('psg'), 'paris saint germain')

	def test_sync_persists_results_and_never_writes_fixtures_json(self):
		import json

		fixtures_path = (
			Path(__file__).resolve().parent / 'data' / 'ucl_league_phase_real_fixtures_2026_27.json'
		)
		payload = {
			'props': {'pageProps': {'data': {'games': {'filters': [
				{'name': 'Partidos actuales', 'games': [
					{'id': 'a', 'game_time_status_to_display': 'Final',
					 'teams': [{'name': 'AEK Atenas', 'url_name': 'aek-athens'},
					           {'name': 'LASK Linz', 'url_name': 'lask-linz'}],
					 'scores': [3, 1]},
				]},
			]}}},
		}}
		html_text = (
			'<div id="root"></div>'
			'<script id="__NEXT_DATA__" type="application/json">'
			f'{json.dumps(payload)}'
			'</script>'
		)

		with TemporaryDirectory() as tmp:
			copied = Path(tmp) / 'fixtures.json'
			copied.write_bytes(fixtures_path.read_bytes())
			before = copied.read_bytes()

			with mock.patch(
				'draw.management.commands.sync_real_fixture_results.fetch',
				return_value=html_text,
			):
				call_command(
					'sync_real_fixture_results',
					'--source', 'promiedos',
					'--fixtures-json', str(copied),
				)

			# The calendar is static: a sync must never rewrite it.
			self.assertEqual(copied.read_bytes(), before)

		# The result landed in Postgres under the fixture id the API serves.
		result = RealFixtureResult.objects.get(fixture_id='real-1-1')
		self.assertEqual((result.home_goals, result.away_goals), (3, 1))


class LeagueFixtureListAPITests(APITestCase):
    def setUp(self):
        self.league = League.objects.create(name='Premier League', code='PL', country='England')
        self.client.force_authenticate(user=User.objects.create_user('t'))

    def _fixture(self, match_id, home, away, kickoff, status, home_goals=None, away_goals=None):
        return LeagueMatch.objects.create(
            league=self.league,
            match_id=match_id,
            home_name=home,
            away_name=away,
            home_short=home,
            away_short=away,
            kickoff=kickoff,
            status=status,
            home_goals=home_goals,
            away_goals=away_goals,
        )

    def test_finished_and_upcoming_split(self):
        now = datetime.now(timezone.utc)
        self._fixture(1, 'Arsenal', 'Chelsea', now - timedelta(days=1), 'FINISHED', 2, 1)
        self._fixture(2, 'Man City', 'Liverpool', now + timedelta(hours=2), 'TIMED', None, None)
        self._fixture(3, 'Spurs', 'Villa', now + timedelta(days=3), 'SCHEDULED', None, None)

        resp = self.client.get(f'/api/leagues/{self.league.id}/matches/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual([(m['home_name'], m['result']) for m in data['finished']], [('Arsenal', {'home_goals': 2, 'away_goals': 1})])
        self.assertEqual(
            [m['home_name'] for m in data['upcoming']],
            ['Man City', 'Spurs'],
        )

    def test_result_null_when_no_score(self):
        self._fixture(4, 'A', 'B', datetime.now(timezone.utc) + timedelta(days=2), 'SCHEDULED')
        resp = self.client.get(f'/api/leagues/{self.league.id}/matches/')
        upcoming = resp.json()['upcoming']
        self.assertIsNone(upcoming[0]['result'])


class HomepageMatchesLeagueTests(APITestCase):
	def setUp(self):
		self.league = League.objects.create(
			name='Premier League',
			code='PL',
			country='England',
			emblem_url='https://crests.football-data.org/PL.png',
		)

	def _fixture(self, match_id, home, away, kickoff, status, home_goals=None, away_goals=None):
		return LeagueMatch.objects.create(
			league=self.league,
			match_id=match_id,
			home_name=home,
			away_name=away,
			home_short=home[:3],
			away_short=away[:3],
			home_crest='https://crests.example/arsenal.png',
			away_crest='https://crests.example/chelsea.png',
			kickoff=kickoff,
			status=status,
			home_goals=home_goals,
			away_goals=away_goals,
		)

	def _league_rows(self):
		resp = self.client.get('/api/homepage/matches/')
		self.assertEqual(resp.status_code, 200)
		return [r for r in resp.json()['matchups'] if r['id'].startswith('lm-')]

	def test_league_match_row_shape_and_derivations(self):
		now = datetime.now(timezone.utc)
		finished = self._fixture(9001, 'Arsenal', 'Chelsea', now - timedelta(days=1), 'FINISHED', 2, 1)
		scheduled = self._fixture(9002, 'Man City', 'Liverpool', now + timedelta(hours=2), 'TIMED', None, None)

		rows = {r['id']: r for r in self._league_rows()}
		row = rows[f'lm-{finished.match_id}']
		self.assertIsNone(row['season_id'])
		self.assertEqual(row['competition'], 'Premier League')
		self.assertEqual(row['competition_emblem'], 'https://crests.football-data.org/PL.png')
		self.assertTrue(row['openable'])
		self.assertEqual(row['league_id'], self.league.pk)
		self.assertEqual(row['home_team'], {
			'name': 'Arsenal',
			'short_name': 'Ars',
			'logo_url': 'https://crests.example/arsenal.png',
		})
		self.assertEqual(row['away_team'], {
			'name': 'Chelsea',
			'short_name': 'Che',
			'logo_url': 'https://crests.example/chelsea.png',
		})
		self.assertTrue(row['kickoff'].endswith('Z'))
		self.assertEqual(row['result'], {'home_goals': 2, 'away_goals': 1})
		self.assertTrue(row['closed'])
		self.assertEqual(row['status'], 'FINISHED')

		upcoming = rows[f'lm-{scheduled.match_id}']
		self.assertIsNone(upcoming['result'])
		self.assertFalse(upcoming['closed'])
		self.assertEqual(upcoming['status'], 'TIMED')

	def test_rows_without_kickoff_are_skipped(self):
		now = datetime.now(timezone.utc)
		self._fixture(9003, 'No', 'Kickoff', None, 'SCHEDULED')
		self._fixture(9004, 'Has', 'Kickoff', now, 'SCHEDULED')
		ids = {r['id'] for r in self._league_rows()}
		self.assertNotIn('lm-9003', ids)
		self.assertIn('lm-9004', ids)

	def test_league_row_without_emblem_sends_null(self):
		self.league.emblem_url = ''
		self.league.save(update_fields=['emblem_url'])
		self._fixture(9005, 'A', 'B', datetime.now(timezone.utc), 'SCHEDULED')
		rows = {r['id']: r for r in self._league_rows()}
		self.assertIsNone(rows['lm-9005']['competition_emblem'])

	def test_conmebol_row_carries_api_sports_emblem(self):
		association = Association.objects.create(name='Uruguay', code='URU')
		season = Season.objects.create(name='Libertadores 2026', competition='LIB')
		home = SeasonTeam.objects.create(
			season=season,
			team=Team.objects.create(name='Penarol', short_name='PEN', association=association),
			uefa_club_coefficient=Decimal('0.000'),
		)
		away = SeasonTeam.objects.create(
			season=season,
			team=Team.objects.create(name='Nacional', short_name='NAC', association=association),
			uefa_club_coefficient=Decimal('0.000'),
		)
		SeasonMatchup.objects.create(
			season=season,
			home_team=home,
			away_team=away,
			kickoff=datetime.now(timezone.utc),
			status='SCHEDULED',
		)

		resp = self.client.get('/api/homepage/matches/')
		row = next(r for r in resp.json()['matchups'] if r['id'].startswith('sm-'))
		self.assertEqual(row['competition'], 'Libertadores')
		self.assertEqual(row['competition_emblem'], 'https://media.api-sports.io/football/leagues/13.png')

	def test_ucl_row_carries_football_data_emblem(self):
		Season.objects.create(name='2026-27', competition='UCL')
		fake_fixtures = [{
			'id': 'real-1-1',
			'home_team': {'name': 'Arsenal', 'short_name': 'ARS', 'logo_url': ''},
			'away_team': {'name': 'Chelsea', 'short_name': 'CHE', 'logo_url': ''},
			'matchday': 1,
			'kickoff': '2026-09-19T19:00:00Z',
			'result': None,
			'closed': False,
			'status': 'SCHEDULED',
		}]
		with mock.patch('draw.views.load_real_fixtures', return_value=fake_fixtures):
			resp = self.client.get('/api/homepage/matches/')
		row = next(r for r in resp.json()['matchups'] if r['id'] == 'real-1-1')
		self.assertEqual(row['competition'], 'Champions League')
		self.assertEqual(row['competition_emblem'], 'https://crests.football-data.org/CL.png')


class LeagueMatchPredictionApiTests(APITestCase):
    """Tests for GET/PUT /api/leagues/<league_id>/predictions/."""

    def setUp(self):
        self.league = League.objects.create(name='Premier League', code='PL', country='England')
        self.other_league = League.objects.create(name='Bundesliga', code='BL1', country='Germany')
        now = datetime.now(timezone.utc)
        self.open_match = self._fixture(7001, 'Arsenal', 'Chelsea', now + timedelta(days=1), 'SCHEDULED')
        self.timed_match = self._fixture(7002, 'Spurs', 'Villa', now + timedelta(days=2), 'TIMED')
        self.finished_match = self._fixture(7003, 'Man City', 'Liverpool', now - timedelta(days=1), 'FINISHED', 2, 1)
        self.unscheduled_match = self._fixture(7004, 'Newcastle', 'Everton', None, 'SCHEDULED')

    def _fixture(self, match_id, home, away, kickoff, status, home_goals=None, away_goals=None):
        return LeagueMatch.objects.create(
            league=self.league,
            match_id=match_id,
            home_name=home,
            away_name=away,
            home_short=home[:3],
            away_short=away[:3],
            kickoff=kickoff,
            status=status,
            home_goals=home_goals,
            away_goals=away_goals,
        )

    def _url(self, league=None):
        return f'/api/leagues/{(league or self.league).pk}/predictions/'

    def test_put_saves_pick_and_get_returns_it(self):
        resp = self.client.put(
            self._url(),
            {
                'player_name': 'Ada',
                'predictions': [
                    {'match_id': self.open_match.match_id, 'home_goals': 2, 'away_goals': 1},
                    {'match_id': self.timed_match.match_id, 'home_goals': 0, 'away_goals': 0},
                ],
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data, {'synced': 2})
        self.assertEqual(LeagueMatchPrediction.objects.filter(player_name='Ada').count(), 2)

        resp = self.client.get(self._url(), {'player_name': 'Ada'})
        self.assertEqual(resp.status_code, 200)
        upcoming = {m['id']: m for m in resp.data['upcoming']}
        self.assertEqual(upcoming[self.open_match.match_id]['prediction'], {'home_goals': 2, 'away_goals': 1})
        self.assertFalse(upcoming[self.open_match.match_id]['closed'])

        # A finished fixture carries the real result, is closed, and has no pick.
        finished = {m['id']: m for m in resp.data['finished']}
        self.assertEqual(finished[self.finished_match.match_id]['result'], {'home_goals': 2, 'away_goals': 1})
        self.assertIsNone(finished[self.finished_match.match_id]['prediction'])
        self.assertTrue(finished[self.finished_match.match_id]['closed'])

    def test_put_upserts_an_existing_pick(self):
        url = self._url()
        self.client.put(
            url,
            {'player_name': 'Ada', 'predictions': [{'match_id': self.open_match.match_id, 'home_goals': 1, 'away_goals': 0}]},
            format='json',
        )
        self.client.put(
            url,
            {'player_name': 'Ada', 'predictions': [{'match_id': self.open_match.match_id, 'home_goals': 3, 'away_goals': 2}]},
            format='json',
        )
        self.assertEqual(LeagueMatchPrediction.objects.count(), 1)
        row = LeagueMatchPrediction.objects.get()
        self.assertEqual((row.home_goals, row.away_goals), (3, 2))

    def test_unique_constraint_rejects_second_pick_for_same_match_and_player(self):
        LeagueMatchPrediction.objects.create(match=self.open_match, player_name='Ada', home_goals=1, away_goals=0)
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                LeagueMatchPrediction.objects.create(match=self.open_match, player_name='Ada', home_goals=3, away_goals=3)
        self.assertEqual(LeagueMatchPrediction.objects.count(), 1)

        # Same player, different fixture and same fixture, different player stay legal.
        LeagueMatchPrediction.objects.create(match=self.timed_match, player_name='Ada', home_goals=1, away_goals=0)
        LeagueMatchPrediction.objects.create(match=self.open_match, player_name='Bob', home_goals=2, away_goals=2)
        self.assertEqual(LeagueMatchPrediction.objects.count(), 3)

    def test_closed_fixture_rejects_whole_batch_and_writes_nothing(self):
        resp = self.client.put(
            self._url(),
            {
                'player_name': 'Ada',
                'predictions': [
                    {'match_id': self.open_match.match_id, 'home_goals': 1, 'away_goals': 0},
                    {'match_id': self.finished_match.match_id, 'home_goals': 0, 'away_goals': 0},
                ],
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['detail'], 'Prediction closed for some fixtures')
        self.assertEqual(resp.data['closed'], [self.finished_match.match_id])
        self.assertEqual(LeagueMatchPrediction.objects.count(), 0)

    def test_unscheduled_fixture_rejects_whole_batch_and_writes_nothing(self):
        resp = self.client.put(
            self._url(),
            {
                'player_name': 'Ada',
                'predictions': [
                    {'match_id': self.open_match.match_id, 'home_goals': 1, 'away_goals': 0},
                    {'match_id': self.unscheduled_match.match_id, 'home_goals': 1, 'away_goals': 0},
                ],
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['detail'], 'Fixture not scheduled')
        self.assertEqual(resp.data['unscheduled'], [self.unscheduled_match.match_id])
        self.assertEqual(LeagueMatchPrediction.objects.count(), 0)

    def test_negative_or_non_numeric_score_is_rejected(self):
        for bad in (-1, 'abc', 1.5, True, '2.5'):
            with self.subTest(bad=bad):
                resp = self.client.put(
                    self._url(),
                    {
                        'player_name': 'Ada',
                        'predictions': [{'match_id': self.open_match.match_id, 'home_goals': bad, 'away_goals': 0}],
                    },
                    format='json',
                )
                self.assertEqual(resp.status_code, 400)
        self.assertEqual(LeagueMatchPrediction.objects.count(), 0)

    def test_fixture_from_another_league_is_unknown(self):
        foreign = LeagueMatch.objects.create(
            league=self.other_league,
            match_id=8001,
            home_name='Bayern',
            away_name='Dortmund',
            kickoff=datetime.now(timezone.utc) + timedelta(days=1),
            status='SCHEDULED',
        )
        resp = self.client.put(
            self._url(),
            {'player_name': 'Ada', 'predictions': [{'match_id': foreign.match_id, 'home_goals': 1, 'away_goals': 0}]},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn('Unknown fixture id', resp.data['detail'])

    def test_get_without_player_name_lists_fixtures_without_picks(self):
        resp = self.client.get(self._url())
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['player_name'], '')
        self.assertTrue(all(m['prediction'] is None for m in resp.data['upcoming']))
        self.assertTrue(all(m['prediction'] is None for m in resp.data['finished']))

    def test_in_play_fixture_is_only_in_in_play_bucket(self):
        live = self._fixture(7005, 'Brighton', 'Fulham', datetime.now(timezone.utc) - timedelta(minutes=20), 'IN_PLAY')
        resp = self.client.get(self._url())
        self.assertEqual(resp.status_code, 200)

        in_play = {m['id']: m for m in resp.data['inPlay']}
        self.assertIn(live.match_id, in_play)
        self.assertIsNone(in_play[live.match_id]['result'])
        self.assertTrue(in_play[live.match_id]['closed'])
        self.assertNotIn(live.match_id, {m['id'] for m in resp.data['finished']})
        self.assertNotIn(live.match_id, {m['id'] for m in resp.data['upcoming']})

    def test_finished_fixture_stays_out_of_in_play_bucket(self):
        resp = self.client.get(self._url())
        self.assertEqual(resp.status_code, 200)

        in_play_ids = {m['id'] for m in resp.data['inPlay']}
        finished_ids = {m['id'] for m in resp.data['finished']}
        self.assertIn(self.finished_match.match_id, finished_ids)
        self.assertNotIn(self.finished_match.match_id, in_play_ids)

    def test_put_requires_player_name(self):
        resp = self.client.put(
            self._url(),
            {'predictions': [{'match_id': self.open_match.match_id, 'home_goals': 1, 'away_goals': 0}]},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['detail'], 'player_name is required')
        self.assertEqual(LeagueMatchPrediction.objects.count(), 0)


class BootstrapSeasonCommandTests(TestCase):
	"""The deploy startup command: import + seed once, then keep the season active.

	It reads the checked-in 2026-27 seed file (never writes it), so these tests
	exercise the exact JSON production bootstraps from.
	"""

	def test_fresh_database_imports_seeds_and_activates(self):
		from io import StringIO

		out = StringIO()
		call_command('bootstrap_season', stdout=out)

		season = Season.objects.get(name='2026-27')
		self.assertTrue(season.is_active)
		self.assertEqual(Season.objects.filter(is_active=True).count(), 1)
		self.assertEqual(SeasonTeam.objects.filter(season=season).count(), 36)
		# Seeding ran: four pots of nine.
		self.assertEqual(
			{
				pot: SeasonTeam.objects.filter(season=season, pot=pot).count()
				for pot in range(1, 5)
			},
			{1: 9, 2: 9, 3: 9, 4: 9},
		)
		self.assertTrue(SeasonTeam.objects.filter(season=season, is_title_holder=True).exists())
		# The deploy log shows what happened.
		self.assertIn('2026-27', out.getvalue())

	def test_second_run_is_a_noop(self):
		call_command('bootstrap_season')
		season = Season.objects.get(name='2026-27')
		before = list(
			SeasonTeam.objects.filter(season=season)
			.order_by('pk')
			.values_list('pk', 'pot', 'seeding_position')
		)

		with mock.patch('draw.management.commands.bootstrap_season.call_command') as import_command:
			call_command('bootstrap_season')

		# No re-import: the import command is never invoked again.
		import_command.assert_not_called()
		after = list(
			SeasonTeam.objects.filter(season=season)
			.order_by('pk')
			.values_list('pk', 'pot', 'seeding_position')
		)
		self.assertEqual(after, before)
		self.assertTrue(Season.objects.get(name='2026-27').is_active)

	def test_existing_target_season_is_not_reimported_or_pruned(self):
		existing = Season.objects.create(name='2026-27', is_active=False)
		association = Association.objects.create(name='Marker', code='MRK')
		team = Team.objects.create(name='Marker FC', short_name='MRK', association=association)
		marker = SeasonTeam.objects.create(
			season=existing,
			team=team,
			uefa_club_coefficient=Decimal('1.000'),
		)

		call_command('bootstrap_season')

		marker.refresh_from_db()
		self.assertEqual(marker.season_id, existing.pk)
		self.assertEqual(SeasonTeam.objects.filter(season=existing).count(), 1)
		self.assertTrue(Season.objects.get(name='2026-27').is_active)

	def test_activates_target_and_deactivates_other_seasons(self):
		Season.objects.create(name='2024-25', is_active=True)
		Season.objects.create(name='2025-26', is_active=True)

		call_command('bootstrap_season')

		self.assertFalse(Season.objects.get(name='2024-25').is_active)
		self.assertFalse(Season.objects.get(name='2025-26').is_active)
		self.assertTrue(Season.objects.get(name='2026-27').is_active)
		self.assertEqual(Season.objects.filter(is_active=True).count(), 1)

	def test_missing_seed_file_fails_loudly(self):
		with self.assertRaises(CommandError):
			call_command('bootstrap_season', '--seed-file', 'does/not/exist.json')

		self.assertFalse(Season.objects.filter(name='2026-27').exists())
