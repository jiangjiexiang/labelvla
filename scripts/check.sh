#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose ps
curl --fail --silent --show-error "http://127.0.0.1:${LABELVLA_PORT:-8002}/api/health"
echo
