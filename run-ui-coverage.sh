#!/bin/bash

# PluralMatrix UI Test Coverage Helper 🧪📈
# This script rebuilds the stack with instrumentation and runs Playwright.

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "🏗️ Rebuilding stack with code instrumentation..."
COVERAGE=true ./restart-stack.sh

echo ""
echo "🎭 Running UI Tests with coverage collection..."
cd app-service
npm run test:ui:coverage

echo ""
echo "📊 Coverage report generated in: app-service/coverage-ui/index.html"
echo "💡 To return to a clean non-instrumented build, run ./restart-stack.sh again."
