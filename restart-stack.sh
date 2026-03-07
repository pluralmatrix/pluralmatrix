#!/bin/bash

# PluralMatrix Restart Helper Script 🚀
# Wrapper around docker compose for pre-flight permissions and SQL setup.

# 1. Prerequisite Checks
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

if [ ! -f .env ]; then
  echo "❌ Error: .env file not found!"
  echo "Please run './setup.sh' first to configure your environment."
  exit 1
fi

for tool in docker grep cut tr; do
  if ! command -v $tool &> /dev/null; then
    echo "❌ Error: Required tool '$tool' is not installed."
    exit 1
  fi
done

# Verify docker compose specifically
if ! docker compose version &> /dev/null; then
  echo "❌ Error: 'docker compose' plugin is not installed."
  exit 1
fi

# Load configuration from .env
export $(grep -v '^#' .env | xargs)

PROJECT_NAME=${PROJECT_NAME:-pluralmatrix}

echo "🚀 Starting $PROJECT_NAME Stack Refresh via Docker Compose..."

# 0. Cleanup: Remove existing manual containers if they conflict
sudo docker rm -f ${PROJECT_NAME}-postgres ${PROJECT_NAME}-synapse ${PROJECT_NAME}-app-service 2>/dev/null || true

# 1. Pre-flight: Fix Synapse Permissions
echo "🛡️ Fixing Synapse permissions..."
S_UID=${SYNAPSE_UID:-991}
S_GID=${SYNAPSE_GID:-991}
sudo chown -R $S_UID:$S_GID synapse/config 2>/dev/null || true

# 2. Start Postgres and wait for healthiness
echo "🐘 Starting database..."
sudo docker compose up -d postgres

echo "🐘 Ensuring plural_db and plural_app user exist..."
PG_PASS=$(grep POSTGRES_PASSWORD .env | cut -d '=' -f2 | tr -d '\r')

# Wait for postgres to be ready by attempting a simple query
until sudo docker exec ${PROJECT_NAME}-postgres psql -U synapse -d template1 -c "SELECT 1" >/dev/null 2>&1; do
  echo -n "."
  sleep 1
done

# Perform SQL initialization using multi-line -c commands (more robust than heredocs in docker exec)
sudo docker exec ${PROJECT_NAME}-postgres psql -U synapse -d template1 -c "CREATE DATABASE plural_db" 2>/dev/null || true

sudo docker exec ${PROJECT_NAME}-postgres psql -U synapse -d template1 -c "
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'plural_app') THEN
        CREATE USER plural_app WITH PASSWORD '$PG_PASS';
    ELSE
        ALTER USER plural_app WITH PASSWORD '$PG_PASS';
    END IF;
END \$\$;
"

sudo docker exec ${PROJECT_NAME}-postgres psql -U synapse -d plural_db -c "
GRANT ALL PRIVILEGES ON DATABASE plural_db TO plural_app;
ALTER SCHEMA public OWNER TO plural_app;
GRANT ALL ON SCHEMA public TO plural_app;
"

echo " Ready!"

echo "🔍 Validating database configuration..."
until sudo docker exec ${PROJECT_NAME}-postgres psql -U synapse -d plural_db -c "SELECT 1" >/dev/null 2>&1; do
  echo -n "d"
  sleep 1
done

until sudo docker exec ${PROJECT_NAME}-postgres psql -U synapse -d template1 -tAc "SELECT 1 FROM pg_roles WHERE rolname='plural_app'" | grep -q 1; do
  echo -n "u"
  sleep 1
done

echo " Database and user verified!"

# 3. Bring up the rest of the stack
echo "📦 Building and starting services..."
sudo ACTIONS_RESULTS_URL="${ACTIONS_RESULTS_URL:-}" ACTIONS_RUNTIME_TOKEN="${ACTIONS_RUNTIME_TOKEN:-}" ACTIONS_CACHE_SERVICE_V2="${ACTIONS_CACHE_SERVICE_V2:-}" SCCACHE_GHA_ENABLED="${SCCACHE_GHA_ENABLED:-}" COVERAGE=$COVERAGE docker compose up -d --build

# 4. Final status
echo "📊 Current Status:"
sudo docker compose ps

echo ""
echo "✅ Done!"
echo "You can now log in to the Synapse homeserver using any Matrix client at: http://localhost:${SYNAPSE_PORT}"
echo "Create a room and invite the bot: @plural_bot:${SYNAPSE_DOMAIN}"
echo "Web UI: ${PUBLIC_WEB_URL}"
