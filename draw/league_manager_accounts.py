import json
from hashlib import sha256

from django.contrib.auth import login, logout
from django.contrib.auth.forms import AuthenticationForm, UserCreationForm
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.urls import path
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

ATTEMPT_LIMIT = 10
ATTEMPT_WINDOW_SECONDS = 600


def account_payload(request):
    return {'username': request.user.get_username() if request.user.is_authenticated else None}


def credentials_from(request):
    try:
        payload = json.loads(request.body)
    except (UnicodeDecodeError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    username, password = payload.get('username'), payload.get('password')
    if not isinstance(username, str) or not isinstance(password, str):
        return None
    username = username.strip()
    if not username or len(username) > 150 or not password or len(password) > 128:
        return None
    try:
        username.encode()
        password.encode()
    except UnicodeEncodeError:
        return None
    return {'username': username, 'password': password}


def throttle(request, operation, username='', *, limit=ATTEMPT_LIMIT):
    identity = f'{request.META.get("REMOTE_ADDR", "")}:{username.casefold()}'
    key = f'league-manager:{operation}:{sha256(identity.encode()).hexdigest()}'
    if cache.add(key, 1, ATTEMPT_WINDOW_SECONDS):
        return False
    try:
        return cache.incr(key) > limit
    except ValueError:
        cache.add(key, 1, ATTEMPT_WINDOW_SECONDS)
        return False


def account_error(code, detail, status):
    return JsonResponse({'code': code, 'detail': detail}, status=status)


def limited():
    return account_error('account_rate_limited', 'Too many attempts. Try again later.', 429)


@require_GET
@never_cache
@ensure_csrf_cookie
def account(request):
    return JsonResponse(account_payload(request))


@require_POST
@never_cache
@csrf_protect
def register(request):
    if request.user.is_authenticated:
        return account_error('account_already_signed_in', 'Sign out before creating another account.', 409)
    if throttle(request, 'register'):
        return limited()
    credentials = credentials_from(request)
    if credentials is None:
        return account_error('account_registration_invalid', 'Enter a valid username and password.', 400)
    form = UserCreationForm(data={
        'username': credentials['username'],
        'password1': credentials['password'],
        'password2': credentials['password'],
    })
    if not form.is_valid():
        return account_error(
            'account_registration_invalid',
            'The username is unavailable or the password does not meet the requirements.',
            400,
        )
    try:
        with transaction.atomic():
            user = form.save()
    except IntegrityError:
        return account_error('account_registration_invalid', 'The username is unavailable.', 400)
    login(request, user)
    return JsonResponse(account_payload(request), status=201)


@require_POST
@never_cache
@csrf_protect
def sign_in(request):
    credentials = credentials_from(request)
    if credentials is None:
        return account_error('account_login_invalid', 'Invalid username or password.', 401)
    if throttle(request, 'login-ip', limit=100) or throttle(request, 'login', credentials['username']):
        return limited()
    form = AuthenticationForm(request, data=credentials)
    if not form.is_valid():
        return account_error('account_login_invalid', 'Invalid username or password.', 401)
    login(request, form.get_user())
    return JsonResponse(account_payload(request))


@require_POST
@never_cache
@csrf_protect
def sign_out(request):
    logout(request)
    return JsonResponse(account_payload(request))


urlpatterns = [
    path('', account, name='league-manager-account'),
    path('register/', register, name='league-manager-register'),
    path('login/', sign_in, name='league-manager-login'),
    path('logout/', sign_out, name='league-manager-logout'),
]
