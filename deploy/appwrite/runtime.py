import asyncio
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit


SETTINGS_MODULE = 'deploy.appwrite.settings'


def validate_environment(env):
    for name in ('DJANGO_SECRET_KEY', 'DJANGO_ALLOWED_HOSTS'):
        if not env.get(name, '').strip():
            raise RuntimeError(f'{name} is required.')

    hosts = [host.strip() for host in env['DJANGO_ALLOWED_HOSTS'].split(',') if host.strip()]
    if not hosts or '*' in hosts:
        raise RuntimeError('DJANGO_ALLOWED_HOSTS must list allowed hosts explicitly.')
    if env.get('DJANGO_DEBUG', '').strip().lower() not in {'0', 'false', 'no', 'off'}:
        raise RuntimeError('DJANGO_DEBUG must be disabled.')
    for name in ('DJANGO_SESSION_COOKIE_SECURE', 'DJANGO_CSRF_COOKIE_SECURE'):
        if env.get(name, 'true').strip().lower() not in {'1', 'true', 'yes', 'on'}:
            raise RuntimeError(f'{name} must be enabled.')

    try:
        db = urlsplit(env.get('DATABASE_URL', '').strip())
        valid = db.scheme in {'postgres', 'postgresql'} and db.hostname and db.path.strip('/')
    except ValueError:
        valid = False
    if not valid:
        raise RuntimeError('DATABASE_URL must specify an explicit PostgreSQL database.')


def configure_django():
    validate_environment(os.environ)
    # Open Runtimes imports this file under the function namespace, while
    # Django's settings and app names resolve from the deployed repository root.
    root = str(Path(__file__).resolve().parents[2])
    if root not in sys.path:
        sys.path.insert(0, root)
    if os.environ.setdefault('DJANGO_SETTINGS_MODULE', SETTINGS_MODULE) != SETTINGS_MODULE:
        raise RuntimeError(f'DJANGO_SETTINGS_MODULE must be {SETTINGS_MODULE}.')


def run_commands(commands):
    configure_django()
    import django
    from django.core.management import call_command
    from django.db import connections

    django.setup()
    try:
        for name, *args in commands:
            call_command(name, *args)
    finally:
        connections.close_all()


async def scheduled_response(context, run):
    if context.req.headers.get('x-appwrite-trigger') != 'schedule':
        return context.res.json({'detail': 'Scheduled execution required.'}, 403)
    try:
        await asyncio.to_thread(run)
    except Exception as error:
        context.error(f'League sync failed ({type(error).__name__}).')
        raise RuntimeError('League sync execution failed.') from None
    return context.res.json({'ok': True})
