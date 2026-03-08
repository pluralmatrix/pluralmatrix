#!/bin/bash

# PluralMatrix Backend Coverage Runner 📊

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT/app-service"

echo "🧹 Fixing permissions on coverage directories..."
sudo chown -R $USER:$USER coverage test-results 2>/dev/null || true

echo "🏗️  Starting PluralMatrix Backend Tests (Jest) with Coverage..."
npx jest --coverage --forceExit "$@"

echo "✅ Backend coverage run complete! See the report above."
