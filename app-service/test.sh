#!/bin/bash

# PluralMatrix App Service Test Runner
# Use this script to run the backend and E2E tests safely.

echo "🚀 Running PluralMatrix App Service Tests..."

# We use --forceExit to ensure the Rust Matrix Crypto library 
# doesn't keep the process alive indefinitely after tests complete.
# We also use --detectOpenHandles to gracefully report any remaining handles.

npx jest --forceExit --detectOpenHandles "$@"
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ All tests passed successfully!"
else
    echo "❌ Tests failed with exit code $EXIT_CODE."
fi

exit $EXIT_CODE
