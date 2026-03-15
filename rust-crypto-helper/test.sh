#!/bin/bash
set -e

# PluralMatrix Rust Crypto Helper Test Runner
# This script runs static analysis (clippy) and unit tests for the Rust sidecar.

cd "$(dirname "$0")"

echo "🦀 Running Rust Static Analysis (clippy)..."

# Ensure Rust toolchain is available
if ! command -v cargo &> /dev/null; then
    echo "Installing Rust toolchain (cargo)..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi

cargo clippy --all-targets --all-features -- -D warnings

echo "🦀 Running Rust Unit Tests..."
cargo test

echo "✅ Rust checks and tests passed successfully!"
