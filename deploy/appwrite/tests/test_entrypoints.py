import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from multidict import CIMultiDict
from yarl import URL


def request(method, path, body=b'', headers=()):
    async def read():
        return body

    return SimpleNamespace(
        method=method,
        raw_path=path,
        rel_url=URL(path, encoded=True),
        raw_headers=[(name.encode(), value.encode()) for name, value in headers],
        version=SimpleNamespace(major=1, minor=1),
        remote='192.0.2.14',
        read=read,
    )


class HttpAdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_preserves_exact_query_and_separate_response_cookies(self):
        from deploy.appwrite.django_http import dispatch

        async def application(scope, receive, send):
            self.assertEqual(scope['path'], '/api/league-manager/account/')
            self.assertEqual(scope['query_string'], b'lookup=one%20two&lookup=%2b')
            self.assertEqual(scope['method'], 'GET')
            self.assertEqual(await receive(), {'type': 'http.request', 'body': b'', 'more_body': False})
            await send({'type': 'http.response.start', 'status': 200, 'headers': [
                (b'content-type', b'application/json'),
                (b'set-cookie', b'csrftoken=rotated; Path=/; Secure'),
                (b'set-cookie', b'sessionid=owner; Path=/; HttpOnly; Secure'),
            ]})
            await send({'type': 'http.response.body', 'body': b'{"user":1}'})

        response = await dispatch(request('GET', '/api/league-manager/account/?lookup=one%20two&lookup=%2b'), application)
        self.assertEqual(response.status, 200)
        self.assertEqual(response.body, b'{"user":1}')
        self.assertEqual(response.headers['Content-Type'], 'application/json')
        self.assertEqual(response.headers.getall('Set-Cookie'), [
            'csrftoken=rotated; Path=/; Secure',
            'sessionid=owner; Path=/; HttpOnly; Secure',
        ])

    async def test_forwards_json_body_without_trusting_proxy_headers(self):
        from deploy.appwrite.django_http import dispatch

        payload = b'{"home_goals":0,"away_goals":3}'

        async def application(scope, receive, send):
            self.assertEqual(scope['method'], 'PUT')
            self.assertEqual(scope['path'], '/api/league-manager/leagues/1/fixtures/2/result/')
            self.assertEqual(scope['scheme'], 'https')
            self.assertEqual(scope['client'], ('192.0.2.14', 0))
            self.assertEqual(dict(scope['headers']), {
                b'host': b'backend.example.test',
                b'origin': b'https://frontend.example.test',
                b'content-type': b'application/json',
                b'cookie': b'sessionid=owner',
                b'x-csrftoken': b'csrf',
                b'content-length': b'31',
            })
            self.assertEqual((await receive())['body'], payload)
            await send({'type': 'http.response.start', 'status': 409, 'headers': [(b'content-type', b'application/json')]})
            await send({'type': 'http.response.body', 'body': b'{"error":', 'more_body': True})
            await send({'type': 'http.response.body', 'body': b'"conflict"}'})

        response = await dispatch(request(
            'PUT', '/api/league-manager/leagues/1/fixtures/2/result/', payload, [
                ('Host', 'backend.example.test'),
                ('Origin', 'https://frontend.example.test'),
                ('Content-Type', 'application/json'),
                ('Cookie', 'sessionid=owner'),
                ('X-CSRFToken', 'csrf'),
                ('X-Forwarded-Proto', 'http'),
                ('Forwarded', 'host=other.example.test'),
                ('X-Forwarded-For', '192.0.2.27'),
                ('X-Open-Runtimes-Secret', 'runtime-only'),
                ('X-Appwrite-Key', 'runtime-only'),
            ],
        ), application)
        self.assertEqual(response.status, 409)
        self.assertEqual(response.body, b'{"error":"conflict"}')

    async def test_skips_non_api_paths_and_rejects_encoded_separators(self):
        from deploy.appwrite.django_http import dispatch

        async def application(*args):
            self.fail('Request must not reach Django')

        for path, expected in [('/league-manager/', 404), ('/api%2Fleague-manager/', 400)]:
            with self.subTest(path=path):
                response = await dispatch(request('GET', path), application)
                self.assertEqual(response.status, expected)


class RuntimeConfigurationTests(unittest.TestCase):
    env = dict(
        DJANGO_DEBUG='false',
        DJANGO_SECRET_KEY='an-example-test-secret',
        DJANGO_ALLOWED_HOSTS='backend.example.test',
        DATABASE_URL='postgresql://app:secret@db.example.test/champions',
    )

    def test_requires_postgresql_and_explicit_secure_django_configuration(self):
        from deploy.appwrite.runtime import validate_environment

        validate_environment(self.env)
        for key, value in [
            ('DATABASE_URL', ''),
            ('DATABASE_URL', 'sqlite:///db.sqlite3'),
            ('DJANGO_SECRET_KEY', ''),
            ('DJANGO_ALLOWED_HOSTS', ''),
            ('DJANGO_DEBUG', 'true'),
            ('DJANGO_SESSION_COOKIE_SECURE', '0'),
            ('DJANGO_CSRF_COOKIE_SECURE', 'false'),
        ]:
            with self.subTest(key=key, value=value):
                with self.assertRaisesRegex(RuntimeError, key):
                    validate_environment({**self.env, key: value})


class ScheduledExecutionTests(unittest.IsolatedAsyncioTestCase):
    def context(self, trigger):
        return SimpleNamespace(
            req=SimpleNamespace(headers=CIMultiDict({'x-appwrite-trigger': trigger})),
            res=SimpleNamespace(json=lambda payload, code=200: (code, payload)),
            log=Mock(),
            error=Mock(),
        )

    async def test_only_schedule_triggers_dispatch_the_runner(self):
        from deploy.appwrite.runtime import scheduled_response

        job = Mock()
        response = await scheduled_response(self.context('http'), job)
        self.assertEqual(response[0], 403)
        job.assert_not_called()
        response = await scheduled_response(self.context('schedule'), job)
        self.assertEqual(response[0], 200)
        job.assert_called_once_with()

    async def test_logs_generic_failure_and_propagates_execution_failure(self):
        from deploy.appwrite.runtime import scheduled_response

        context = self.context('schedule')
        with self.assertRaisesRegex(RuntimeError, 'sync execution failed'):
            await scheduled_response(context, Mock(side_effect=ValueError('do not log credentials')))
        self.assertNotIn('do not log credentials', str(context.error.call_args))

    async def test_sync_jobs_dispatch_the_expected_management_command_sequence(self):
        from deploy.appwrite import sync_leagues, sync_results

        for module, expected in [
            (sync_leagues, [
                ('sync_leagues',),
                ('sync_promiedos_fixtures', '--competition', 'lib'),
                ('sync_promiedos_fixtures', '--competition', 'sud'),
                ('sync_promiedos_friendlies',),
                ('sync_promiedos_nations_league', '--competition', 'unl'),
                ('sync_match_history',),
            ]),
            (sync_results, [
                ('sync_real_fixture_results', '--source', 'promiedos'),
                ('sync_promiedos_fixtures', '--competition', 'lib'),
                ('sync_promiedos_fixtures', '--competition', 'sud'),
                ('sync_promiedos_nations_league', '--competition', 'unl'),
                ('sync_promiedos_friendlies',),
                ('backfill_national_flags',),
                ('sync_league_fixtures',),
            ]),
        ]:
            with self.subTest(job=module.__name__):
                with patch.object(module, 'run_commands') as runner:
                    self.assertEqual((await module.main(self.context('schedule')))[0], 200)
                self.assertEqual(list(runner.call_args.args[0]), expected)
