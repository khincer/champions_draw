import json
from pathlib import Path
from tempfile import TemporaryDirectory
from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APITestCase

from .models import Association, QualifiedViaChoices, Season, SeasonTeam, Team
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
