#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose build app
docker build -f tests/Dockerfile -t labelvla-unified:test .
docker run --rm --user "$(id -u):$(id -g)" labelvla-unified:test
