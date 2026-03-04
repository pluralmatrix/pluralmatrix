# Deploying PluralMatrix to Railway (PaaS)

PluralMatrix is primarily designed to be deployed via Docker Compose on a persistent VPS. However, it can be adapted to run on Platform-as-a-Service (PaaS) providers like [Railway](https://railway.app).

There are two main paths for deploying on Railway, depending on whether you already have a Matrix server.

---

## Path A: Using an Existing Homeserver (Recommended for PaaS)

If you are using an **existing non-Synapse homeserver** (like Dendrite or Conduit) or an existing Synapse server hosted elsewhere, your deployment is much simpler. You only need to deploy the **PostgreSQL Database** and the **App Service**.

*(Note: The "Zero-Flash" feature requires our custom Synapse module. If you use an external non-Synapse server, proxying will work normally, but original proxy trigger messages may briefly "flash" in the timeline before being deleted and replaced by the bot.)*

### 1. Generate Your Secrets & Registration Locally
1. Clone the repository to your local machine and run `./setup.sh`.
2. When prompted, enter the domain of your existing homeserver.
3. The script will generate a `.env` file and a `synapse/config/app-service-registration.yaml` file.
4. **Important:** Copy the `app-service-registration.yaml` file to your *actual* homeserver and configure it to load the file. Keep the `.env` file handy.

### 2. Create the Database
1. In your Railway Project, click **New** -> **Database** -> **Add PostgreSQL**.
2. Go to the **Connect** tab and copy the `DATABASE_URL`.

### 3. Deploy the App Service
1. In your Railway Project, click **New** -> **GitHub Repo** and select your fork of PluralMatrix.
2. Go to the **Settings** tab of the new service and set the **Dockerfile Path** to `app-service/Dockerfile`.
3. In the **Variables** tab, add the variables from your locally generated `.env` file.
   - `DATABASE_URL`: Use the connection string from your Railway Postgres.
   - `SYNAPSE_URL`: Set to the public URL of your existing homeserver (e.g., `https://matrix.yourdomain.com`).
   - `PUBLIC_WEB_URL`: Set to the public domain Railway assigns to your App Service.

### 4. Add a Persistent Volume (CRITICAL ⚠️)
The App Service uses End-to-End Encryption and stores its keys in `/app/data`. **If this data is lost, the bot will no longer be able to decrypt past messages.**
1. In the App Service settings, go to **Volumes**.
2. Click **Add Volume** and set the Mount Path to `/app/data`.

### 5. Expose and Link
1. In **Settings** -> **Networking**, click **Generate Domain**.
2. Open your `app-service-registration.yaml` on your homeserver, change the `url:` field to this new Railway domain, and restart your homeserver.

---

## Path B: Starting from Scratch (Full Stack on Railway)

If you want the full "Zero-Flash" experience and do not have a homeserver yet, you must deploy the custom Synapse container alongside the App Service. 

**⚠️ Warning:** Because Railway uses ephemeral containers, deploying stateful applications like Synapse requires careful volume management. 

### 1. Local Setup & Private Fork
Because your Synapse configuration will contain sensitive signing keys, you must use a **private** GitHub repository.
1. Create a private fork of PluralMatrix.
2. Clone it locally and run `./setup.sh`. 
3. Edit `synapse.Dockerfile` and add this line at the bottom to bake your config into the image:
   `COPY ./synapse/config /data`
4. Commit your generated `.env` values (privately!) and the `synapse/config` folder, and push to your private repo.

### 2. Railway Architecture
You will need to create three services in your Railway project:
1. **PostgreSQL Plugin**: Copy the `DATABASE_URL`.
2. **App Service**:
   - Source: Your private GitHub repo.
   - Dockerfile: `app-service/Dockerfile`
   - Volumes: Mount a volume to `/app/data` (for crypto keys).
   - Variables: Copy all `.env` variables. Update `DATABASE_URL`. Update `SYNAPSE_URL` to `http://synapse.railway.internal:8008` (using Railway's private networking).
3. **Synapse Service**:
   - Source: Your private GitHub repo.
   - Dockerfile: `synapse.Dockerfile`
   - Volumes: Mount a volume to `/data/media_store` to persist user image uploads.
   - Variables: `SYNAPSE_SERVER_NAME` and `POSTGRES_PASSWORD`.

### 3. Networking Configuration
1. Generate a public domain for your **Synapse Service** (e.g., `matrix.yourdomain.com`). This is the URL you will type into your Matrix client.
2. Generate a public domain for your **App Service** (e.g., `pluralmatrix.yourdomain.com`).
3. Ensure both services can communicate via Railway's internal private networking so the App Service can reach Synapse on port `8008`, and Synapse can reach the App Service on port `9001` (for the gatekeeper check).

*For complex multi-container stateful deployments like this, we still strongly recommend using a standard VPS with our provided `docker-compose.yml` for the smoothest experience.*
