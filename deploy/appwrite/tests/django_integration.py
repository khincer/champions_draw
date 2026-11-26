import json
from http.cookies import SimpleCookie
from types import SimpleNamespace
from urllib.parse import urlsplit

from django.contrib.auth import get_user_model
from django.core.asgi import get_asgi_application
from django.test import TransactionTestCase, override_settings


def request(method, path, *, body=b'', headers=()):
    async def read():
        return body

    return SimpleNamespace(
        method=method,
        raw_path=path,
        rel_url=urlsplit(path),
        raw_headers=[
            (b'host', b'backend.example.test'),
            *((name.encode(), value.encode()) for name, value in headers),
        ],
        version=SimpleNamespace(major=1, minor=1),
        remote='192.0.2.14',
        read=read,
    )


@override_settings(
    ALLOWED_HOSTS=['backend.example.test'],
    CSRF_TRUSTED_ORIGINS=['https://frontend.example.test'],
    SESSION_COOKIE_SECURE=True,
    CSRF_COOKIE_SECURE=True,
    SECURE_SSL_REDIRECT=True,
)
class DjangoAdapterIntegrationTests(TransactionTestCase):
    def setUp(self):
        get_user_model().objects.create_user(username='owner', password='staging-test-password')

    async def test_django_login_rejects_invalid_origin_and_preserves_both_cookies(self):
        from deploy.appwrite.django_http import exchange

        application = get_asgi_application()
        status, headers, _ = await exchange(request('GET', '/api/league-manager/account/'), application)
        self.assertEqual(status, 200)
        cookies = SimpleCookie()
        for name, value in headers:
            if name.lower() == b'set-cookie':
                cookies.load(value.decode())
        csrf = cookies['csrftoken'].value
        credentials = b'{"username":"owner","password":"staging-test-password"}'
        auth_headers = [
            ('Content-Type', 'application/json'),
            ('Cookie', f'csrftoken={csrf}'),
            ('X-CSRFToken', csrf),
        ]

        status, _, _ = await exchange(request(
            'POST', '/api/league-manager/account/login/', body=credentials,
            headers=[*auth_headers, ('Origin', 'https://unexpected.example.test')],
        ), application)
        self.assertEqual(status, 403)

        status, headers, body = await exchange(request(
            'POST', '/api/league-manager/account/login/', body=credentials,
            headers=[*auth_headers, ('Origin', 'https://frontend.example.test')],
        ), application)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['username'], 'owner')
        cookie_headers = [value.decode() for name, value in headers if name.lower() == b'set-cookie']
        self.assertEqual(len(cookie_headers), 2)
        cookies = SimpleCookie()
        for cookie in cookie_headers:
            cookies.load(cookie)
        self.assertNotEqual(cookies['csrftoken'].value, csrf)
        self.assertTrue(cookies['sessionid']['httponly'])
        self.assertTrue(cookies['sessionid']['secure'])
