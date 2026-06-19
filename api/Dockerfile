FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1

WORKDIR /app

# curl is required for the docker-compose health check
RUN apt-get update && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

# Install deps first (layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir --quiet --upgrade pip \
 && pip install --no-cache-dir --quiet --root-user-action=ignore -r requirements.txt

COPY . .

# Data directory for SQLite persistence (mounted as a volume)
RUN mkdir -p /app/data \
 && adduser --system --no-create-home --uid 1001 appuser \
 && chown -R appuser /app/data

USER appuser

EXPOSE 8099

# main.py startup event handles migrations (Alembic for Postgres, create_all for SQLite)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8099"]
