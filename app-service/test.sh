#!/bin/bash

# PluralMatrix Full Test Runner 🚀
# Runs both Backend (Jest) and UI (Playwright) tests.

if [ -f ../.env ]; then
    export $(grep -v '^#' ../.env | xargs 2>/dev/null)
fi
PROJECT_NAME=${PROJECT_NAME:-pluralmatrix}
HOMESERVER_YAML="../synapse/config/homeserver.yaml"
RATE_LIMITS_RELAXED=false

# Check if rate limits are already relaxed
if grep -q "^rc_registration:" "$HOMESERVER_YAML"; then
    RATE_LIMITS_RELAXED=true
else
    echo "⚠️ Relaxing rate limits in homeserver.yaml for tests..."
    if grep -q "^# rc_registration:" "$HOMESERVER_YAML"; then
        sudo sed -i "s/^# rc_registration:/rc_registration:/g" "$HOMESERVER_YAML"
        sudo sed -i "s/^#   address:/  address:/g" "$HOMESERVER_YAML"
        sudo sed -i "s/^#     per_second: 50/    per_second: 50/g" "$HOMESERVER_YAML"
        sudo sed -i "s/^#     burst_count: 100/    burst_count: 100/g" "$HOMESERVER_YAML"
        sudo sed -i "s/^# rc_login:/rc_login:/g" "$HOMESERVER_YAML"
        sudo sed -i "s/^# rc_message:/rc_message:/g" "$HOMESERVER_YAML"
        sudo sed -i "s/^#   per_second: 100/  per_second: 100/g" "$HOMESERVER_YAML"
        sudo sed -i "s/^#   burst_count: 1000/  burst_count: 1000/g" "$HOMESERVER_YAML"
    else
        cat <<EOF | sudo tee -a "$HOMESERVER_YAML" > /dev/null

rc_registration:
  address:
    per_second: 50
    burst_count: 100
rc_login:
  address:
    per_second: 50
    burst_count: 100
rc_message:
  per_second: 100
  burst_count: 1000
EOF
    fi
    echo "🔄 Restarting Synapse container to apply rate limits..."
    sudo docker restart "${PROJECT_NAME}-synapse" > /dev/null
    sleep 5
fi

npm install --save-dev jest

echo "🏗️  Starting PluralMatrix Backend Tests (Jest)..."
npx jest --forceExit --detectOpenHandles "$@"
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

if [ "$RATE_LIMITS_RELAXED" = false ]; then
    echo "♻️ Restoring rate limits in homeserver.yaml..."
    sudo sed -i "s/^rc_registration:/# rc_registration:/g" "$HOMESERVER_YAML"
    sudo sed -i "s/^  address:/#   address:/g" "$HOMESERVER_YAML"
    sudo sed -i "s/^    per_second: 50/#     per_second: 50/g" "$HOMESERVER_YAML"
    sudo sed -i "s/^    burst_count: 100/#     burst_count: 100/g" "$HOMESERVER_YAML"
    sudo sed -i "s/^rc_login:/# rc_login:/g" "$HOMESERVER_YAML"
    sudo sed -i "s/^rc_message:/# rc_message:/g" "$HOMESERVER_YAML"
    sudo sed -i "s/^  per_second: 100/#   per_second: 100/g" "$HOMESERVER_YAML"
    sudo sed -i "s/^  burst_count: 1000/#   burst_count: 1000/g" "$HOMESERVER_YAML"
    echo "🔄 Restarting Synapse container to restore rate limits..."
    sudo docker restart "${PROJECT_NAME}-synapse" > /dev/null
    sleep 5
fi

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
