import asyncio
from functools import lru_cache

from .runtime import configure_django


HOP_HEADERS = {
    b'connection', b'keep-alive', b'proxy-authenticate', b'proxy-authorization',
    b'proxy-connection', b'te', b'trailer', b'transfer-encoding', b'upgrade',
}
JSON_HEADERS = [(b'content-type', b'application/json')]


def hop_headers(headers):
    connection_tokens = {
        token.strip().lower()
        for name, value in headers if name.lower() == b'connection'
        for token in value.split(b',')
    }
    return HOP_HEADERS | connection_tokens


def django_headers(headers, body):
    excluded = hop_headers(headers) | {b'forwarded', b'x-real-ip', b'content-length'}
    result = [
        (name.lower(), value)
        for name, value in headers
        if name.lower() not in excluded
        and not name.lower().startswith((b'x-forwarded-', b'x-appwrite-', b'x-open-runtimes-'))
    ]
    if body:
        result.append((b'content-length', str(len(body)).encode('ascii')))
    return result


async def exchange(request, application):
    raw_path, _, query = request.raw_path.partition('?')
    path = request.rel_url.path
    if any(separator in raw_path.lower() for separator in ('%2f', '%5c', '%00')) or '\\' in path:
        return 400, JSON_HEADERS, b'{"detail":"Invalid request path."}'
    if not path.startswith('/api/'):
        return 404, JSON_HEADERS, b'{"detail":"Not found."}'

    body = await request.read()
    scope = {
        'type': 'http',
        'asgi': {'version': '3.0', 'spec_version': '2.4'},
        'http_version': f'{request.version.major}.{request.version.minor}',
        'method': request.method,
        'scheme': 'https',
        'path': path,
        'raw_path': raw_path.encode('ascii'),
        'query_string': query.encode('ascii'),
        'root_path': '',
        'headers': django_headers(request.raw_headers, body),
        'client': (request.remote, 0) if request.remote else None,
    }
    sent_request = False
    response = None
    chunks = []

    async def receive():
        nonlocal sent_request
        if not sent_request:
            sent_request = True
            return {'type': 'http.request', 'body': body, 'more_body': False}
        # Django cancels its disconnect listener once the response completes.
        await asyncio.Future()

    async def send(message):
        nonlocal response
        if message['type'] == 'http.response.start':
            response = message
        elif message['type'] == 'http.response.body':
            chunks.append(message.get('body', b''))

    await application(scope, receive, send)
    if response is None:
        return 502, JSON_HEADERS, b'{"detail":"No response from Django."}'

    headers = response['headers']
    excluded = hop_headers(headers)
    return response['status'], [
        (name, value) for name, value in headers if name.lower() not in excluded
    ], b''.join(chunks)


async def dispatch(request, application):
    from aiohttp import web

    status, headers, body = await exchange(request, application)
    return web.Response(
        status=status,
        body=body,
        headers=[(name.decode('ascii'), value.decode('latin-1')) for name, value in headers],
    )


@lru_cache(maxsize=1)
def django_application():
    configure_django()
    from django.core.asgi import get_asgi_application

    return get_asgi_application()


async def main(context):
    return await dispatch(context.req.raw, django_application())
