from pathlib import Path

from django.conf import settings
from django.http import FileResponse, HttpResponse
from django.shortcuts import redirect
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET


@require_GET
@ensure_csrf_cookie
def public_app(request, share_id=None):
    response = serve_frontend_index()
    if share_id is not None:
        response['Referrer-Policy'] = 'no-referrer'
        response['X-Robots-Tag'] = 'noindex'
        response['Cache-Control'] = 'no-store'
    return response


@require_GET
@ensure_csrf_cookie
def console_app(request):
    return redirect('public-app')


def serve_frontend_index():
    index_path = Path(settings.BASE_DIR) / 'static' / 'ui' / 'index.html'
    if not index_path.exists():
        return HttpResponse(
            'The Preact UI has not been built yet. Run `npm install` and `npm run build`.',
            status=503,
            content_type='text/plain',
        )
    return FileResponse(index_path.open('rb'), content_type='text/html')
