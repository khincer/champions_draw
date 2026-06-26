web: python manage.py migrate && python manage.py collectstatic --noinput && gunicorn champions_draw.wsgi:application --bind 0.0.0.0:${PORT:-8000}
