from uuid import uuid4

from django.contrib.auth import get_user_model
from rest_framework.test import APIClient, APITestCase


BASE = '/api/league-manager/'


class LeagueManagerAPITests(APITestCase):
    def setUp(self):
        user = get_user_model()
        self.owner = user.objects.create_user(username='league_owner', password='test-owner-password')
        self.other = user.objects.create_user(username='other_owner', password='test-other-password')
        self.client.force_authenticate(self.owner)

    def create_league(self, teams=None):
        response = self.client.post(
            f'{BASE}leagues/', {'name': 'North Cup', 'team_names': teams or ['Avon', 'Bourne', 'Cove']},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def league_url(self, league):
        return f"{BASE}leagues/{league['id']}/"

    def generate(self, league):
        response = self.client.post(f'{self.league_url(league)}generate/', {}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def result_url(self, league, fixture):
        return f"{self.league_url(league)}fixtures/{fixture['id']}/result/"

    def test_owner_can_replace_draft_teams_but_not_after_generation(self):
        league = self.create_league([' Avon ', 'Bourne'])
        self.assertEqual([team['name'] for team in league['teams']], ['Avon', 'Bourne'])
        self.assertFalse(league['generated'])
        self.assertNotIn('share_id', league)
        url = f'{self.league_url(league)}teams/'
        changed = self.client.put(url, {'team_names': ['Lakes', 'Rivers', 'Mountains']}, format='json')
        self.assertEqual(changed.status_code, 200)
        self.assertEqual(len(self.generate(league)['fixtures']), 3)
        self.assertEqual(self.client.put(url, {'team_names': ['Hills', 'Valleys']}, format='json').status_code, 409)

    def test_team_limits_and_duplicate_names_are_rejected(self):
        for teams in [[], ['Only'], ['Avon', ' avON '], ['Avon', ' '], [str(n) for n in range(37)]]:
            with self.subTest(teams=teams):
                response = self.client.post(f'{BASE}leagues/', {'name': 'North Cup', 'team_names': teams}, format='json')
                self.assertEqual(response.status_code, 400)

    def test_generated_schedule_is_idempotent_and_preserves_results(self):
        league = self.create_league()
        scheduled = self.generate(league)
        fixture = scheduled['fixtures'][0]
        self.assertTrue(scheduled['share_id'])
        response = self.client.put(self.result_url(league, fixture), {'home_goals': 1, 'away_goals': 0}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.generate(league)['fixtures'], response.json()['fixtures'])

    def test_score_can_be_a_nil_nil_draw_corrected_or_cleared(self):
        league = self.create_league()
        fixture = self.generate(league)['fixtures'][0]
        url = self.result_url(league, fixture)
        for (home, away), expected in [((0, 0), (1, 1, 0)), ((3, 1), (1, 3, 2)), ((None, None), (0, 0, 0))]:
            with self.subTest(score=(home, away)):
                response = self.client.put(url, {'home_goals': home, 'away_goals': away}, format='json')
                self.assertEqual(response.status_code, 200, response.content)
                row = next(row for row in response.json()['standings'] if row['team_id'] == fixture['home_team_id'])
                self.assertEqual((row['played'], row['points'], row['goal_diff']), expected)
        for score in [
            {'home_goals': 0}, {'home_goals': 0, 'away_goals': None}, {'home_goals': -1, 'away_goals': 0},
            {'home_goals': 1000, 'away_goals': 0}, {'home_goals': True, 'away_goals': 0},
            {'home_goals': '0', 'away_goals': 0}, {'home_goals': 1.0, 'away_goals': 0},
        ]:
            self.assertEqual(self.client.put(url, score, format='json').status_code, 400)

    def test_owner_list_and_nested_fixture_lookups_do_not_cross_leagues(self):
        owned = self.create_league()
        sibling = self.create_league(['One', 'Two'])
        owned_fixture = self.generate(owned)['fixtures'][0]
        self.generate(sibling)
        score = {'home_goals': 1, 'away_goals': 2}
        self.assertEqual(self.client.put(self.result_url(sibling, owned_fixture), score, format='json').status_code, 404)

        self.client.force_authenticate(self.other)
        other_league = self.create_league(['Three', 'Four'])
        self.assertEqual([row['id'] for row in self.client.get(f'{BASE}leagues/').json()['leagues']], [other_league['id']])
        self.assertEqual(self.client.get(self.league_url(owned)).status_code, 404)
        self.assertEqual(self.client.put(self.result_url(owned, owned_fixture), score, format='json').status_code, 404)
        self.assertEqual(self.client.post(f'{self.league_url(owned)}generate/', {}, format='json').status_code, 404)

    def test_shared_league_is_read_only_and_discloses_no_owner_metadata(self):
        from draw.models import ManagedLeague

        league = self.create_league()
        draft_share_id = ManagedLeague.objects.get(pk=league['id']).share_id
        guest = APIClient()
        self.assertEqual(guest.get(f'{BASE}shared/{draft_share_id}/').status_code, 404)
        self.assertEqual(guest.get(f'{BASE}shared/{uuid4()}/').status_code, 404)
        self.assertEqual(guest.get(f'{BASE}shared/not-a-uuid/').status_code, 404)
        scheduled = self.generate(league)
        share = f"{BASE}shared/{scheduled['share_id']}/"
        response = guest.get(share)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()), {'name', 'teams', 'fixtures', 'standings'})
        self.assertEqual(response.json()['fixtures'], scheduled['fixtures'])
        self.assertEqual(guest.put(share, {}, format='json').status_code, 405)
        self.assertIn(guest.get(self.league_url(league)).status_code, {401, 403})
        self.assertIn(guest.put(self.result_url(league, scheduled['fixtures'][0]), {}, format='json').status_code, {401, 403})

    def test_session_owner_needs_csrf_token_for_unsafe_requests(self):
        session_client = APIClient(enforce_csrf_checks=True)
        self.assertTrue(session_client.login(username=self.owner.get_username(), password='test-owner-password'))
        payload = {'name': 'CSRF Cup', 'team_names': ['Avon', 'Cove']}
        self.assertEqual(session_client.post(f'{BASE}leagues/', payload, format='json').status_code, 403)
        self.assertEqual(session_client.get(f'{BASE}account/').status_code, 200)
        csrf = session_client.cookies['csrftoken'].value
        response = session_client.post(f'{BASE}leagues/', payload, format='json', HTTP_X_CSRFTOKEN=csrf)
        self.assertEqual(response.status_code, 201, response.content)
