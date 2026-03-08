#!/bin/bash

# PluralMatrix Full Test Runner 🚀
# Runs both Backend (Jest) and UI (Playwright) tests.

if [ -f ../.env ]; then
    export $(grep -v '^#' ../.env | xargs 2>/dev/null)
fi
PROJECT_NAME=${PROJECT_NAME:-pluralmatrix}

echo "🛡️  Fixing Synapse permissions..."
S_UID=${SYNAPSE_UID:-991}
S_GID=${SYNAPSE_GID:-991}
sudo chown -R $S_UID:$S_GID ../synapse/config 2>/dev/null || true

echo "⚠️  Restarting Synapse with relaxed rate limits for E2E testing..."
# Use the E2E override to mount relaxed limits and concat config paths
sudo docker compose -f ../docker-compose.yml -f ../docker-compose.e2e.yml up -d synapse
# Wait for synapse to be healthy
echo "⏳ Waiting for Synapse to settle..."
# Use docker compose healthcheck
until [ "$(sudo docker inspect -f '{{.State.Health.Status}}' ${PROJECT_NAME}-synapse)" == "healthy" ]; do
  echo -n "."
  sleep 2
done
echo " Synapse is healthy!"

npm install --save-dev jest

echo "🏗️  Starting PluralMatrix Backend Tests (Jest)..."
npx jest --forceExit "$@"
JEST_EXIT_CODE=$?

if [ $JEST_EXIT_CODE -eq 0 ]; then
    echo "✅ Backend tests passed!"
else
    echo "❌ Backend tests failed."
fi

echo ""
echo "🎭 Starting PluralMatrix UI Tests (Playwright) via Docker..."
sudo docker run --rm --network host --ipc=host -v "$(pwd)/..:/app" -w /app/app-service mcr.microsoft.com/playwright:v1.58.2-jammy npx playwright test
PW_EXIT_CODE=$?

if [ $PW_EXIT_CODE -eq 0 ]; then
    echo "✅ UI tests passed!"
else
    echo "❌ UI tests failed."
fi

echo "♻️  Restoring normal rate limits..."
# Start synapse without the override to restore normal command and volumes
sudo docker compose -f ../docker-compose.yml up -d synapse
sleep 5

# Final verdict
if [ $JEST_EXIT_CODE -eq 0 ] && [ $PW_EXIT_CODE -eq 0 ]; then
    echo ""
    echo "🏆 ALL TESTS PASSED SUCCESSFULLY! 🏅"
    exit 0
else
    echo ""
    echo "🛑 TEST SUITE FAILED. Please review the errors above."
    exit 1
fi
