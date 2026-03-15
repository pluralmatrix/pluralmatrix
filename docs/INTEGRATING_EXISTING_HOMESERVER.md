# Integrating PluralMatrix with an Existing Matrix Homeserver

By default, PluralMatrix is configured to spin up its own local Synapse server for easy testing. However, it is designed from the ground up to integrate cleanly into an existing Matrix deployment.

This guide assumes you are running your existing Matrix homeserver using **Docker Compose** alongside a PostgreSQL database.

## Prerequisites
- A working Matrix homeserver deployed via Docker Compose.
- Access to your server's command line and Docker Compose files.
- Basic knowledge of editing YAML files (`docker-compose.yml` and `homeserver.yaml`).

## Step 1: Generate Configuration Files
PluralMatrix needs its own cryptographic secrets to securely communicate with your server and to proxy End-to-End Encrypted (E2EE) messages. We will use the provided setup script to generate these securely.

1. Clone the PluralMatrix repository somewhere on your server (it doesn't have to be in the same folder as your existing homeserver, but it helps keep things organized).
2. Run the setup wizard:
   ```bash
   ./setup.sh
   ```
3. The wizard will prompt you for several details. It is critical that you provide the correct information for your *existing* server:
   - **Project Name:** Choose a name (e.g., `pluralmatrix`). This just helps label the generated containers.
   - **Matrix Server Name:** The internal, technical hostname of your server (e.g., `matrix.example.com`). This *must* match the configured server name in your existing homeserver.
   - **Matrix User Domain:** The domain suffix for your User IDs (e.g., `example.com` if your IDs look like `@user:example.com`).
   - **Web Dashboard Port:** The port you want the PluralMatrix dashboard to be available on (default `9000`).
   - **Public Dashboard URL:** The URL users will visit to manage their systems.
   - **Homeserver Port:** The internal port your existing homeserver container uses (e.g. `8008` for Synapse).
   - **Postgres Database Password:** The password for the *new* database user PluralMatrix will create. You can leave this blank to generate a random secure one.

This script generates an `.env` file and several files inside the `synapse/config/` folder.

## Step 2: Database Preparation
The PluralMatrix App Service requires its own PostgreSQL database (by default named `plural_db`) and user (by default named `plural_app`).

If your existing homeserver uses a standalone PostgreSQL container, you need to execute a few SQL commands inside it to prepare PluralMatrix's space. **Do not point PluralMatrix to your existing homeserver's database directly.**

Connect to your existing PostgreSQL container (replace `your-postgres-container` with its actual name):
```bash
docker exec -it your-postgres-container psql -U postgres
```
Run the following SQL, replacing `YOUR_GENERATED_DB_PASSWORD` with the password you provided or was generated in step 1:
```sql
CREATE USER plural_app WITH ENCRYPTED PASSWORD 'YOUR_GENERATED_DB_PASSWORD';
CREATE DATABASE plural_db OWNER plural_app;
GRANT ALL PRIVILEGES ON DATABASE plural_db TO plural_app;
\q
```

## Step 3: Merging Homeserver Configuration
You need to tell your existing Matrix homeserver about the new PluralMatrix Application Service.

*Note: The examples below use Synapse's `homeserver.yaml` format. If you use a different homeserver (like Dendrite or Conduit), refer to its documentation on how to register an Application Service.*

Open your existing `homeserver.yaml` (or equivalent config) and carefully add or merge the following blocks, copying the exact values generated in your local `./synapse/config/homeserver.yaml` from Step 1:

**1. Application Services:**
Point this to where you will mount the registration file in your homeserver container.
```yaml
app_service_config_files:
  - /data/app-service-registration.yaml # Adjust path based on your Docker volumes
```

**2. Experimental Features (Synapse Example):**
If using Synapse, these features are strictly required for the App Service to manage device keys and intercept End-to-End Encrypted messages. Other homeservers may handle these MSCs differently.
```yaml
experimental_features:
  msc3202_device_masquerading: true
  msc3202_transaction_extensions: true
  msc2409_to_device_messages_enabled: true
```

## Step 4: Merging Docker Compose
Now, add the PluralMatrix components to your existing `docker-compose.yml`.

*A note on networking: Application Services act as an HTTP server that your homeserver reaches out to when new messages are sent. PluralMatrix will listen for these events internally on port `8008`, but because both services will be on the same Docker network, you do not need to expose this internal AS port to your host machine's public ports. The homeserver will push events directly to the container.*

1. Copy the `app-service` block from PluralMatrix's `docker-compose.yml` into your existing file.
2. Ensure you copy the `build` context or pre-build the App Service image.
3. **Crucial (Networking):** The `app-service` container *must* be connected to the same Docker `network` as your existing homeserver and Postgres containers so they can communicate. 
   - Look at the `networks` defined in your existing homeserver (e.g., `synapse`) or `postgres` service blocks. Add that same network name to the `app-service` block under its own `networks:` key.
4. Update the `volumes` in your homeserver container block to mount the registration YAML (Synapse example below):
   ```yaml
   services:
     synapse:
       # ... your existing homeserver config ...
       volumes:
         # ... your existing volumes ...
         # Mount the generated registration file:
         - /path/to/pluralmatrix/synapse/config/app-service-registration.yaml:/data/app-service-registration.yaml:ro
   ```
5. Update your `.env` file (or the `app-service` environment variables) so that `DATABASE_URL` points to your existing Postgres container.
   - **Docker Hostnames:** In Docker Compose, the name of a service block (e.g., `db`, `postgres`, `synapse`) automatically becomes its internal hostname on the shared network.
   - If your existing postgres service is named `db`, your URL will look like: `postgresql://plural_app:password@db:5432/plural_db`
6. Update the `SYNAPSE_URL` in the PluralMatrix `.env` to point to your homeserver container. 
   - Note: The variable is named `SYNAPSE_URL` for historical reasons, but applies to any homeserver.
   - If your existing homeserver service is named `synapse`, your URL will look like: `http://synapse:8008` (assuming it listens on 8008 internally).

Once everything is merged, restart your stack:
```bash
docker compose up -d
```

## Step 5: Viewing Logs and Troubleshooting
If messages aren't proxying or ghosts aren't joining, checking the logs is your first line of defense.

To view the App Service logs:
```bash
docker logs -f your-app-service-container
```

To view homeserver logs:
```bash
docker logs -f your-homeserver-container
```

## Advanced: The Zero-Flash Patch (Synapse Only - Optional)
The steps above provide full PluralMatrix functionality across standard Matrix homeservers. However, there is one detail: when you trigger a proxy (e.g. `lily; hello`), your original message will briefly "flash" in the timeline for a split second before the bot deletes it. 

To achieve true "Zero-Flash" proxying (where the original message is blackholed before it ever reaches the database), you must install a custom Synapse module (`plural_gatekeeper`) and apply a custom patch directly to the Synapse Python source code. **This feature is strictly for Synapse and cannot be used with other homeservers.**

**⚠️ WARNING:** 
- Modifying core Synapse code is advanced. 
- You should **always back up your database** before attempting this.
- The provided `synapse-zero-flash.patch` was specifically designed and tested against **Synapse v1.147.1**. It may fail to apply or cause instability on newer or older versions.

### 1. Configure the Gatekeeper Module
Update your existing `homeserver.yaml` to include the custom Python module. Ensure the `service_url` points to the correct Docker container name of the App Service (port 9001 is used internally for this high-speed check).

```yaml
modules:
  - module: plural_gatekeeper.PluralGatekeeper
    config:
      service_url: "http://your-app-service-container:9001/check"
      as_token: "YOUR_GENERATED_AS_TOKEN"
      gatekeeper_secret: "YOUR_GENERATED_GATEKEEPER_SECRET"
```

In your `docker-compose.yml`, mount the module into your Synapse container:
```yaml
   services:
     synapse:
       # ... your existing synapse config ...
       volumes:
         # ... your existing volumes ...
         - /path/to/pluralmatrix/synapse/modules:/modules:ro
       environment:
         # Tell Synapse where to look for custom modules:
         - PYTHONPATH=/modules
```

### 2. Applying the Code Patch in Docker
The `plural_gatekeeper` module relies on a specific hook (`check_visibility_can_see_event`) inside `ThirdPartyEventRules`. Standard Synapse does not expose this hook. The patch modifies `synapse/visibility.py` and `synapse/handlers/sync.py` to allow our module to tell Synapse to drop specific events from `/sync` payloads entirely.

The easiest way to apply the patch is to build a custom Synapse Docker image rather than using the official one directly.

You can view the provided `synapse.Dockerfile` in the root of the repository to see exactly how this is done. In short, it:
1. Pulls the base Synapse image (e.g., `matrixdotorg/synapse:v1.147.1`).
2. Installs the `patch` utility.
3. Copies `synapse-zero-flash.patch` into the container.
4. Runs `patch -p1 < synapse-zero-flash.patch` inside the `/usr/local/lib/python3.12/site-packages` directory.

To use the Zero-Flash feature, you should adapt your existing `docker-compose.yml` to build Synapse from a similar Dockerfile rather than pulling the pre-built image from Docker Hub.

## Integrating with a Non-Docker Homeserver
If your existing Matrix homeserver installation runs directly on the host machine (e.g., installed via `apt` or `pip`) without Docker, you can still integrate PluralMatrix. For this setup, we assume you will still run the PluralMatrix App Service via Docker Compose.

1. **Networking:** In your `docker-compose.yml` for PluralMatrix, map the App Service port (e.g., `8008:8008` and `9000:9000`) to the host network so that your external homeserver instance can push events to it. You can achieve this by explicitly mapping the ports in the `app-service` block. Ensure your homeserver points its AS configuration (`url` in `app-service-registration.yaml`) to the exposed port.
2. **PostgreSQL:** If your host machine runs PostgreSQL directly, create the `plural_db` database and `plural_app` user there (using Step 2 as a guide). Ensure your PluralMatrix App Service's `.env` uses `DATABASE_URL` pointing to the host machine's IP address (or `host.docker.internal` on supported setups) and port `5432`.
3. **Configuration:** 
   - Update your host machine's configuration (e.g. `homeserver.yaml`) with the App Service and experimental features as outlined in Step 3. 
   - The PluralMatrix `app-service-registration.yaml` will need to be accessible by your homeserver process, so point `app_service_config_files` to its location on your host filesystem.
4. **Zero-Flash Patch (Synapse Only - Optional):** If you are running Synapse and also want to use the Zero-Flash feature outside Docker:
   - Map the internal Gatekeeper port (`9001:9001`) in your App Service `docker-compose.yml`.
   - Copy `synapse/modules/plural_gatekeeper.py` to the directory on your host machine where Synapse loads custom modules, and ensure it's in Synapse's `PYTHONPATH`.
   - Add the `modules` block to your host machine's `homeserver.yaml` (pointing `service_url` to `http://localhost:9001/check` or whichever IP/port the App Service exposes).
   - Locate your Synapse Python package installation (e.g., `/usr/lib/python3/dist-packages` or inside a virtual environment) and manually run the `patch` command from the root of the site-packages directory:
     ```bash
     patch -p1 < /path/to/synapse-zero-flash.patch
     ```