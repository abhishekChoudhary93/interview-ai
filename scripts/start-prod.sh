#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose --env-file .env.production -f docker-compose.prod.yml down --remove-orphans || true
exec docker compose --env-file .env.production -f docker-compose.prod.yml up --build -d
