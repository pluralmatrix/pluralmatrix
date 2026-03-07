#!/bin/bash

# PluralMatrix Stop Helper Script 🛑

# Load configuration from .env
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

PROJECT_NAME=${PROJECT_NAME:-pluralmatrix}
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "🌌 Stopping $PROJECT_NAME Stack via Docker Compose..."

# Gracefully stop the containers and networks managed by compose
sudo docker compose down

echo "✅ All services stopped. Data remains safe in Docker volumes."
