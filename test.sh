#!/bin/bash
set -e

# PluralMatrix Root Test Runner 🚀
# Runs the Synapse module tests, followed by the App Service full test suite.

# Change to the script's directory (project root)
cd "$(dirname "$0")"

echo "=== Running Synapse Module Tests ==="
(cd synapse/modules && ./test.sh)

echo ""
echo "=== Running Rust Crypto Helper Tests ==="
(cd rust-crypto-helper && ./test.sh)

echo ""
echo "=== Running App Service Tests ==="
(cd app-service && ./test.sh "$@")

echo ""
echo "🌟 ALL PROJECT TEST SUITES PASSED 🌟"
