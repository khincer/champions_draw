import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from django.contrib.auth.models import User
from django.core.management import call_command
from django.core.management.base import CommandError
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework.test import APITestCase

from .models import Association, DrawMethodChoices, DrawStatusChoices, InteractiveDrawPick, KnockoutPrediction, League, LeagueMatch, LeagueMatchPrediction, LeagueStanding, MatchPrediction, PlayoffPrediction, Prediction, QualifiedViaChoices, RealFixturePrediction, RealFixtureResult, ResultHistory, Season, SeasonDraw, SeasonMatchup, SeasonMatchupHistory, SeasonTeam, SquadPlayer, Team, TeamProfile, TeamStatLeader
from .serializers import CompactSeasonTeamSerializer
from .services.draw import DrawError, compute_forbidden_directions, generate_season_draw, previous_season_names
from .services.import_seed_input import import_seed_input_payload
from .services.interactive_draw import assign_opponents_for_pick, current_pot, finalize, pick_team, start_or_resume
from .services.result_history import record_result_history
from .services.seeding import SeedingError, seed_season_entries


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
		# A friendlies season has no two-season window; Rule 6 must skip it.
		self.assertIsNone(previous_season_names('Friendlies 2026'))


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


class RealDrawSeasonScopeTests(TestCase):
	"""The checked-in UCL calendar names its own season; anything else gets []."""

	def _fixtures(self, name, competition):
		from draw.selectors import load_real_fixtures

		season = Season.objects.create(name=name, competition=competition)
		return load_real_fixtures(season)

	def test_non_ucl_season_serves_no_real_fixtures(self):
		# Joining the UCL calendar against another competition's teams made every
		# lookup miss, so the endpoint 404'd with "Team not found in season: <team>".
		self.assertEqual(self._fixtures('Libertadores 2026', 'LIB'), [])

	def test_other_ucl_season_serves_nothing(self):
		# The calendar covers 2026-27 only; the previous UCL season has no file.
		self.assertEqual(self._fixtures('2025-26', 'UCL'), [])

	def test_the_calendar_season_is_not_refused_by_the_guard(self):
		# The guard must not swallow the season the calendar actually describes.
		# This season has no SeasonTeam rows, so it passes the guard and fails
		# later, in the team join -- which is what proves it was not refused.
		from rest_framework.exceptions import NotFound

		from draw.selectors import load_real_fixtures

		season = Season.objects.create(name='2026-27', competition='UCL')
		with self.assertRaises(NotFound):
			load_real_fixtures(season)


class HomepageKickoffClosedTests(TestCase):
	"""A naive kickoff must not take the whole homepage feed down."""

	def _closed(self, kickoff):
		from draw.views import _kickoff_closed

		return _kickoff_closed(kickoff)

	def test_naive_kickoff_does_not_raise(self):
		# SQLite hands back naive datetimes; comparing one against an aware `now`
		# raises, and that 500'd the entire feed rather than one row.
		naive_past = datetime(2026, 9, 24, 10, 0)
		naive_future = datetime(2099, 1, 1, 10, 0)

		self.assertIs(self._closed(naive_past), True)
		self.assertIs(self._closed(naive_future), False)

	def test_aware_kickoff_still_works(self):
		from datetime import timezone as tz

		aware_past = datetime(2026, 9, 24, 10, 0, tzinfo=tz.utc)
		aware_future = datetime(2099, 1, 1, 10, 0, tzinfo=tz.utc)

		self.assertIs(self._closed(aware_past), True)
		self.assertIs(self._closed(aware_future), False)

	def test_missing_kickoff_is_not_closed(self):
		self.assertIs(self._closed(None), False)


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


class RealFixtureHistoryTests(TestCase):
	"""The UCL result writer appends history alongside its upsert.

	Offline: the network boundary (``fetch``) is patched with a promiedos
	payload, exactly as ``SyncRealFixtureResultsTests`` does.
	"""

	def _run(self, home_goals, away_goals, *, dry_run=False):
		fixtures_path = (
			Path(__file__).resolve().parent / 'data' / 'ucl_league_phase_real_fixtures_2026_27.json'
		)
		payload = {
			'props': {'pageProps': {'data': {'games': {'filters': [
				{'name': 'Partidos actuales', 'games': [
					{'id': 'a', 'game_time_status_to_display': 'Final',
					 'teams': [{'name': 'AEK Atenas', 'url_name': 'aek-athens'},
					           {'name': 'LASK Linz', 'url_name': 'lask-linz'}],
					 'scores': [home_goals, away_goals]},
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
			args = [
				'sync_real_fixture_results',
				'--source', 'promiedos',
				'--fixtures-json', str(copied),
			]
			if dry_run:
				args.append('--dry-run')
			with mock.patch(
				'draw.management.commands.sync_real_fixture_results.fetch',
				return_value=html_text,
			):
				call_command(*args)

	def _history(self):
		return ResultHistory.objects.filter(source='promiedos', subject='real-1-1')

	def test_changed_score_appends_two_history_rows(self):
		self._run(3, 1)
		self._run(2, 0)

		self.assertEqual(self._history().count(), 2)
		self.assertEqual(
			set(self._history().values_list('home_goals', 'away_goals')),
			{(3, 1), (2, 0)},
		)
		row = self._history().order_by('id').first()
		self.assertEqual((row.competition, row.season_name), ('UCL', '2026-27'))

	def test_unchanged_rerun_appends_nothing(self):
		self._run(3, 1)

		self._run(3, 1)

		self.assertEqual(self._history().count(), 1)
		self.assertEqual(
			list(self._history().values_list('home_goals', 'away_goals')),
			[(3, 1)],
		)

	def test_dry_run_writes_no_history(self):
		self._run(3, 1)

		self._run(2, 0, dry_run=True)

		self.assertEqual(
			list(self._history().values_list('home_goals', 'away_goals')),
			[(3, 1)],
		)


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

	def test_friendlies_row_without_kickoff_is_skipped(self):
		"""S5c: an sm- SeasonMatchup with no kickoff is skipped, never rendered blank."""
		association = Association.objects.create(name='England', code='ENG')
		season = Season.objects.create(name='Friendlies 2026', competition='FRN')

		def add_matchup(marker, kickoff):
			home = SeasonTeam.objects.create(
				season=season,
				team=Team.objects.create(
					name=f'{marker} Home', short_name=f'{marker}H', association=association,
				),
				uefa_club_coefficient=Decimal('0.000'),
			)
			away = SeasonTeam.objects.create(
				season=season,
				team=Team.objects.create(
					name=f'{marker} Away', short_name=f'{marker}A', association=association,
				),
				uefa_club_coefficient=Decimal('0.000'),
			)
			return SeasonMatchup.objects.create(
				season=season, home_team=home, away_team=away,
				kickoff=kickoff, status='SCHEDULED',
			)

		no_kickoff = add_matchup('No', None)
		with_kickoff = add_matchup('Yes', datetime.now(timezone.utc))

		resp = self.client.get('/api/homepage/matches/')
		self.assertEqual(resp.status_code, 200)
		rows = {r['id'] for r in resp.json()['matchups'] if r['id'].startswith('sm-')}
		self.assertNotIn(f'sm-{no_kickoff.pk}', rows)
		self.assertIn(f'sm-{with_kickoff.pk}', rows)

	def test_non_ucl_season_labels_and_emblems(self):
		"""LIB/SUD stay byte-identical; FRN never inherits CONMEBOL's metadata."""
		def add_season(name, competition, code):
			association = Association.objects.create(name=f'{competition} Assoc', code=code)
			season = Season.objects.create(name=name, competition=competition)
			home = SeasonTeam.objects.create(
				season=season,
				team=Team.objects.create(name=f'{competition} Home', short_name='HOM', association=association),
				uefa_club_coefficient=Decimal('0.000'),
			)
			away = SeasonTeam.objects.create(
				season=season,
				team=Team.objects.create(name=f'{competition} Away', short_name='AWY', association=association),
				uefa_club_coefficient=Decimal('0.000'),
			)
			SeasonMatchup.objects.create(
				season=season, home_team=home, away_team=away,
				kickoff=datetime.now(timezone.utc), status='SCHEDULED',
			)

		add_season('Libertadores 2026', 'LIB', 'LBA')
		add_season('Sudamericana 2026', 'SUD', 'SUB')
		add_season('Friendlies 2026', 'FRN', 'FRA')

		resp = self.client.get('/api/homepage/matches/')
		by_label = {
			r['competition']: r
			for r in resp.json()['matchups']
			if r['id'].startswith('sm-')
		}
		self.assertEqual(
			by_label['Libertadores']['competition_emblem'],
			'https://media.api-sports.io/football/leagues/13.png',
		)
		self.assertEqual(
			by_label['Sudamericana']['competition_emblem'],
			'https://media.api-sports.io/football/leagues/11.png',
		)
		friendlies = by_label['International Friendlies']
		self.assertIsNone(friendlies['competition_emblem'])
		self.assertEqual(resp.status_code, 200)

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


class LeaguePicksMatchdayScopeTests(APITestCase):
	"""The picks page predicts one matchday and reports one matchday."""

	def setUp(self):
		self.league = League.objects.create(name='Premier League', code='PL', country='England')
		now = datetime.now(timezone.utc)
		for matchday, offset in ((5, -2), (6, 1)):
			for index in range(2):
				LeagueMatch.objects.create(
					league=self.league,
					match_id=matchday * 100 + index,
					home_name=f'H{matchday}{index}', away_name=f'A{matchday}{index}',
					home_short='H', away_short='A',
					kickoff=now + timedelta(days=offset, hours=index),
					status='FINISHED' if offset < 0 else 'SCHEDULED',
					home_goals=1 if offset < 0 else None,
					away_goals=0 if offset < 0 else None,
					matchday=matchday,
				)

	def _get(self):
		return self.client.get(f'/api/leagues/{self.league.pk}/predictions/')

	def test_upcoming_is_only_the_next_matchday(self):
		resp = self._get()

		self.assertEqual(resp.status_code, 200)
		self.assertEqual({m['matchday'] for m in resp.data['upcoming']}, {6})

	def test_finished_is_only_the_last_completed_matchday(self):
		resp = self._get()

		self.assertEqual({m['matchday'] for m in resp.data['finished']}, {5})


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

	def test_friendlies_season_is_left_inactive(self):
		"""A friendlies season must never become the served active season."""
		friendlies = Season.objects.create(name='Friendlies 2026', competition='FRN', is_active=False)

		call_command('bootstrap_season')

		friendlies.refresh_from_db()
		self.assertFalse(friendlies.is_active)
		self.assertEqual(Season.objects.filter(is_active=True).count(), 1)
		self.assertEqual(Season.objects.get(is_active=True).name, '2026-27')

	def test_missing_seed_file_fails_loudly(self):
		with self.assertRaises(CommandError):
			call_command('bootstrap_season', '--seed-file', 'does/not/exist.json')

		self.assertFalse(Season.objects.filter(name='2026-27').exists())


class LeagueListCompetitionTests(APITestCase):
	"""GET /api/leagues/ season entries: LIB/SUD byte-identical, FRN not CONMEBOL."""

	def test_lib_and_sud_entries_are_byte_identical(self):
		Season.objects.create(name='Libertadores 2026', competition='LIB')
		Season.objects.create(name='Sudamericana 2026', competition='SUD')
		lib = Season.objects.get(name='Libertadores 2026')
		sud = Season.objects.get(name='Sudamericana 2026')

		resp = self.client.get('/api/leagues/')
		self.assertEqual(resp.status_code, 200)
		entries = {e['code']: e for e in resp.json() if e.get('kind') == 'season'}
		self.assertEqual(entries['LIB'], {
			'id': f'season-{lib.pk}',
			'code': 'LIB',
			'name': 'Libertadores 2026',
			'country': 'CONMEBOL',
			'emblem_url': 'https://media.api-sports.io/football/leagues/13.png',
			'kind': 'season',
			'season_id': lib.pk,
		})
		self.assertEqual(entries['SUD'], {
			'id': f'season-{sud.pk}',
			'code': 'SUD',
			'name': 'Sudamericana 2026',
			'country': 'CONMEBOL',
			'emblem_url': 'https://media.api-sports.io/football/leagues/11.png',
			'kind': 'season',
			'season_id': sud.pk,
		})

	def test_friendlies_entry_is_not_conmebol_labelled(self):
		season = Season.objects.create(name='Friendlies 2026', competition='FRN')

		resp = self.client.get('/api/leagues/')
		entry = next(e for e in resp.json() if e.get('code') == 'FRN')
		self.assertEqual(entry['id'], f'season-{season.pk}')
		self.assertEqual(entry['name'], 'Friendlies 2026')
		self.assertEqual(entry['country'], 'International')
		self.assertNotEqual(entry['country'], 'CONMEBOL')
		self.assertIsNone(entry['emblem_url'])


class FriendliesGroupStandingsTests(APITestCase):
	def test_frn_standings_return_empty_groups(self):
		"""Risk 1: the teams-browser panel renders empty, not an error."""
		season = Season.objects.create(name='Friendlies 2026', competition='FRN')

		resp = self.client.get(f'/api/seasons/{season.pk}/group-standings/')

		self.assertEqual(resp.status_code, 200)
		self.assertEqual(resp.json(), {'season_id': season.pk, 'groups': []})


class PromiedosFriendliesSyncTests(TestCase):
	"""The friendlies pull, run offline against a stubbed date endpoint."""

	def _team(self, team_id, name, country_id):
		return {'id': team_id, 'name': name, 'short_name': name[:3], 'country_id': country_id}

	def _game(self, game_id, home, away, start_time='22-09-2026 20:00'):
		return {
			'id': game_id,
			'start_time': start_time,
			'status': {'short_name': 'Prog.', 'name': 'Programado'},
			'game_time_status_to_display': '',
			'scores': [],
			'teams': [home, away],
		}

	def _payload(self, games, league_id='fha'):
		return {'leagues': [{'id': league_id, 'games': games}]}

	def _run(self, responder, **options):
		from io import StringIO

		from draw.management.commands.sync_promiedos_friendlies import Command

		options.setdefault('days_back', 0)
		options.setdefault('days_ahead', 0)
		out, err = StringIO(), StringIO()
		with mock.patch.object(Command, 'fetch_json', side_effect=responder):
			call_command('sync_promiedos_friendlies', stdout=out, stderr=err, **options)
		return out.getvalue(), err.getvalue()

	def test_imports_one_day(self):
		games = [
			self._game('g1', self._team('t1', 'Argentina', 'ba'), self._team('t2', 'Inglaterra', 'b')),
			# An unseen country_id for a nation the name map already knows.
			self._game('g2', self._team('t3', 'Gales', 'zz9'), self._team('t4', 'España', 'c')),
		]
		self._run(lambda url: self._payload(games))

		season = Season.objects.get(name=f'Friendlies {date.today().year}')
		self.assertEqual(season.competition, 'FRN')
		self.assertFalse(season.is_active)

		# 'ba' resolves via the parent CONMEBOL map, 'b'/'c' via the national id
		# map, 'zz9' via the national name map.
		self.assertEqual(
			set(Association.objects.values_list('code', flat=True)),
			{'ARG', 'ENG', 'ESP', 'WAL'},
		)
		self.assertEqual(SeasonTeam.objects.filter(season=season).count(), 4)
		matchups = list(SeasonMatchup.objects.filter(season=season))
		self.assertEqual(len(matchups), 2)
		self.assertTrue(all(m.matchday is None for m in matchups))
		self.assertEqual(
			SeasonMatchup.objects.get(external_id='promiedos:g1').home_team.team.name,
			'Argentina',
		)

	def test_zero_friendlies_day_writes_nothing(self):
		out, err = self._run(lambda url: {'leagues': []})

		self.assertEqual(Season.objects.count(), 0)
		self.assertEqual(SeasonMatchup.objects.count(), 0)
		self.assertIn('imported 0', out + err)

	def test_rerun_is_idempotent(self):
		games = [self._game('g1', self._team('t1', 'Argentina', 'ba'), self._team('t2', 'Inglaterra', 'b'))]
		self._run(lambda url: self._payload(games))
		before = (
			Season.objects.count(), Association.objects.count(), Team.objects.count(),
			SeasonTeam.objects.count(), SeasonMatchup.objects.count(),
		)
		external_id = SeasonMatchup.objects.get().external_id

		self._run(lambda url: self._payload(games))

		after = (
			Season.objects.count(), Association.objects.count(), Team.objects.count(),
			SeasonTeam.objects.count(), SeasonMatchup.objects.count(),
		)
		self.assertEqual(after, before)
		self.assertEqual(SeasonMatchup.objects.count(), 1)
		self.assertEqual(SeasonMatchup.objects.get().external_id, external_id)

	def test_selects_only_fha_and_is_date_scoped(self):
		from draw.management.commands.sync_promiedos_fixtures import PROMIEDOS_API

		requested = []
		other_league = {
			'id': 'not-fha',
			'games': [self._game('g9', self._team('t9', 'Portugal', 'bb'), self._team('t8', 'Suiza', 'bf'))],
		}
		fha_league = {'id': 'fha', 'games': [
			self._game('g1', self._team('t1', 'Argentina', 'ba'), self._team('t2', 'Inglaterra', 'b')),
		]}

		def responder(url):
			requested.append(url)
			return {'leagues': [other_league, fha_league]}

		self._run(responder, days_back=1, days_ahead=1)

		expected = [
			f'{PROMIEDOS_API}/games/{(date.today() + timedelta(days=offset)):%d-%m-%Y}'
			for offset in (-1, 0, 1)
		]
		self.assertEqual(requested, expected)
		self.assertEqual(SeasonMatchup.objects.count(), 1)
		self.assertEqual(SeasonMatchup.objects.get().external_id, 'promiedos:g1')

	def test_year_boundary_buckets_by_fetch_day_not_kickoff(self):
		from draw.management.commands import sync_promiedos_friendlies as friendlies

		in_season = self._game(
			'g-new', self._team('t1', 'Argentina', 'ba'), self._team('t2', 'Inglaterra', 'b')
		)
		out_of_season = self._game(
			'g-old', self._team('t3', 'Brasil', 'bb'), self._team('t4', 'Uruguay', 'bc')
		)

		def responder(url):
			# today=2026-01-01 with days_back=1 straddles the year boundary.
			if url.endswith('/31-12-2025'):
				return self._payload([out_of_season])
			return self._payload([in_season])

		with mock.patch.object(friendlies, 'date') as mock_date:
			mock_date.today.return_value = datetime(2026, 1, 1).date()
			out, err = self._run(responder, days_back=1, days_ahead=0, season=2026)

		# Both games kick off in 2026; only the one *fetched* on an in-season
		# day is imported, so the bucket is the fetch day, not the kickoff.
		self.assertTrue(Season.objects.filter(name='Friendlies 2026').exists())
		self.assertEqual(SeasonMatchup.objects.count(), 1)
		self.assertEqual(SeasonMatchup.objects.get().external_id, 'promiedos:g-new')
		self.assertFalse(
			SeasonMatchup.objects.filter(external_id='promiedos:g-old').exists()
		)

		self.assertIn('Skipped 1 friendlies outside 2026', out)
		self.assertIn('1 outside season', out)

	def test_leagues_without_fha_league_writes_nothing(self):
		# `leagues` is present and populated, but none is the friendlies league.
		# Distinct from the empty-list case: the run must still write nothing
		# and stay successful.
		other_league = {
			'id': 'not-fha',
			'games': [
				self._game('g9', self._team('t9', 'Portugal', 'bb'), self._team('t8', 'Suiza', 'bf')),
			],
		}
		out, err = self._run(lambda url: {'leagues': [other_league]})

		self.assertEqual(Season.objects.count(), 0)
		self.assertEqual(SeasonMatchup.objects.count(), 0)
		self.assertIn('imported 0', out + err)

	def test_national_team_association_name_is_its_code_and_has_no_domestic(self):
		games = [self._game(
			'g1', self._team('t1', 'Inglaterra', 'b'), self._team('t2', 'Argentina', 'ba')
		)]
		self._run(lambda url: self._payload(games))

		# COUNTRY_NAMES only carries the 10 CONMEBOL codes, so a friendlies
		# nation's Association is named after its 3-letter code.
		england = Association.objects.get(code='ENG')
		self.assertEqual(england.name, 'ENG')

		# get_domestic keys on association.name against league.country. A league
		# country spelled the human way must not match the code, so the national
		# team serialises to domestic=None even when a same-named standing row
		# exists (were the name 'England', this row would match).
		league = League.objects.create(code='PL', name='Premier League', country='England')
		LeagueStanding.objects.create(
			league=league, season_year=2026, position=1, team_name='Inglaterra',
		)
		entry = SeasonTeam.objects.get(team__name='Inglaterra')
		self.assertIsNone(CompactSeasonTeamSerializer(entry).data['domestic'])


class PromiedosFixturesHistoryTests(TestCase):
	"""The LIB/SUD matchup writer appends history alongside its upsert.

	Offline: the network boundary (``fetch`` for the filter page and
	``fetch_json`` for the games payload) is stubbed, mirroring
	``PromiedosFriendliesSyncTests``.
	"""

	def _team(self, team_id, name, country_id):
		return {'id': team_id, 'name': name, 'short_name': name[:3], 'country_id': country_id}

	def _game(self, game_id, home, away, home_goals=None, away_goals=None):
		finished = home_goals is not None and away_goals is not None
		return {
			'id': game_id,
			'start_time': '22-09-2026 20:00',
			'status': {
				'short_name': 'Final' if finished else 'Prog.',
				'name': 'Finalizado' if finished else 'Programado',
			},
			'game_time_status_to_display': 'Final' if finished else '',
			'scores': [home_goals, away_goals] if finished else [],
			'teams': [home, away],
		}

	def _payload(self, games):
		return {'games': games}

	def _filters_html(self):
		blob = json.dumps({'props': {'pageProps': {'data': {'games': {'filters': [
			{'key': '102_69_4_1', 'name': 'Fecha 1'},
		]}}}}})
		return f'<script id="__NEXT_DATA__" type="application/json">{blob}</script>'

	def _run(self, games, **options):
		from io import StringIO

		from draw.management.commands.sync_promiedos_fixtures import Command

		options.setdefault('competition', 'lib')
		out, err = StringIO(), StringIO()
		with mock.patch.object(Command, 'fetch', return_value=self._filters_html()), \
				mock.patch.object(Command, 'fetch_json', return_value=self._payload(games)):
			call_command('sync_promiedos_fixtures', stdout=out, stderr=err, **options)
		return out.getvalue(), err.getvalue()

	def _home_and_away(self):
		return (
			self._team('t1', 'Flamengo', 'cb'),
			self._team('t2', 'Boca Juniors', 'ba'),
		)

	def test_changed_score_appends_history_keyed_by_the_triple(self):
		home, away = self._home_and_away()

		self._run([self._game('g1', home, away, 1, 0)])
		self._run([self._game('g1', home, away, 2, 0)])

		rows = ResultHistory.objects.filter(source='promiedos')
		self.assertEqual(rows.count(), 2)
		self.assertEqual(
			set(rows.values_list('home_goals', 'away_goals')),
			{(1, 0), (2, 0)},
		)
		season = Season.objects.get()
		matchup = SeasonMatchup.objects.get()
		row = rows.order_by('id').first()
		self.assertEqual(row.subject, f'{season.pk}:{matchup.home_team_id}:{matchup.away_team_id}')
		self.assertEqual((row.competition, row.season_name), ('LIB', 'Libertadores 2026'))
		self.assertEqual((row.home_label, row.away_label), ('Flamengo', 'Boca Juniors'))
		self.assertEqual(row.status, 'FINISHED')

	def test_unchanged_rerun_appends_nothing(self):
		home, away = self._home_and_away()
		games = [self._game('g1', home, away, 1, 0)]

		self._run(games)
		self._run(games)

		self.assertEqual(ResultHistory.objects.filter(source='promiedos').count(), 1)

	def test_subject_is_the_triple_not_the_external_id(self):
		home, away = self._home_and_away()

		self._run([self._game('g1', home, away, 1, 0)])

		season = Season.objects.get()
		matchup = SeasonMatchup.objects.get()
		row = ResultHistory.objects.get()
		self.assertEqual(matchup.external_id, 'promiedos:g1')
		self.assertEqual(row.subject, f'{season.pk}:{matchup.home_team_id}:{matchup.away_team_id}')
		self.assertNotEqual(row.subject, matchup.external_id)


class PromiedosFriendliesHistoryTests(TestCase):
	"""The FRN writer appends history alongside its upsert.

	Offline: the date endpoint (``fetch_json``) is stubbed exactly as
	``PromiedosFriendliesSyncTests`` does.
	"""

	def _team(self, team_id, name, country_id):
		return {'id': team_id, 'name': name, 'short_name': name[:3], 'country_id': country_id}

	def _game(self, game_id, home, away, scores=None):
		return {
			'id': game_id,
			'start_time': '22-09-2026 20:00',
			'status': (
				{'short_name': 'Final', 'name': 'Finalizado'} if scores
				else {'short_name': 'Prog.', 'name': 'Programado'}
			),
			'game_time_status_to_display': 'Final' if scores else '',
			'scores': scores or [],
			'teams': [home, away],
		}

	def _payload(self, games, league_id='fha'):
		return {'leagues': [{'id': league_id, 'games': games}]}

	def _run(self, responder, **options):
		from io import StringIO

		from draw.management.commands.sync_promiedos_friendlies import Command

		options.setdefault('days_back', 0)
		options.setdefault('days_ahead', 0)
		out, err = StringIO(), StringIO()
		with mock.patch.object(Command, 'fetch_json', side_effect=responder):
			call_command('sync_promiedos_friendlies', stdout=out, stderr=err, **options)
		return out.getvalue(), err.getvalue()

	def _subject(self):
		season = Season.objects.get(name=f'Friendlies {date.today().year}')
		matchup = SeasonMatchup.objects.get(external_id='promiedos:g1')
		return f'{season.pk}:{matchup.home_team_id}:{matchup.away_team_id}'

	def test_changed_score_appends_history_keyed_by_triple(self):
		home = self._team('t1', 'Argentina', 'ba')
		away = self._team('t2', 'Inglaterra', 'b')

		self._run(lambda url: self._payload([self._game('g1', home, away, [2, 1])]))
		self._run(lambda url: self._payload([self._game('g1', home, away, [3, 1])]))

		rows = ResultHistory.objects.filter(source='promiedos')
		self.assertEqual(rows.count(), 2)
		self.assertEqual(
			set(rows.values_list('home_goals', 'away_goals')), {(2, 1), (3, 1)}
		)

		subject = self._subject()
		# The triple is the model's own unique constraint; the external_id is
		# overwritten when a directed pair recurs, so it must not be the key.
		self.assertEqual(set(rows.values_list('subject', flat=True)), {subject})
		self.assertNotIn('promiedos:g1', {r.subject for r in rows})

		row = rows.order_by('id').first()
		self.assertEqual(
			(row.competition, row.season_name, row.home_label, row.away_label, row.status),
			('FRN', f'Friendlies {date.today().year}', 'Argentina', 'Inglaterra', 'FINISHED'),
		)

	def test_unchanged_rerun_appends_nothing(self):
		home = self._team('t1', 'Argentina', 'ba')
		away = self._team('t2', 'Inglaterra', 'b')
		games = [self._game('g1', home, away, [2, 1])]

		self._run(lambda url: self._payload(games))
		self._run(lambda url: self._payload(games))

		rows = ResultHistory.objects.filter(source='promiedos')
		self.assertEqual(rows.count(), 1)
		self.assertEqual(list(rows.values_list('home_goals', 'away_goals')), [(2, 1)])

	def test_unresolved_nation_appends_no_history(self):
		games = [self._game(
			'g1',
			self._team('t1', 'Futbolandia', 'zzz'),
			self._team('t2', 'Otrolandia', 'yyy'),
			[1, 0],
		)]

		_, err = self._run(lambda url: self._payload(games))

		# The nation never resolves, so the game stops before the upsert and is
		# never collected: no matchup, and no history row either.
		self.assertEqual(SeasonMatchup.objects.count(), 0)
		self.assertEqual(ResultHistory.objects.count(), 0)
		self.assertIn('skipped 1', err)


class FriendliesUnresolvedNationTests(TestCase):
	"""Resolution misses skip loudly but never fail the run (spec R10)."""

	def _game(self, game_id, home, away):
		return {
			'id': game_id,
			'start_time': '22-09-2026 20:00',
			'status': {'short_name': 'Prog.', 'name': 'Programado'},
			'game_time_status_to_display': '',
			'scores': [],
			'teams': [home, away],
		}

	def _team(self, team_id, name, country_id):
		return {'id': team_id, 'name': name, 'short_name': name[:3], 'country_id': country_id}

	def _run(self, games):
		from io import StringIO

		from draw.management.commands.sync_promiedos_friendlies import Command

		out, err = StringIO(), StringIO()
		with mock.patch.object(
			Command, 'fetch_json',
			side_effect=lambda url: {'leagues': [{'id': 'fha', 'games': games}]},
		):
			call_command(
				'sync_promiedos_friendlies',
				days_back=0, days_ahead=0, stdout=out, stderr=err,
			)
		return out.getvalue(), err.getvalue()

	def test_all_unresolved_skips_and_run_succeeds(self):
		games = [self._game(
			'g1',
			self._team('t1', 'Futbolandia', 'zzz'),
			self._team('t2', 'Otrolandia', 'yyy'),
		)]

		out, err = self._run(games)

		self.assertIn('Futbolandia', err)
		self.assertIn('zzz', err)
		self.assertIn('Otrolandia', err)
		self.assertIn('yyy', err)
		self.assertIn('imported 0', err)
		self.assertIn('skipped 1', err)
		self.assertEqual(SeasonMatchup.objects.count(), 0)

	def test_partial_import_succeeds(self):
		games = [
			self._game('g1', self._team('t1', 'Argentina', 'ba'), self._team('t2', 'Inglaterra', 'b')),
			self._game('g2', self._team('t3', 'Futbolandia', 'zzz'), self._team('t4', 'Otrolandia', 'yyy')),
		]

		out, err = self._run(games)
		combined = out + err

		self.assertIn('imported 1', combined)
		self.assertIn('skipped 1', combined)
		self.assertEqual(SeasonMatchup.objects.count(), 1)
		self.assertEqual(SeasonMatchup.objects.get().external_id, 'promiedos:g1')

	def test_two_unresolved_teams_sharing_country_id_are_both_named(self):
		# Both teams are unresolvable and share one country_id (None, the
		# realistic shape). The tracker is keyed by (country_id, name); a
		# country_id-only key collapses the pair into a single entry, so unlike
		# the zzz/yyy test above this case discriminates that fix: the old
		# implementation would print only one of the names (dict) or none of
		# them (set of ids), and the count would be 1, not 2.
		games = [self._game(
			'g1',
			self._team('t1', 'Futbolandia', None),
			self._team('t2', 'Otrolandia', None),
		)]

		out, err = self._run(games)

		self.assertIn('Futbolandia', err)
		self.assertIn('Otrolandia', err)
		self.assertIn('Unresolved nation codes (2)', err)
		self.assertIn('skipped 1', err)
		self.assertIn('imported 0', err)
		self.assertEqual(SeasonMatchup.objects.count(), 0)


class FriendliesNeverSeededTests(TestCase):
	def test_friendlies_season_cannot_be_seeded(self):
		season = Season.objects.create(name='Friendlies 2026', competition='FRN')
		association = Association.objects.create(name='England', code='ENG')
		for index in range(5):
			team = Team.objects.create(
				name=f'Nation {index}', short_name=f'N{index}', association=association,
			)
			SeasonTeam.objects.create(
				season=season, team=team, uefa_club_coefficient=Decimal('0.000'),
			)

		with self.assertRaises(SeedingError):
			seed_season_entries(season)


class ResultHistoryTests(TestCase):
	"""The append-only helper compares against history, never the live row."""

	def _observe(self, observations, **overrides):
		options = {'source': 'promiedos', 'competition': 'UCL', 'season_name': '2026-27'}
		options.update(overrides)
		return record_result_history(observations, **options)

	def _obs(self, subject='real-1-1', home_goals=2, away_goals=1, status='FINISHED'):
		return {
			'subject': subject,
			'home_label': 'Home',
			'away_label': 'Away',
			'home_goals': home_goals,
			'away_goals': away_goals,
			'status': status,
		}

	def test_first_observation_appends_one_row(self):
		appended = self._observe([self._obs()])

		self.assertEqual(appended, 1)
		row = ResultHistory.objects.get()
		self.assertEqual(row.source, 'promiedos')
		self.assertEqual(row.competition, 'UCL')
		self.assertEqual(row.season_name, '2026-27')
		self.assertEqual(row.subject, 'real-1-1')
		self.assertEqual(row.home_label, 'Home')
		self.assertEqual(row.away_label, 'Away')
		self.assertEqual((row.home_goals, row.away_goals, row.status), (2, 1, 'FINISHED'))

	def test_unchanged_observation_appends_nothing(self):
		self._observe([self._obs()])

		appended = self._observe([self._obs()])

		self.assertEqual(appended, 0)
		self.assertEqual(ResultHistory.objects.count(), 1)

	def test_second_change_appends_a_second_row_and_keeps_the_first(self):
		self._observe([self._obs(home_goals=1, away_goals=0)])
		self._observe([self._obs(home_goals=2, away_goals=1)])

		self.assertEqual(ResultHistory.objects.count(), 2)
		self.assertEqual(
			set(ResultHistory.objects.values_list('home_goals', 'away_goals')),
			{(1, 0), (2, 1)},
		)

	def test_status_only_change_appends(self):
		self._observe([self._obs(home_goals=2, away_goals=1, status='IN_PLAY')])

		appended = self._observe([self._obs(home_goals=2, away_goals=1, status='FINISHED')])

		self.assertEqual(appended, 1)
		self.assertEqual(ResultHistory.objects.count(), 2)

	def test_same_subject_under_two_sources_stays_distinct(self):
		self._observe([self._obs()], source='promiedos')
		self._observe([self._obs()], source='football-data')

		self.assertEqual(ResultHistory.objects.count(), 2)
		self.assertEqual(
			set(ResultHistory.objects.values_list('source', flat=True)),
			{'promiedos', 'football-data'},
		)

	def test_last_observation_in_one_call_wins(self):
		appended = self._observe([
			self._obs(home_goals=0, away_goals=0),
			self._obs(home_goals=3, away_goals=2),
		])

		self.assertEqual(appended, 1)
		row = ResultHistory.objects.get()
		self.assertEqual((row.home_goals, row.away_goals), (3, 2))

	def test_one_changed_subject_of_two_appends_only_that_row(self):
		# Exercises the grouped prefetch's per-subject resolution together with
		# the mixed append/skip branch: a regression that collapsed subject
		# groups would still pass every single-subject test above.
		self._observe([self._obs(subject='real-1-1', home_goals=2, away_goals=1)])
		self._observe([self._obs(subject='real-1-2', home_goals=1, away_goals=1)])

		appended = self._observe([
			self._obs(subject='real-1-1', home_goals=2, away_goals=1),
			self._obs(subject='real-1-2', home_goals=3, away_goals=1),
		])

		self.assertEqual(appended, 1)
		self.assertEqual(ResultHistory.objects.count(), 3)
		self.assertEqual(
			ResultHistory.objects.filter(subject='real-1-1').count(), 1,
		)
		self.assertEqual(
			list(
				ResultHistory.objects.filter(subject='real-1-2')
				.order_by('id')
				.values_list('home_goals', 'away_goals')
			),
			[(1, 1), (3, 1)],
		)


class LeagueFixturesHistoryTests(TestCase):
	"""The football-data league writer appends history alongside its upsert.

	Offline: the network boundary (``Command._api_get``) and the 10 s
	rate-limit sleep are patched. This command had no test class before, so the
	stub is the minimum it needs: a ``League`` row, an ``API_FOOTBALL_DATA_KEY``
	and a matches payload.
	"""

	MODULE = 'draw.management.commands.sync_league_fixtures'

	def setUp(self):
		self.league = League.objects.create(name='Premier League', code='PL', country='England')

	def _payload(self, matches):
		return {'matches': [
			{
				'id': match_id,
				'homeTeam': {'name': home, 'shortName': home[:3]},
				'awayTeam': {'name': away, 'shortName': away[:3]},
				'score': {'fullTime': {'home': home_goals, 'away': away_goals}},
				'status': 'FINISHED',
				'utcDate': '2026-09-20T14:00:00Z',
				'matchday': 5,
			}
			for match_id, home, away, home_goals, away_goals in matches
		]}

	def _run(self, matches, *, dry_run=False):
		args = ['sync_league_fixtures', '--codes', 'PL']
		if dry_run:
			args.append('--dry-run')
		with mock.patch(f'{self.MODULE}.Command._api_get', return_value=self._payload(matches)), \
				mock.patch(f'{self.MODULE}.time.sleep'), \
				mock.patch.dict('os.environ', {'API_FOOTBALL_DATA_KEY': 'test'}):
			call_command(*args)

	def _history(self):
		return ResultHistory.objects.filter(source='football-data-league')

	def test_changed_score_appends_history_keyed_by_match_id(self):
		self._run([(555, 'Arsenal', 'Chelsea', 2, 1)])

		self._run([(555, 'Arsenal', 'Chelsea', 3, 1)])

		rows = self._history().filter(subject='555')
		self.assertEqual(rows.count(), 2)
		self.assertEqual(
			set(rows.values_list('home_goals', 'away_goals')),
			{(2, 1), (3, 1)},
		)
		row = rows.order_by('id').first()
		self.assertEqual((row.competition, row.season_name), ('PL', ''))
		self.assertEqual((row.home_label, row.away_label), ('Arsenal', 'Chelsea'))

	def test_unchanged_rerun_appends_nothing(self):
		self._run([(555, 'Arsenal', 'Chelsea', 2, 1)])

		self._run([(555, 'Arsenal', 'Chelsea', 2, 1)])

		self.assertEqual(
			list(self._history().filter(subject='555').values_list('home_goals', 'away_goals')),
			[(2, 1)],
		)

	def test_dry_run_writes_no_history(self):
		self._run([(555, 'Arsenal', 'Chelsea', 2, 1)])

		self._run([(555, 'Arsenal', 'Chelsea', 3, 1)], dry_run=True)

		self.assertEqual(
			list(self._history().filter(subject='555').values_list('home_goals', 'away_goals')),
			[(2, 1)],
		)

	def _history_query_count(self, ctx):
		table = ResultHistory._meta.db_table
		return sum(1 for query in ctx.captured_queries if table in query['sql'])

	def test_history_queries_do_not_scale_with_fixture_count(self):
		"""R7/S7a: history is one bounded prefetch per league, never a query per row.

		The assertion is on the history-related queries alone (those touching
		``ResultHistory``): one prefetch plus one bulk insert, the same for one
		fixture and for three. Absolute totals cannot show this — the per-fixture
		upsert queries and the transaction savepoints scale with N.
		"""
		with CaptureQueriesContext(connection) as one:
			self._run([(801, 'A', 'B', 1, 0)])
		with CaptureQueriesContext(connection) as three:
			self._run([(811, 'A', 'B', 1, 0), (812, 'C', 'D', 2, 0), (813, 'E', 'F', 3, 0)])

		self.assertEqual(self._history_query_count(one), 2)
		self.assertEqual(self._history_query_count(three), 2)

	def test_sync_leagues_appends_no_history_rows(self):
		"""R5/S5b: standings are not results, so sync_leagues emits no history."""
		LeagueStanding.objects.create(
			league=self.league, season_year=2026, position=1, team_name='Arsenal',
			played=9, won=7, draw=1, lost=1, goals_for=18, goals_against=6,
			goal_difference=12, points=22,
		)
		competition = {
			'emblem': 'https://crests.football-data.org/PL.png',
			'plan': 'TIER_ONE',
			'currentSeason': {'startDate': '2026-08-01'},
		}
		standings = {'standings': [{'type': 'TOTAL', 'table': [{
			'position': 1, 'team': {'name': 'Arsenal', 'crest': ''},
			'playedGames': 10, 'won': 8, 'draw': 1, 'lost': 1,
			'goalsFor': 20, 'goalsAgainst': 5, 'goalDifference': 15, 'points': 25,
		}]}]}

		with mock.patch(
			'draw.management.commands.sync_leagues.Command._api_get',
			side_effect=[competition, standings],
		), mock.patch('draw.management.commands.sync_leagues.time.sleep'), \
				mock.patch.dict('os.environ', {'API_FOOTBALL_DATA_KEY': 'test'}):
			call_command('sync_leagues', '--league', 'PL')

		self.assertEqual(ResultHistory.objects.count(), 0)
		self.assertEqual(
			LeagueStanding.objects.get(league=self.league, season_year=2026).points,
			25,
		)

class NationsLeagueUnresolvedNationTests(TestCase):
	"""An unmapped nation skips its matchup but never fails the run (R10/S10b).

	Offline: the two network boundaries (`fetch` for the filter page and
	`fetch_json` for the games payload) are stubbed.
	"""

	def _team(self, team_id, name, country_id):
		return {'id': team_id, 'name': name, 'short_name': name[:3], 'country_id': country_id}

	def _game(self, game_id, home, away):
		return {
			'id': game_id,
			'start_time': '22-09-2026 20:00',
			'status': {'short_name': 'Prog.', 'name': 'Programado'},
			'game_time_status_to_display': '',
			'scores': [],
			'teams': [home, away],
		}

	def _filters_html(self):
		payload = {'props': {'pageProps': {'data': {'games': {'filters': [
			{'key': '7016_5_1_1', 'name': 'Fecha 1'},
		]}}}}}
		return (
			'<div id="root"></div>'
			'<script id="__NEXT_DATA__" type="application/json">'
			f'{json.dumps(payload)}'
			'</script>'
		)

	def _run(self, games):
		from io import StringIO

		from draw.management.commands.sync_promiedos_nations_league import Command

		out, err = StringIO(), StringIO()
		with mock.patch.object(Command, 'fetch', return_value=self._filters_html()), \
				mock.patch.object(Command, 'fetch_json', return_value={'games': games}):
			call_command(
				'sync_promiedos_nations_league', '--competition', 'unl',
				stdout=out, stderr=err,
			)
		return out.getvalue(), err.getvalue()

	def test_unresolved_nation_skips_matchup_and_names_team_and_code(self):
		games = [self._game(
			'g1', self._team('t1', 'Futbolandia', 'zzz'), self._team('t2', 'Otrolandia', 'yyy'),
		)]

		out, err = self._run(games)

		# The warning names both the team and the opaque country_id, and the run
		# still succeeds (no exception, the season is created).
		self.assertIn('Futbolandia', err)
		self.assertIn('zzz', err)
		self.assertIn('Otrolandia', err)
		self.assertIn('yyy', err)
		self.assertEqual(SeasonMatchup.objects.count(), 0)
		season = Season.objects.get(name='Nations League 2026')
		self.assertEqual(season.competition, 'UNL')

	def test_resolvable_matchup_imports_beside_an_unresolved_one(self):
		games = [
			self._game('g1', self._team('t1', 'España', 'c'), self._team('t2', 'Inglaterra', 'b')),
			self._game('g2', self._team('t3', 'Futbolandia', 'zzz'), self._team('t4', 'Otrolandia', 'yyy')),
		]

		out, err = self._run(games)

		self.assertEqual(SeasonMatchup.objects.count(), 1)
		matchup = SeasonMatchup.objects.get()
		self.assertEqual(matchup.external_id, 'promiedos:g1')
		self.assertEqual(matchup.matchday, 1)
		self.assertIn('zzz', err)


class NationsLeagueNeverSeededTests(TestCase):
	def test_nations_league_season_cannot_be_seeded(self):
		season = Season.objects.create(name='Nations League 2026', competition='UNL')
		association = Association.objects.create(name='Spain', code='ESP')
		for index in range(5):
			team = Team.objects.create(
				name=f'Nation {index}', short_name=f'N{index}', association=association,
			)
			SeasonTeam.objects.create(
				season=season, team=team, uefa_club_coefficient=Decimal('0.000'),
			)

		with self.assertRaises(SeedingError):
			seed_season_entries(season)


class NationsLeagueCompetitionMetaTests(APITestCase):
	def test_unl_is_served_and_labelled(self):
		from .views import COMPETITION_META, NON_UCL_COMPETITIONS

		self.assertIn('UNL', COMPETITION_META)
		self.assertIn('UNL', NON_UCL_COMPETITIONS)
		self.assertEqual(COMPETITION_META['UNL']['label'], 'Nations League')
		self.assertEqual(COMPETITION_META['UNL']['country'], 'International')

	def test_group_standings_return_derived_groups_not_404(self):
		season = Season.objects.create(name='Nations League 2026', competition='UNL')
		association = Association.objects.create(name='Spain', code='ESP')
		entries = []
		for index in range(4):
			team = Team.objects.create(
				name=f'Nation {index}', short_name=f'N{index}', association=association,
			)
			entries.append(SeasonTeam.objects.create(
				season=season, team=team, uefa_club_coefficient=Decimal('0.000'),
			))
		SeasonMatchup.objects.create(
			season=season, home_team=entries[0], away_team=entries[1], matchday=1,
		)
		SeasonMatchup.objects.create(
			season=season, home_team=entries[2], away_team=entries[3], matchday=1,
		)

		resp = self.client.get(f'/api/seasons/{season.pk}/group-standings/')

		self.assertEqual(resp.status_code, 200)
		groups = resp.json()['groups']
		self.assertEqual(len(groups), 2)
		self.assertEqual({len(group['standings']) for group in groups}, {2})

	def test_lib_guard_is_unchanged(self):
		# S11c: the guard change is a superset of the old literal, so a LIB
		# season with no matchups still returns 200 with empty groups.
		season = Season.objects.create(name='Libertadores 2026', competition='LIB')

		resp = self.client.get(f'/api/seasons/{season.pk}/group-standings/')

		self.assertEqual(resp.status_code, 200)
		self.assertEqual(resp.json(), {'season_id': season.pk, 'groups': []})


class NationsLeagueTeamMapTests(TestCase):
	"""The 12 codes the `habg` sweep found missing resolve to their ISO-3 codes."""

	CODES = {
		'bab': 'LIE', 'bac': 'EST', 'caj': 'GIB', 'dd': 'SVK',
		'ea': 'BUL', 'eb': 'LVA', 'ec': 'LTU', 'fh': 'BIH',
		'g': 'ISR', 'hg': 'ALB', 'hi': 'GEO', 'jd': 'MLT',
	}

	NAMES = {
		'Liechtenstein': 'LIE', 'Estonia': 'EST', 'Gibraltar': 'GIB',
		'Eslovaquia': 'SVK', 'Bulgaria': 'BUL', 'Letonia': 'LVA',
		'Lituania': 'LTU', 'Bosnia Herzegovina': 'BIH', 'Israel': 'ISR',
		'Albania': 'ALB', 'Georgia': 'GEO', 'Malta': 'MLT',
	}

	def _resolve(self, name, country_id):
		from draw.management.commands.sync_promiedos_nations_league import Command

		return Command().resolve_association_code({'name': name, 'country_id': country_id})

	def test_ids_resolve_to_iso3(self):
		for country_id, code in self.CODES.items():
			with self.subTest(country_id=country_id):
				self.assertEqual(self._resolve('', country_id), code)

	def test_names_resolve_to_iso3_with_no_id(self):
		for name, code in self.NAMES.items():
			with self.subTest(name=name):
				self.assertEqual(self._resolve(name, None), code)


def sample_team_page_data():
	"""A fresh Promiedos team-page ``data`` block, shaped like the live one.

	Deliberately mirrors quirks the live probe confirmed: the club's founding
	year (1895) lives in team_info while the stadium's (1950) lives in
	stadium.info, 'Barridas ganadas' is a decimal average, and the staff row
	carries a blank shirt number.
	"""
	return {
		'competitor': {
			'name': 'Flamengo',
			'colors': {'color': '#AB1B10', 'text_color': '#FFFFFF'},
		},
		'team_info': [
			{'name': 'Apodo', 'value': 'Mengao / Rubro-Negro'},
			{'name': 'Fundación', 'value': '1895'},
			{'name': 'Club de', 'value': 'Rio de Janeiro'},
			{'name': 'Estadio', 'value': 'Maracana'},
		],
		'stadium': {
			'name': 'Estadio Jornalista Mario Filho (Maracana)',
			'info': [
				{'name': 'Nombre', 'value': 'Maracana'},
				{'name': 'Capacidad', 'value': '78,838'},
				{'name': 'Fundación', 'value': '1950'},
				{'name': 'Ciudad', 'value': 'Rio de Janeiro'},
			],
		},
		'squad': {
			'groups': [
				{
					'name': 'Arqueros',
					'rows': [
						{'entity': {'type': 2, 'object': {
							'num': '1', 'name': 'Agustin Rossi', 'short_name': 'Rossi',
							'birthdate': '21/08/1995', 'height': '1.93', 'is_staff': False,
						}}},
					],
				},
				{
					'name': 'Delanteros',
					'rows': [
						{'entity': {'type': 2, 'object': {
							'num': '7', 'name': 'Luiz Araujo', 'short_name': 'Araujo',
							'birthdate': '02/06/1996', 'height': '1.75', 'is_staff': False,
						}}},
					],
				},
				{
					'name': 'Dirección',
					'rows': [
						{'entity': {'type': 2, 'object': {
							'num': '', 'name': 'Leonardo Jardim', 'short_name': 'Jardim',
							'birthdate': '01/08/1974', 'height': '', 'is_staff': True,
						}}},
					],
				},
			],
		},
		'stats': {
			'filters': [
				{
					'name': 'Brasileirao',
					'key': '113_76_-1',
					'selected': True,
					'tables': [
						{
							'name': 'Goles',
							'rows': [
								{'num': 1, 'entity': {'type': 4, 'object': {
									'name': 'Pedro', 'short_name': 'Pedro'}},
								 'values': [{'key': 'Goals', 'value': '16'}]},
								{'num': 2, 'entity': {'type': 4, 'object': {
									'name': 'Samuel Lino', 'short_name': 'Lino'}},
								 'values': [{'key': 'Goals', 'value': '9'}]},
							],
						},
						{
							'name': 'Barridas ganadas',
							'rows': [
								{'num': 1, 'entity': {'type': 4, 'object': {
									'name': 'Samuel Lino', 'short_name': 'Lino'}},
								 'values': [{'key': 'Tackles', 'value': '0.4'}]},
							],
						},
					],
				},
				{'name': 'CONMEBOL Copa Libertadores', 'key': '102_69_-1', 'tables': []},
			],
		},
	}


class TeamProfileModelTests(TestCase):
	def setUp(self):
		self.association = Association.objects.create(name='Brazil', code='BRA')
		self.team = Team.objects.create(
			name='Flamengo', short_name='FLA', association=self.association,
		)

	def test_profile_is_one_to_one(self):
		TeamProfile.objects.create(team=self.team, nickname='Mengao')

		with self.assertRaises(IntegrityError), transaction.atomic():
			TeamProfile.objects.create(team=self.team)

	def test_squad_player_is_unique_per_team(self):
		SquadPlayer.objects.create(team=self.team, name='Pedro')

		with self.assertRaises(IntegrityError), transaction.atomic():
			SquadPlayer.objects.create(team=self.team, name='Pedro')

	def test_same_player_name_is_allowed_on_a_different_team(self):
		other = Team.objects.create(name='Palmeiras', short_name='PAL', association=self.association)
		SquadPlayer.objects.create(team=self.team, name='Pedro')
		SquadPlayer.objects.create(team=other, name='Pedro')

		self.assertEqual(SquadPlayer.objects.count(), 2)

	def test_stat_leader_key_is_team_competition_metric_player(self):
		TeamStatLeader.objects.create(
			team=self.team, competition='Brasileirao', metric='Goles',
			player_name='Pedro', rank=1, value=16,
		)

		with self.assertRaises(IntegrityError), transaction.atomic():
			TeamStatLeader.objects.create(
				team=self.team, competition='Brasileirao', metric='Goles',
				player_name='Pedro', rank=1, value=16,
			)

	def test_one_player_can_lead_several_metrics(self):
		TeamStatLeader.objects.create(
			team=self.team, competition='Brasileirao', metric='Goles',
			player_name='Pedro', rank=1, value=16,
		)
		TeamStatLeader.objects.create(
			team=self.team, competition='Brasileirao', metric='Asistencias',
			player_name='Pedro', rank=3, value=4,
		)

		self.assertEqual(TeamStatLeader.objects.count(), 2)


class PromiedosTeamParsingTests(TestCase):
	def test_parse_int_handles_thousands_separator_and_blanks(self):
		from draw.management.commands.sync_promiedos_team import parse_int

		self.assertEqual(parse_int('78,838'), 78838)
		self.assertEqual(parse_int('16'), 16)
		self.assertEqual(parse_int(7), 7)
		self.assertIsNone(parse_int(''))
		self.assertIsNone(parse_int('   '))
		self.assertIsNone(parse_int(None))
		# A decimal average must fail loudly rather than truncate to 0.
		self.assertIsNone(parse_int('0.4'))

	def test_parse_profile_reads_club_year_not_stadium_year(self):
		from draw.management.commands.sync_promiedos_team import parse_profile

		profile, unparsed = parse_profile(sample_team_page_data())

		self.assertEqual(profile['nickname'], 'Mengao / Rubro-Negro')
		self.assertEqual(profile['founded'], 1895)
		self.assertEqual(profile['club_city'], 'Rio de Janeiro')
		self.assertEqual(profile['stadium_capacity'], 78838)
		self.assertEqual(profile['stadium_city'], 'Rio de Janeiro')
		self.assertEqual(profile['primary_color'], '#AB1B10')
		self.assertEqual(profile['text_color'], '#FFFFFF')
		self.assertEqual(unparsed, [])

	def test_parse_profile_reports_unparseable_values_instead_of_coercing(self):
		from draw.management.commands.sync_promiedos_team import parse_profile

		data = sample_team_page_data()
		data['stadium']['info'][1]['value'] = 'seventy-eight thousand'

		profile, unparsed = parse_profile(data)

		self.assertIsNone(profile['stadium_capacity'])
		self.assertEqual(len(unparsed), 1)
		self.assertIn('stadium capacity', unparsed[0])

	def test_parse_squad_keeps_group_strings_and_blank_shirt_numbers(self):
		from draw.management.commands.sync_promiedos_team import parse_squad

		squad = parse_squad(sample_team_page_data())

		self.assertEqual({p['group'] for p in squad}, {'Arqueros', 'Delanteros', 'Dirección'})
		self.assertEqual(next(p for p in squad if p['name'] == 'Agustin Rossi')['shirt_number'], 1)
		# Staff rows carry a blank num; it becomes NULL, never 0.
		self.assertIsNone(next(p for p in squad if p['name'] == 'Leonardo Jardim')['shirt_number'])

	def test_parse_stat_leaders_skips_decimal_metrics(self):
		from draw.management.commands.sync_promiedos_team import parse_stat_leaders

		leaders, skipped = parse_stat_leaders(sample_team_page_data())

		self.assertEqual(len(leaders), 2)
		self.assertEqual({l['competition'] for l in leaders}, {'Brasileirao'})
		self.assertEqual([l['value'] for l in leaders], [16, 9])
		self.assertEqual(leaders[0]['rank'], 1)
		# 'Barridas ganadas' is an average ('0.4'), so it is skipped, not truncated.
		self.assertEqual(len(skipped), 1)
		self.assertIn('Barridas ganadas', skipped[0])

	def test_team_page_data_rejects_a_page_without_the_blob(self):
		from draw.management.commands.sync_promiedos_team import team_page_data

		with self.assertRaises(ValueError):
			team_page_data('<html><body>nope</body></html>')


class SyncPromiedosTeamCommandTests(TestCase):
	def setUp(self):
		self.association = Association.objects.create(name='Brazil', code='BRA')
		self.team = Team.objects.create(
			name='Flamengo', short_name='FLA', association=self.association,
			promiedos_id='bcbf',
		)

	def _html(self, data):
		blob = json.dumps({'props': {'pageProps': {'data': data}}})
		return f'<html><script id="__NEXT_DATA__" type="application/json">{blob}</script></html>'

	def _run(self, data=None):
		from draw.management.commands.sync_promiedos_team import Command

		html = self._html(data if data is not None else sample_team_page_data())
		with mock.patch.object(Command, 'fetch', return_value=html):
			call_command('sync_promiedos_team', '--team', 'Flamengo', verbosity=0)

	def test_sync_writes_profile_squad_and_leaders(self):
		self._run()

		profile = TeamProfile.objects.get(team=self.team)
		self.assertEqual(profile.founded, 1895)
		self.assertEqual(profile.stadium_capacity, 78838)
		self.assertEqual(SquadPlayer.objects.filter(team=self.team).count(), 3)
		self.assertEqual(TeamStatLeader.objects.filter(team=self.team).count(), 2)

	def test_rerunning_is_a_noop(self):
		self._run()
		first_profile = TeamProfile.objects.get(team=self.team)
		first_sync = first_profile.synced_at

		self._run()

		self.assertEqual(TeamProfile.objects.count(), 1)
		self.assertEqual(SquadPlayer.objects.count(), 3)
		self.assertEqual(TeamStatLeader.objects.count(), 2)
		# Unchanged rows are never saved, so synced_at does not move.
		self.assertEqual(TeamProfile.objects.get(team=self.team).synced_at, first_sync)

	def test_removed_players_are_deleted_on_the_next_run(self):
		self._run()
		self.assertEqual(SquadPlayer.objects.count(), 3)

		data = sample_team_page_data()
		data['squad']['groups'] = [
			group for group in data['squad']['groups'] if group['name'] == 'Dirección'
		]
		self._run(data)

		self.assertEqual([p.name for p in SquadPlayer.objects.all()], ['Leonardo Jardim'])

	def test_dry_run_writes_nothing(self):
		from draw.management.commands.sync_promiedos_team import Command

		html = self._html(sample_team_page_data())
		with mock.patch.object(Command, 'fetch', return_value=html):
			call_command('sync_promiedos_team', '--team', 'Flamengo', '--dry-run', verbosity=0)

		self.assertEqual(TeamProfile.objects.count(), 0)
		self.assertEqual(SquadPlayer.objects.count(), 0)
		self.assertEqual(TeamStatLeader.objects.count(), 0)

	def test_teams_without_a_promiedos_id_are_skipped(self):
		Team.objects.create(
			name='Arsenal', short_name='ARS', association=self.association,
		)
		from draw.management.commands.sync_promiedos_team import Command

		with mock.patch.object(
			Command, 'fetch', return_value=self._html(sample_team_page_data())
		) as fetch:
			call_command('sync_promiedos_team', verbosity=0)

		# Only the team that has an id was fetched.
		self.assertEqual(fetch.call_count, 1)
		self.assertFalse(TeamProfile.objects.filter(team__name='Arsenal').exists())


class TeamProfileApiTests(APITestCase):
	def setUp(self):
		self.association = Association.objects.create(name='Brazil', code='BRA')
		self.team = Team.objects.create(
			name='Flamengo', short_name='FLA', association=self.association,
			promiedos_id='bcbf',
		)
		TeamProfile.objects.create(
			team=self.team, nickname='Mengao', founded=1895, stadium_capacity=78838,
		)
		SquadPlayer.objects.create(
			team=self.team, name='Pedro', shirt_number=9, group='Delanteros',
		)
		TeamStatLeader.objects.create(
			team=self.team, competition='Brasileirao', metric='Goles',
			player_name='Pedro', rank=1, value=16,
		)

	def test_returns_profile_squad_and_leaders(self):
		response = self.client.get('/api/teams/profile/', {'name': 'Flamengo'})

		self.assertEqual(response.status_code, 200)
		body = response.json()
		self.assertTrue(body['found'])
		self.assertEqual(body['profile']['nickname'], 'Mengao')
		self.assertEqual(body['profile']['stadium_capacity'], 78838)
		self.assertEqual([p['name'] for p in body['squad']], ['Pedro'])
		self.assertEqual(body['stat_leaders'][0]['metric'], 'Goles')
		self.assertEqual(body['stat_leaders'][0]['value'], 16)

	def test_resolves_a_name_that_only_matches_after_normalization(self):
		response = self.client.get('/api/teams/profile/', {'name': 'flamengo!'})

		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.json()['found'])

	def test_unknown_team_is_a_200_with_found_false(self):
		response = self.client.get('/api/teams/profile/', {'name': 'Nonexistent FC'})

		self.assertEqual(response.status_code, 200)
		body = response.json()
		self.assertFalse(body['found'])
		self.assertIsNone(body['profile'])
		self.assertEqual(body['squad'], [])
		self.assertEqual(body['stat_leaders'], [])

	def test_team_without_synced_data_reports_found_with_empty_sections(self):
		Team.objects.create(
			name='Palmeiras', short_name='PAL', association=self.association,
			promiedos_id='xyz',
		)
		response = self.client.get('/api/teams/profile/', {'name': 'Palmeiras'})

		self.assertEqual(response.status_code, 200)
		body = response.json()
		self.assertTrue(body['found'])
		self.assertIsNone(body['profile'])
		self.assertEqual(body['squad'], [])

	def test_missing_name_is_a_400(self):
		response = self.client.get('/api/teams/profile/')

		self.assertEqual(response.status_code, 400)

