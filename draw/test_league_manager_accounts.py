import json
from unittest.mock import patch
from uuid import uuid4

from django.core.cache import cache
from django.http import HttpResponse
from django.test import Client, SimpleTestCase, TestCase, override_settings

from draw.models import Season


class LeagueManagerEntryTests(SimpleTestCase):
    @patch('champions_draw.ui_views.serve_frontend_index', return_value=HttpResponse('shell'))
    def test_direct_owner_and_guest_links_serve_the_app(self, serve_index):
        owner = self.client.get('/league-manager/')
        guest = self.client.get(f'/league-manager/share/{uuid4()}/')
        self.assertEqual(owner.status_code, 200)
        self.assertEqual(guest.status_code, 200)
        self.assertEqual(guest['Referrer-Policy'], 'no-referrer')
        self.assertEqual(guest['X-Robots-Tag'], 'noindex')
        self.assertIn('no-store', guest['Cache-Control'])
        self.assertEqual(serve_index.call_count, 2)


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class LeagueManagerAccountsTests(TestCase):
    base = '/api/league-manager/account/'
    credentials = {'username': 'league-owner', 'password': 'proper-horse-balance-64'}

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.client = Client(enforce_csrf_checks=True)
        self.guest = Client(enforce_csrf_checks=True)

    def post(self, endpoint, body, *, client=None, csrf=True):
        client = client or self.client
        if csrf and 'csrftoken' not in client.cookies:
            client.get(self.base)
        headers = {'X-CSRFToken': client.cookies['csrftoken'].value} if csrf else {}
        return client.post(self.base + endpoint, json.dumps(body), content_type='application/json', headers=headers)

    def test_account_lifecycle_and_session_isolation(self):
        self.assertEqual(self.client.get(self.base).json(), {'username': None})
        self.assertEqual(self.post('register/', self.credentials).status_code, 201)
        self.assertEqual(self.client.get(self.base).json(), {'username': 'league-owner'})
        self.assertEqual(self.guest.get(self.base).json(), {'username': None})
        self.assertEqual(self.post('logout/', {}).status_code, 200)
        self.assertEqual(self.client.get(self.base).json(), {'username': None})
        self.assertEqual(self.post('login/', self.credentials).json(), {'username': 'league-owner'})

    def test_registration_and_login_require_csrf_before_authentication(self):
        self.client.get(self.base)
        for endpoint in ('register/', 'login/', 'logout/'):
            with self.subTest(endpoint=endpoint):
                self.assertEqual(self.post(endpoint, self.credentials, csrf=False).status_code, 403)

    def test_rate_limit_applies_to_repeated_failed_login_attempts(self):
        for _ in range(10):
            self.assertEqual(self.post('login/', self.credentials).status_code, 401)
        self.assertEqual(self.post('login/', self.credentials).status_code, 429)

    def test_weak_password_cannot_create_an_account(self):
        self.assertEqual(self.post('register/', {'username': 'league-owner', 'password': '1234'}).status_code, 400)
        self.assertEqual(self.client.get(self.base).json(), {'username': None})

    def test_registered_owner_cannot_seed_a_shared_season(self):
        season = Season.objects.create(name='2030-31')
        self.assertEqual(self.post('register/', self.credentials).status_code, 201)
        response = self.client.post(
            f'/api/seasons/{season.pk}/seed/',
            headers={'X-CSRFToken': self.client.cookies['csrftoken'].value},
        )
        self.assertEqual(response.status_code, 403)
