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

# Every service built from this image runs the same CMD, because Railway
# honours the Dockerfile CMD and ignores each service's startCommand. The
# role is chosen at runtime by SERVICE_ROLE inside docker-entrypoint.sh --
# that script is the single source of truth for startup order and is NOT
# dead code: deleting it reverts all three services to running the web
# sequence. It ships via the build stage's `COPY . .` above, so no extra COPY
# is needed; we invoke it with `sh` so it runs even when the copied file has no
# exec bit (a Windows checkout does not guarantee one in git).
CMD ["sh", "/app/docker-entrypoint.sh"]
