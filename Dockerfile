# ---- Build stage (Node + Python) ----
FROM python:3.13-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY package.json package-lock.json ./
RUN npm ci
COPY frontend/ frontend/
COPY vite.config.js ./
RUN npm run build

COPY . .
RUN python manage.py collectstatic --noinput

# ---- Runtime (Python only) ----
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /usr/local/lib/python3.13/site-packages /usr/local/lib/python3.13/site-packages
COPY --from=build /usr/local/bin/gunicorn /usr/local/bin/gunicorn
COPY --from=build /app .

# Informational only: Docker never binds this, and Railway routes to its own
# dynamic $PORT. 8000 documents the fallback the CMD uses when $PORT is unset
# (local docker compose), so it stays aligned with the ${PORT:-8000} bind below.
EXPOSE 8000

# Shell form on purpose: ${PORT:-8000} must expand at container start. Railway
# injects $PORT; local compose leaves it unset and gets 8000. The whole startup
# sequence lives here because Railway ignores railway.json's startCommand and
# builds this Dockerfile instead. --noinput keeps migrate/collectstatic from
# blocking on a prompt in a non-interactive container.
CMD ["sh", "-c", "python manage.py migrate --noinput && python manage.py bootstrap_season && python manage.py collectstatic --noinput && gunicorn champions_draw.wsgi:application --bind 0.0.0.0:${PORT:-8000}"]
