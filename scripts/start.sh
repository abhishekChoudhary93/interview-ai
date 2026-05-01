#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Tear down any existing project (no-op if the stack was never created)
docker compose --env-file .env.local -f docker-compose.yml down --remove-orphans || true
exec docker compose --env-file .env.local -f docker-compose.yml up --build -d
