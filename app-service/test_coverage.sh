#!/bin/bash

# PluralMatrix Coverage Runner 📊
# This script automates building the frontend with instrumentation, injecting it into
# the running container, and running the Playwright UI coverage suite.

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT/app-service"

echo "🧹 Fixing permissions on coverage directories..."
sudo chown -R $USER:$USER test-results .nyc_output coverage coverage-ui 2>/dev/null || true

echo "🏗️  Building instrumented frontend..."
cd client
VITE_COVERAGE=true npm run build

echo "🚚 Deploying instrumented frontend to Docker container..."
cd ..
PROJECT_NAME=${PROJECT_NAME:-pluralmatrix}
sudo docker cp ./client/dist ${PROJECT_NAME}-app-service:/app/client/

echo "⚠️  Restarting Synapse with relaxed rate limits for E2E testing..."
sudo docker compose -f ../docker-compose.yml -f ../docker-compose.e2e.yml up -d synapse

echo "⏳ Waiting for Synapse to settle..."
until [ "$(sudo docker inspect -f '{{.State.Health.Status}}' ${PROJECT_NAME}-synapse)" == "healthy" ]; do
  echo -n "."
  sleep 2
done
echo " Synapse is healthy!"

echo "🎭 Running Playwright tests with coverage tracking..."
npm run test:ui:coverage

echo "♻️  Restoring normal Synapse configuration..."
sudo docker compose -f ../docker-compose.yml up -d synapse

echo "🧼 Rebuilding standard, non-instrumented frontend for normal operation..."
cd client
npm run build
cd ..
sudo docker cp ./client/dist ${PROJECT_NAME}-app-service:/app/client/

echo "✅ Coverage run complete! See the report above."