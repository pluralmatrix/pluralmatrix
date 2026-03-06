# PluralMatrix Architecture & Codebase Reference 🌌

This document outlines the architecture, design decisions, and codebase structure of PluralMatrix. It serves as a guide for future maintainers (human or bot) who need to understand how the various components interact.

## 1. High-Level Architecture

PluralMatrix is not a typical Matrix bot; it's a deeply integrated **Application Service** (AS) that intercepts, evaluates, and replaces messages with extremely high fidelity. 

The system comprises five main components:
1. **The App Service (The "Brain"):** A Node.js/TypeScript backend that handles Matrix events, manages state via PostgreSQL, processes PluralKit commands, and orchestrates the ghost users.
2. **The Synapse Module (The "Muscle"):** A custom Python module running inside the Synapse homeserver that hooks into the event visibility pipeline.
3. **The Rust Crypto Helper:** A standalone Rust binary used for cross-signing initialization for ghost users.
4. **The Web Dashboard:** A React/Vite Single Page Application (SPA) for users to configure their systems.
5. **The Database:** A PostgreSQL instance managed via Prisma ORM.

## 2. Core Problem Solving: "Zero-Flash" Proxying

Traditional Matrix bridging or proxy bots suffer from the "flash" problem: the original trigger message (e.g., `lily; hello`) briefly appears in the chat timeline before the bot can redact it and send the proxied message.

PluralMatrix solves this via a custom **Synchronous Gatekeeper** pattern.

### How it works:
1. **The Python Hook:** `synapse/modules/plural_gatekeeper.py` hooks into Synapse's event loop using `check_event_allowed`, `on_new_event`, and specifically the custom `check_visibility_can_see_event` hook.
2. **The Sync Check:** When a message is sent, the Python module holds the event and makes a synchronous HTTP request to the App Service's internal port `9001` (specifically the `/check` endpoint).
3. **The App Service Check:** `app-service/src/controllers/gatekeeperController.ts` rapidly checks if the message matches any proxy tags for the sender. 
    - If it's a match, it returns `BLOCK` immediately to Synapse.
    - In the background, it spins up an async task to generate the ghost's message.
4. **The Blackhole:** Synapse receives `BLOCK`. Using the `check_visibility_can_see_event` hook, it hides the original message from everyone *except* the original sender and the bot. To onlookers, the original message never existed.

## 3. Native E2EE Implementation & Cryptography

Handling End-to-End Encryption (E2EE) in an Application Service with thousands of ghost users is highly complex. PluralMatrix implements a custom multi-tenant E2EE solution.

### `TransactionRouter.ts` (The Interceptor)
Standard Matrix bots rely on `/sync`. Application Services receive push events via `/transactions/`. To enable E2EE, the App Service intercepts these HTTP `PUT /transactions/` requests.
`app-service/src/crypto/TransactionRouter.ts` catches `to_device` events, `ephemeral` events, and encrypted timeline events, routing them to the correct `OlmMachine` (from the `@matrix-org/matrix-sdk-crypto-nodejs` library) for decryption.

### The `rust-crypto-helper` Sidecar
Ghost users cannot interactively authenticate (UIA) to upload their cross-signing keys (Master, Self-Signing, User-Signing). The Node.js bindings for the Matrix Rust SDK do not currently expose the raw payload required to bypass this.
To solve this:
1. Before a new ghost user is initialized in Node.js, `app-service/src/crypto/CrossSigningBootstrapper.ts` executes `rust-crypto-helper/src/main.rs`.
2. The Rust binary initializes an SQLite crypto store, generates the keys, and outputs the raw JSON `upload_keys` and `upload_signatures` payloads.
3. The Node.js app takes these payloads, injects a `m.login.dummy` auth block, appends the Appservice `user_id` query parameter, and forces Synapse to accept the keys.

## 4. Directory Structure Breakdown

### `/synapse/modules/`
Contains the Python Synapse module (`plural_gatekeeper.py`). Needs to be copied/mounted into the Synapse container and registered in `homeserver.yaml`.

### `/rust-crypto-helper/`
A small Cargo project that compiles to a binary used by the App Service. It's essentially a CLI wrapper around `matrix_sdk_crypto::OlmMachine::bootstrap_cross_signing`.

### `/app-service/`
The core backend application.
*   **`prisma/schema.prisma`**: The database schema defining `System`, `Member`, and `AccountLink`.
*   **`client/`**: The React/Vite dashboard frontend. Uses standard routing, Context for auth, and Tailwind for styling.
*   **`src/`**:
    *   **`index.ts`**: Express server setup. Exposes port 9000 for the Web/API and 9001 for the internal Synapse gatekeeper check.
    *   **`bot.ts`**: Initializes `matrix-appservice-bridge`, handles AS registration, bot lifecycle, and generic unencrypted matrix event callbacks.
    *   **`controllers/`**: Express route controllers.
        *   `gatekeeperController.ts`: Handles the high-speed check from Synapse, handles E2EE decryption for the check, and triggers the async background proxying.
    *   **`crypto/`**:
        *   `OlmMachineManager.ts`: Manages a pool of active `OlmMachine` instances (one for the bot, one for each active ghost).
        *   `TransactionRouter.ts`: Custom routing of E2EE events pushed by Synapse.
        *   `CrossSigningBootstrapper.ts`: Invokes the Rust sidecar.
    *   **`services/`**: Business logic, including `commandHandler.ts` (PluralKit style commands like `pk;m`), cache management, and the `messageQueue.ts`.

## 5. Notable Designs & Future Maintainer Notes

*   **App Service Registration:** `bot.ts` specifically uses `botSdkIntent.underlyingClient.doRequest` to manually register the bot as an AS user to bypass standard limitations.
*   **Decryption Retries:** Decryption keys (Megolm sessions) often arrive *after* the encrypted message in federated or highly active rooms. `gatekeeperController.ts` implements a brief retry loop (`await new Promise(resolve => setTimeout(resolve, 200));`) to wait for keys if the first decryption attempt fails.
*   **Edit Handling:** Edits (`m.relates_to` -> `m.replace`) are handled natively. PluralMatrix redacts the *original* root message when an edit is proxied, as Matrix servers automatically cascade redactions to all associated `m.replace` events.
*   **SQLite Locking:** The Matrix Rust Crypto SDK uses SQLite, which is strictly locked. The Rust Helper must exit completely before the Node.js `OlmMachine` attempts to open the same SQLite file for a given ghost user, otherwise it will crash.
*   **Autoproxy:** The system supports a "latch" autoproxy mode, which automatically updates the database when a user uses a specific proxy tag, remembering that member for future untagged messages. This logic is handled in both `bot.ts` and `gatekeeperController.ts`.

## 6. Testing & CI Infrastructure

PluralMatrix employs a comprehensive testing strategy that covers backend unit tests, end-to-end (E2E) frontend UI tests, and Synapse module unit tests, all verified automatically via GitHub Actions.

### Test Suites

1. **Backend Tests (Jest):**
   - Located in `app-service/src/**/*.test.ts`
   - Run via `npx jest --forceExit` (or the `./test.sh` wrapper).
   - These tests use `ts-jest` and `supertest` to validate the Express API, the business logic, and the various matrix-appservice-bridge configurations. E2E crypto functionality and command handlers are extensively mocked or tested here.

2. **Frontend UI Tests (Playwright):**
   - Located in `app-service/src/test/ui/`
   - Run via `npx playwright test` (or the `./test.sh` wrapper).
   - Configured in `playwright.config.ts`. Tests are deliberately run sequentially (`fullyParallel: false`) and restricted to 1 worker to prevent test users from bleeding state into each other or overloading the local Synapse database during quick account creation.

3. **Synapse Module Tests:**
   - Located in `synapse/modules/`
   - Run via `synapse/modules/test.sh` inside the Synapse container context.
   - Tests the custom `check_visibility_can_see_event` hooks and interaction with the synchronous gatekeeper API.

### Orchestration & CI

*   **`app-service/test.sh`**: The primary entry point for a full system check. It runs both the Jest suite and the Playwright suite sequentially and reports a unified exit code.
*   **GitHub Actions CI (`.github/workflows/ci.yml`)**:
    - Triggered on push or PR to the `main` branch.
    - Sets up a Node.js 22 environment.
    - Runs `./setup.sh --ci` to generate placeholder configuration files and keys without hanging on user input.
    - Uses `./restart-stack.sh` to boot the full Docker-based PluralMatrix stack (Synapse + Postgres + App Service) so E2E integration works against a real local server.
    - Runs the Python module tests, installs Playwright dependencies, and then runs the full `app-service/test.sh` suite.

## 7. Deployment & Initialization Flow

Deploying PluralMatrix is heavily automated to ensure correct generation of cryptographic secrets and database state across the multi-container stack. Future maintainers debugging deployment issues should be aware of the following flow:

### `setup.sh` (The Generator)
The entry point for any new installation. This script:
- Prompts the user for basic network settings (Domains, Ports).
- Automatically generates secure 32-byte hex strings for all required tokens (`AS_TOKEN`, `HS_TOKEN`, `GATEKEEPER_SECRET`, `JWT_SECRET`, etc.).
- Compiles the `.env` file using these secrets.
- Generates `synapse/config/homeserver.yaml` and `synapse/config/app-service-registration.yaml` from their respective `.example` templates.
- Briefly spins up a temporary Docker container purely to run `synapse generate`, creating the cryptographic signing keys required by the Matrix server.

### `restart-stack.sh` (The Orchestrator)
A vital wrapper around standard `docker-compose up`. Because the database is shared between Synapse and the App Service (but uses separate databases/users), standard initialization scripts aren't enough. `restart-stack.sh` guarantees order of operations:
1. Fixes potentially broken Linux user permissions on the mounted `synapse/config` volume.
2. Boots **only** the `postgres` container.
3. Loops until Postgres is healthy, then executes raw SQL (`CREATE DATABASE plural_db`, `CREATE USER plural_app`, `GRANT ALL`) to provision the App Service's database tenant alongside Synapse's default database.
4. Finally, executes `docker-compose up -d --build` to bring up Synapse and the App Service, confident that the DB targets and roles are primed.

## 8. Message Delivery & Resilience

Because Matrix is a federated and eventually-consistent system, sending encrypted messages on behalf of ghost users can occasionally fail (due to missing keys, transient network errors, or rate limits). PluralMatrix utilizes a robust queueing system to handle this gracefully.

### `MessageQueue.ts`
When the Gatekeeper intercepts a message, it immediately hides the original but hands the actual proxy payload off to the `MessageQueue`. 
* **Retries:** If a ghost fails to send a message (e.g., waiting on Megolm decryption keys or hitting a brief federation timeout), the queue implements exponential backoff, retrying up to 3 times.
* **Fallback 1 (The Bailout):** If the ghost completely fails to send the message (e.g., they lack permission to speak in the room, or their crypto state is hopelessly broken), the queue falls back to having the main `@plural_bot` user send a "Delivery Failed" warning notice containing the original plaintext, ensuring data is never silently lost.
* **Fallback 2 (Dead Letter Vault):** If even the bot cannot speak in the room, the message is stored in memory in a Dead Letter Vault for up to 24 hours.

## 9. State & Data Portability

A core philosophy of PluralMatrix is that users own their system data.

### PluralKit Compatibility
The system provides first-class support for migrating to and from Discord-based setups via PluralKit.
* **Import:** `importController.ts` handles parsing standard PluralKit JSON exports. It not only maps the data to the local Prisma schema but also actively downloads the external Discord avatar URLs and re-uploads them to the local Matrix Media Repository (MXC URIs) so that the Matrix system doesn't rely on Discord's CDNs.
* **Export:** Users can export their full system state as a ZIP file containing the JSON metadata and all local avatar image assets, ensuring true offline data ownership.
* **Roundtrip Fidelity:** The database specifically stores `pkId` alongside the primary `slug` to ensure that importing and later exporting data maintains the original random 5-character IDs expected by other PluralKit-compatible tools.