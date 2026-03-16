#!/bin/bash
set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT/app-service"

PROJECT_NAME=${PROJECT_NAME:-pluralmatrix}

echo "🧹 Fixing permissions on coverage directories..."
sudo chown -R $USER:$USER test-results .nyc_output coverage coverage-ui 2>/dev/null || true

echo "🏗️  Building instrumented frontend..."
cd client
VITE_COVERAGE=true npm run build
cd ..

echo "🚚 Deploying instrumented frontend to Docker container..."
sudo docker cp ./client/dist ${PROJECT_NAME}-app-service:/app/client/

echo "🏗️  Rebuilding stack with instrumented frontend..."
COVERAGE=true ../restart-stack.sh

echo "🛡️  Fixing Synapse permissions..."
S_UID=${SYNAPSE_UID:-991}
S_GID=${SYNAPSE_GID:-991}
sudo chown -R $S_UID:$S_GID ../synapse/config 2>/dev/null || true

echo "⚠️  Restarting Synapse and App Service with relaxed rate limits for E2E testing..."
sudo docker compose -f ../docker-compose.yml -f ../docker-compose.e2e.yml up -d synapse
# We MUST also restart the app service so its in-memory device cache doesn't desync from Synapse
sudo docker compose -f ../docker-compose.yml restart app-service

echo "⏳ Waiting for Synapse to settle..."
until [ "$(sudo docker inspect -f '{{.State.Health.Status}}' ${PROJECT_NAME}-synapse)" == "healthy" ]; do
  echo -n "."
  sleep 2
done
echo " Synapse is healthy!"

echo "🎭 Running Playwright tests with coverage tracking..."
# Run Playwright in Docker just like in test.sh so it has the right environment
sudo docker run --rm --network host --ipc=host -v "$(pwd)/..:/app" -w /app/app-service mcr.microsoft.com/playwright:v1.58.2-jammy npm run test:ui:coverage

echo "♻️  Restoring normal rate limits..."
sudo docker compose -f ../docker-compose.yml up -d synapse
sudo docker compose -f ../docker-compose.yml restart app-service
sleep 5

echo "🧼 Rebuilding standard, non-instrumented frontend for normal operation..."
cd client
npm run build
cd ..
sudo docker cp ./client/dist ${PROJECT_NAME}-app-service:/app/client/

echo "✅ UI Coverage run complete! See the report in app-service/coverage-ui"
