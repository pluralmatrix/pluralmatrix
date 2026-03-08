#!/bin/bash

# PluralMatrix Automated Setup Script 🚀
set -e

# Parse arguments
CI_MODE=false
if [ "$1" == "--ci" ]; then
    CI_MODE=true
    echo "🤖 Running in non-interactive CI mode..."
fi

# Helper to generate random hex strings
gen_token() {
    openssl rand -hex 32
}

# 0. Initialise project name (Replace underscores with dashes for Synapse hostname compatibility)
DIR_NAME=$(basename "$(pwd)" | tr '_' '-')
# Fallback to 'pluralmatrix' if we are in a root-like folder
DEFAULT_PROJECT_NAME=${DIR_NAME:-pluralmatrix}

if [ "$CI_MODE" = false ]; then
    echo "🌌 Welcome to the PluralMatrix Setup Wizard!"
    echo "Note: Side-by-side installations are supported by using unique project names."
    echo ""

    read -p "Enter your Project Name [$DEFAULT_PROJECT_NAME]: " PROJECT_NAME
fi
PROJECT_NAME=${PROJECT_NAME:-$DEFAULT_PROJECT_NAME}
# Clean project name for Docker/hostname compatibility (lowercase, no underscores)
PROJECT_NAME=$(echo "$PROJECT_NAME" | tr '_' '-' | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]//g')

echo "🏷️ Project name set to: $PROJECT_NAME"
echo "This script will generate secure tokens and configure your environment."
echo ""

# 1. Gather Basic Info
if [ "$CI_MODE" = false ]; then
    echo "🌐 Let's configure your Matrix identity."
    echo "   - Server Name: The internal hostname (e.g. matrix.example.com)"
    echo "   - User Domain: The suffix for your User IDs (e.g. example.com)"
    echo ""

    read -p "Enter your Matrix Server Name [localhost]: " SERVER_NAME
fi
SERVER_NAME=${SERVER_NAME:-localhost}

if [ "$CI_MODE" = false ]; then
    read -p "Enter your Matrix User Domain [$SERVER_NAME]: " DOMAIN
fi
DOMAIN=${DOMAIN:-$SERVER_NAME}

if [ "$CI_MODE" = false ]; then
    read -p "Enter the Public Port for the Web Dashboard [9000]: " APP_PORT
fi
APP_PORT=${APP_PORT:-9000}

if [ "$CI_MODE" = false ]; then
    read -p "Enter the Public URL for the Web Dashboard (used for bot links) [http://localhost:${APP_PORT}]: " PUBLIC_WEB_URL
fi
PUBLIC_WEB_URL=${PUBLIC_WEB_URL:-http://localhost:${APP_PORT}}

if [ "$CI_MODE" = false ]; then
    read -p "Enter the Public Port for Synapse [8008]: " SYNAPSE_PORT
fi
SYNAPSE_PORT=${SYNAPSE_PORT:-8008}

if [ "$CI_MODE" = false ]; then
    read -p "Enter a password for the Postgres Database [random]: " PG_PASS
fi
if [ -z "$PG_PASS" ]; then
    PG_PASS=$(gen_token)
fi

echo "🛡️ Generating secure tokens and passwords..."
AS_TOKEN=$(gen_token)
HS_TOKEN=$(gen_token)
GATEKEEPER_SECRET=$(gen_token)
JWT_SECRET=$(gen_token)
REG_SECRET=$(gen_token)
MACAROON_SECRET=$(gen_token)
FORM_SECRET=$(gen_token)

# 2. Configure .env
echo "📝 Configuring .env..."
cp .env.example .env
sed -i "s/POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$PG_PASS/" .env
sed -i "s|DATABASE_URL=.*|DATABASE_URL=postgresql://plural_app:$PG_PASS@${PROJECT_NAME}-postgres:5432/plural_db|" .env
sed -i "s/PROJECT_NAME=.*/PROJECT_NAME=$PROJECT_NAME/" .env
sed -i "s/SYNAPSE_SERVER_NAME=.*/SYNAPSE_SERVER_NAME=$SERVER_NAME/" .env
sed -i "s/SYNAPSE_DOMAIN=.*/SYNAPSE_DOMAIN=$DOMAIN/" .env
sed -i "s|SYNAPSE_URL=.*|SYNAPSE_URL=http://${PROJECT_NAME}-synapse:8008|" .env
sed -i "s/AS_TOKEN=.*/AS_TOKEN=$AS_TOKEN/" .env
sed -i "s/GATEKEEPER_SECRET=.*/GATEKEEPER_SECRET=$GATEKEEPER_SECRET/" .env
sed -i "s/JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env
sed -i "s/CRYPTO_DEVICE_ID=.*/CRYPTO_DEVICE_ID=PLURAL_CTX_V9/" .env
sed -i "s/APP_PORT=.*/APP_PORT=$APP_PORT/" .env
sed -i "s|PUBLIC_WEB_URL=.*|PUBLIC_WEB_URL=$PUBLIC_WEB_URL|" .env
sed -i "s/SYNAPSE_PORT=.*/SYNAPSE_PORT=$SYNAPSE_PORT/" .env

# 3. Configure Synapse (homeserver.yaml)
echo "🌌 Configuring homeserver.yaml..."
mkdir -p synapse/config
cp synapse/config/homeserver.yaml.example synapse/config/homeserver.yaml
sed -i "s/server_name: \".*\"/server_name: \"$SERVER_NAME\"/" synapse/config/homeserver.yaml
sed -i "s/registration_shared_secret: \"REPLACE_ME\"/registration_shared_secret: \"$REG_SECRET\"/" synapse/config/homeserver.yaml
sed -i "s/macaroon_secret_key: \"REPLACE_ME\"/macaroon_secret_key: \"$MACAROON_SECRET\"/" synapse/config/homeserver.yaml
sed -i "s/form_secret: \"REPLACE_ME\"/form_secret: \"$FORM_SECRET\"/" synapse/config/homeserver.yaml
sed -i "s/gatekeeper_secret: \"REPLACE_ME\"/gatekeeper_secret: \"$GATEKEEPER_SECRET\"/" synapse/config/homeserver.yaml
sed -i "s/as_token: \"secret_token\"/as_token: \"$AS_TOKEN\"/" synapse/config/homeserver.yaml
sed -i "s/app-service:9000/${PROJECT_NAME}-app-service:$APP_PORT/" synapse/config/homeserver.yaml

# 4. Configure App Service Registration
echo "🔑 Configuring app-service-registration.yaml..."
cp synapse/config/app-service-registration.yaml.example synapse/config/app-service-registration.yaml
sed -i "s/id: .*/id: ${PROJECT_NAME}/" synapse/config/app-service-registration.yaml
sed -i "s/as_token: .*/as_token: $AS_TOKEN/" synapse/config/app-service-registration.yaml
sed -i "s/hs_token: .*/hs_token: $HS_TOKEN/" synapse/config/app-service-registration.yaml
sed -i "s|url: .*|url: http://${PROJECT_NAME}-app-service:8008|" synapse/config/app-service-registration.yaml

# 5. Generate Signing Key
echo "✒️ Generating Synapse signing key..."
sudo chown -R 991:991 ./synapse/config
sudo docker compose build synapse
sudo docker compose run --rm \
    -e SYNAPSE_SERVER_NAME=$SERVER_NAME \
    -e SYNAPSE_REPORT_STATS=no \
    synapse generate
sudo docker compose down

echo ""
echo "🏷️ Project name established as: $PROJECT_NAME"
echo "✅ Setup Complete!"
echo "--------------------------------------------------------"
echo "🚀 NEXT STEPS:"
echo "1. Start the stack: ./restart-stack.sh"
echo "2. Invite the bot: /invite @plural_bot:$DOMAIN to your rooms."
echo ""
echo "📊 VIEW LOGS:"
echo "   sudo docker logs -f ${PROJECT_NAME}-app-service"
echo "   sudo docker logs -f ${PROJECT_NAME}-synapse"
echo ""
echo "⚙️ INTEGRATION WITH AN EXISTING SYNAPSE SERVER:"
echo "If you already run Synapse via Docker Compose, you can integrate PluralMatrix:"
echo ""
echo "  A. MERGE DOCKER COMPOSE: Copy the 'app-service' service block from the provided"
echo "     'docker-compose.yml' and paste it into your existing 'docker-compose.yml'."
echo "     Ensure the 'app-service' is on the same Docker network as your Synapse container."
echo ""
echo "  B. COPY CONFIGURATION: Move the generated '.env' file and the"
echo "     'synapse/config/app-service-registration.yaml' file to your deployment directory."
echo ""
echo "  C. INSTALL MODULE: Copy 'synapse/modules/plural_gatekeeper.py' into your"
echo "     existing Synapse 'modules' folder."
echo ""
echo "  D. UPDATE HOMESERVER.YAML: Carefully merge the generated 'synapse/config/homeserver.yaml'"
echo "     into your existing Synapse configuration. In particular, ensure you include:"
echo "     - The 'app_service_config_files' entry."
echo "     - The 'modules' block for plural_gatekeeper."
echo "     - The 'experimental_features' block (Crucial for MSC3202 Device Masquerading)."
echo ""
echo "  E. ZERO-FLASH PATCH (OPTIONAL): For the premium 'Blackhole' and 'Zero-Flash' "
echo "     experience, you can apply 'synapse-zero-flash.patch' to your Synapse core."
echo "     - See 'synapse.Dockerfile' for an example of how to automate this in Docker."
echo "     - ⚠️ WARNING: This patch is only confirmed to work with Synapse v1.147.1."
echo "       It may require manual adaptation for other Synapse versions."
echo "--------------------------------------------------------"
