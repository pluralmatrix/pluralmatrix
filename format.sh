#!/bin/bash
set -e

# Change to the script's directory (project root)
cd "$(dirname "$0")"

CHECK_MODE=0
if [ "$1" == "--check" ]; then
    CHECK_MODE=1
fi

echo "🔓 Temporarily taking ownership of synapse/modules for formatting..."
sudo chown -R $(id -u):$(id -g) synapse/config/ 2>/dev/null || true

echo "🎨 Processing TypeScript, HTML, CSS, JSON..."
if [ $CHECK_MODE -eq 1 ]; then
    npx prettier --check .
else
    npx prettier --write .
fi

echo "🦀 Processing Rust code..."
if ! command -v cargo &> /dev/null; then
    echo "Installing Rust toolchain (cargo)..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi
(cd rust-crypto-helper && if [ $CHECK_MODE -eq 1 ]; then cargo fmt -- --check; else cargo fmt; fi)

echo "🐍 Processing Python code..."
# Ensure black is available
if ! command -v black &> /dev/null; then
    echo "Installing black..."
    python3 -m pip install black --quiet || true
fi

if [ $CHECK_MODE -eq 1 ]; then
    black synapse/modules/ --check
else
    black synapse/modules/
fi

echo "🔒 Restoring synapse/modules ownership..."
S_UID=${SYNAPSE_UID:-991}
S_GID=${SYNAPSE_GID:-991}
sudo chown -R $S_UID:$S_GID synapse/config/ 2>/dev/null || true

if [ $CHECK_MODE -eq 1 ]; then
    echo "✅ All code passes formatting checks!"
else
    echo "✅ All code formatted successfully!"
fi
