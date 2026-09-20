"""Tests for backfill_team_logos: the pure candidate picker and command behavior.

No network: pick_candidate is a pure function, and the command's HTTP layer
is either mocked or bypassed via --dry-run.
"""

import io
import os
from unittest import mock

from django.core.management import call_command
from django.test import TestCase

from draw.management.commands.backfill_team_logos import Command, pick_candidate
from draw.models import Association, Team

LOGO_A = 'https://media.api-sports.io/football/teams/1.png'
LOGO_B = 'https://media.api-sports.io/football/teams/2.png'
LOGO_C = 'https://media.api-sports.io/football/teams/3.png'


class PickCandidateTests(TestCase):
	def test_exact_code_match_wins_over_name(self):
		candidates = [
			{'country': 'Peru', 'logo': LOGO_A},
			{'country': 'PER', 'logo': LOGO_B},
			{'country': 'Chile', 'logo': LOGO_C},
		]
		self.assertEqual(pick_candidate(candidates, 'PER', 'Peru (PER)'), candidates[1])

	def test_exact_name_match_wins_over_legacy(self):
		candidates = [
			{'country': 'Chile', 'logo': LOGO_A},
			{'country': 'Peru', 'logo': LOGO_B},
		]
		self.assertEqual(pick_candidate(candidates, 'PER', 'Peru'), candidates[1])

	def test_name_match_accepts_code_suffixed_form(self):
		candidates = [
			{'country': 'Chile', 'logo': LOGO_A},
			{'country': 'Peru', 'logo': LOGO_B},
		]
		self.assertEqual(pick_candidate(candidates, 'PER', 'Peru (PER)'), candidates[1])

	def test_legacy_fallback_when_neither_code_nor_name_matches(self):
		candidates = [
			{'country': 'Chile', 'logo': LOGO_A},
			{'country': 'Argentina', 'logo': LOGO_B},
		]
		self.assertEqual(pick_candidate(candidates, 'BRA', 'Brazil'), candidates[0])

	def test_legacy_skips_candidates_without_logo(self):
		candidates = [
			{'country': 'Chile', 'logo': ''},
			{'country': 'Argentina', 'logo': LOGO_B},
		]
		self.assertEqual(pick_candidate(candidates, 'BRA', 'Brazil'), candidates[1])

	def test_code_match_requires_a_logo(self):
		candidates = [
			{'country': 'PER', 'logo': ''},
			{'country': 'Peru', 'logo': LOGO_B},
		]
		self.assertEqual(pick_candidate(candidates, 'PER', 'Peru'), candidates[1])

	def test_unresolved_when_no_match_and_no_legacy(self):
		candidates = [{'country': 'Chile', 'logo': ''}]
		self.assertIsNone(pick_candidate(candidates, 'PER', 'Peru'))

	def test_unresolved_when_candidates_empty(self):
		self.assertIsNone(pick_candidate([], 'PER', 'Peru'))

	def test_country_matching_is_case_insensitive(self):
		candidates = [
			{'country': 'peru', 'logo': LOGO_A},
			{'country': 'PERU', 'logo': LOGO_B},
		]
		self.assertEqual(pick_candidate(candidates, 'per', 'peru'), candidates[0])


class BackfillTeamLogosCommandTests(TestCase):
	def setUp(self):
		self.association = Association.objects.create(name='Peru', code='PER')
		self.team = Team.objects.create(
			name='Sport Boys',
			short_name='SB',
			association=self.association,
		)

	@mock.patch.dict(os.environ, {'API_FOOTBALL_KEY': 'test-key'})
	@mock.patch.object(Command, 'api_get')
	def test_dry_run_lists_all_empty_logo_teams_without_api(self, api_get):
		other_association = Association.objects.create(name='Argentina', code='ARG')
		other_team = Team.objects.create(
			name='Union SG',
			short_name='USG',
			association=other_association,
		)
		already_filled = Team.objects.create(
			name='Alianza Lima',
			short_name='AL',
			association=self.association,
			logo_url=LOGO_C,
		)

		out = io.StringIO()
		call_command('backfill_team_logos', '--dry-run', stdout=out)
		output = out.getvalue()

		self.assertIn('Sport Boys [PER]', output)
		self.assertIn('Union SG [ARG]', output)
		self.assertNotIn('Alianza Lima', output)
		api_get.assert_not_called()

	@mock.patch.dict(os.environ, {'API_FOOTBALL_KEY': 'test-key'})
	@mock.patch.object(Command, 'api_get')
	def test_resolve_updates_logo_in_place(self, api_get):
		api_get.return_value = {
			'response': [
				{'team': {'country': 'Chile', 'logo': LOGO_A}},
				{'team': {'country': 'Peru', 'logo': LOGO_B}},
			]
		}

		out = io.StringIO()
		call_command('backfill_team_logos', stdout=out)
		output = out.getvalue()

		self.team.refresh_from_db()
		self.assertEqual(self.team.logo_url, LOGO_B)
		self.assertEqual(Team.objects.count(), 1)
		self.assertIn('Backfilled Sport Boys', output)
		api_get.assert_called_once_with('teams', {'search': 'Sport Boys'}, 'test-key')

	@mock.patch.dict(os.environ, {'API_FOOTBALL_KEY': 'test-key'})
	@mock.patch.object(Command, 'api_get')
	def test_unresolved_team_reported_and_left_empty(self, api_get):
		api_get.return_value = {
			'response': [{'team': {'country': 'Chile', 'logo': ''}}]
		}

		err = io.StringIO()
		call_command('backfill_team_logos', stderr=err)

		self.team.refresh_from_db()
		self.assertEqual(self.team.logo_url, '')
		self.assertIn('No match for Sport Boys [PER]', err.getvalue())