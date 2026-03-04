#!/bin/bash

# PluralMatrix Full Test Runner 🚀
# Runs both Backend (Jest) and UI (Playwright) tests.

echo "🏗️  Starting PluralMatrix Backend Tests (Jest)..."
npx jest --forceExit --detectOpenHandles "$@"
JEST_EXIT_CODE=$?

if [ $JEST_EXIT_CODE -eq 0 ]; then
    echo "✅ Backend tests passed!"
else
    echo "❌ Backend tests failed."
fi

echo ""
echo "🎭 Starting PluralMatrix UI Tests (Playwright)..."
npx playwright test
PW_EXIT_CODE=$?

if [ $PW_EXIT_CODE -eq 0 ]; then
    echo "✅ UI tests passed!"
else
    echo "❌ UI tests failed."
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
