import os

from champions_draw.settings import *
from champions_draw.settings import DATABASES as BASE_DATABASES

from .runtime import validate_environment


validate_environment(os.environ)

DATABASES = {
    **BASE_DATABASES,
    'default': {
        **BASE_DATABASES['default'],
        'CONN_MAX_AGE': 0,
        'CONN_HEALTH_CHECKS': False,
    },
}
