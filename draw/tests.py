import json
from pathlib import Path
from tempfile import TemporaryDirectory
from decimal import Decimal

from django.contrib.auth.models import User
from django.core.management import call_command
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APITestCase

from .models import Association, DrawStatusChoices, QualifiedViaChoices, Season, SeasonDraw, SeasonMatchup, SeasonTeam, Team
from .services.draw import generate_season_draw
from .services.import_seed_input import import_seed_input_payload
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

	def test_console_ui_route_requires_login(self):
		response = self.client.get('/console/')

		self.assertEqual(response.status_code, 302)
		self.assertIn('/admin/login/', response['Location'])

	def test_console_ui_route_serves_preact_app_after_login(self):
		User.objects.create_user(username='operator', password='password')
		self.client.login(username='operator', password='password')

		response = self.client.get('/console/')

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response['Content-Type'], 'text/html')

	def test_generate_draw_creates_valid_league_phase_matchups(self):
		seed_season_entries(self.season)

		summary = generate_season_draw(self.season, draw_seed='unit-test-draw')
		draw_record = SeasonDraw.objects.get(pk=summary.draw_id)

		self.assertEqual(summary.status, DrawStatusChoices.COMPLETED)
		self.assertEqual(summary.total_matchups, 144)
		self.assertEqual(draw_record.status, DrawStatusChoices.COMPLETED)
		self.assertEqual(draw_record.draw_seed, 'unit-test-draw')
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
			{'seed': 'api-test-draw'},
			format='json',
		)

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.data['summary']['status'], DrawStatusChoices.COMPLETED)
		self.assertIsNotNone(response.data['summary']['draw_id'])
		self.assertEqual(response.data['summary']['total_matchups'], 144)
		self.assertEqual(len(response.data['matchups']), 144)
		self.assert_draw_constraints(self.season)

	def test_draw_history_endpoint_returns_draw_metadata(self):
		seed_season_entries(self.season)
		summary = generate_season_draw(self.season, draw_seed='history-test-draw')

		response = self.client.get(reverse('draw:season-draw-list', args=[self.season.pk]))

		self.assertEqual(response.status_code, 200)
		self.assertEqual(len(response.data), 1)
		self.assertEqual(response.data[0]['id'], summary.draw_id)
		self.assertEqual(response.data[0]['draw_seed'], 'history-test-draw')
		self.assertEqual(response.data[0]['status'], DrawStatusChoices.COMPLETED)

	def test_ui_season_state_returns_compact_payload(self):
		seed_season_entries(self.season)
		generate_season_draw(self.season, draw_seed='ui-state-test')

		response = self.client.get(reverse('draw:ui-season-state', args=[self.season.pk]))

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.data['summary']['team_count'], 36)
		self.assertEqual(response.data['summary']['matchup_count'], 144)
		self.assertEqual(len(response.data['teams']), 36)
		self.assertEqual(len(response.data['matchups']), 144)
		self.assertIn('name', response.data['teams'][0])
		self.assertIn('home_team', response.data['matchups'][0])

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

	def test_generate_draw_management_command_creates_matchups_and_metadata(self):
		seed_season_entries(self.season)

		call_command('generate_draw', self.season.name, '--seed', 'command-test-draw')

		draw_record = SeasonDraw.objects.get(season=self.season)
		self.assertEqual(draw_record.status, DrawStatusChoices.COMPLETED)
		self.assertEqual(draw_record.draw_seed, 'command-test-draw')
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
