from decimal import Decimal

from django.urls import reverse
from rest_framework.test import APITestCase

from .models import Association, QualifiedViaChoices, Season, SeasonTeam, Team
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

# Create your tests here.
