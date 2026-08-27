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

EXPOSE 8000
CMD ["gunicorn", "champions_draw.wsgi:application", "--bind", "0.0.0.0:8000"]
