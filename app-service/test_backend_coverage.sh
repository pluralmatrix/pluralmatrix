#!/bin/bash
set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT/app-service"

PROJECT_NAME=${PROJECT_NAME:-pluralmatrix}

echo "🧹 Fixing permissions on coverage directories..."
sudo chown -R $USER:$USER test-results coverage 2>/dev/null || true

echo "🏗️  Rebuilding standard stack..."
../restart-stack.sh

echo "🛡️  Fixing Synapse permissions..."
S_UID=${SYNAPSE_UID:-991}
S_GID=${SYNAPSE_GID:-991}
sudo chown -R $S_UID:$S_GID ../synapse/config 2>/dev/null || true

echo "⚠️  Restarting Synapse and App Service with relaxed rate limits for E2E testing..."
sudo docker compose -f ../docker-compose.yml -f ../docker-compose.e2e.yml up -d synapse
sudo docker compose -f ../docker-compose.yml restart app-service

echo "⏳ Waiting for Synapse to settle..."
until [ "$(sudo docker inspect -f '{{.State.Health.Status}}' ${PROJECT_NAME}-synapse)" == "healthy" ]; do
  echo -n "."
  sleep 2
done
echo " Synapse is healthy!"

echo "🏗️  Starting PluralMatrix Backend Tests (Jest) with Coverage..."
npx jest --coverage --forceExit "$@"

echo "♻️  Restoring normal rate limits..."
sudo docker compose -f ../docker-compose.yml up -d synapse
sudo docker compose -f ../docker-compose.yml restart app-service
sleep 5

echo "✅ Backend coverage run complete!"
