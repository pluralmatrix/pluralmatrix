#!/bin/bash

# PluralMatrix Synapse Module Test Runner
# This script runs the Python unit tests for the Plural Gatekeeper module.
# It automatically executes them inside the running Synapse container.

echo "🚀 Running PluralGatekeeper Module Tests..."

# Determine Project Name
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT_NAME="pluralmatrix"

if [ -f "$PROJECT_ROOT/.env" ]; then
    # Extract PROJECT_NAME from .env if present
    ENV_NAME=$(grep '^PROJECT_NAME=' "$PROJECT_ROOT/.env" | cut -d '=' -f2 | tr -d '"' | tr -d "'")
    if [ -n "$ENV_NAME" ]; then
        PROJECT_NAME="$ENV_NAME"
    fi
fi

# Check if the container is running
CONTAINER_NAME="${PROJECT_NAME}-synapse"
if ! sudo docker ps --format '{{.Names}}' | grep -Eq "^${CONTAINER_NAME}\$"; then
    echo "❌ Error: Container '$CONTAINER_NAME' is not running."
    echo "Please start the stack using ./restart-stack.sh first."
    exit 1
fi

# Execute the tests inside the container
sudo docker exec $CONTAINER_NAME bash -c "cd /modules && python3 -m unittest test_plural_gatekeeper.py -v"
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ Module tests passed successfully!"
else
    echo "❌ Module tests failed with exit code $EXIT_CODE."
fi

exit $EXIT_CODE
