# PluralMatrix: "Synchronous Gatekeeper" Implementation Plan

## 1. Architecture Overview

We are building a high-fidelity Plurality integration for Matrix using the **Synchronous Gatekeeper** pattern. This ensures "Zero Flash" proxying by intercepting messages at the server level before they are committed to the database.

### Components

1.  **Synapse (Homeserver):** The core Matrix server (running in Docker).
2.  **PostgreSQL (Database):** Shared database for Synapse and our App Service (separate schemas).
3.  **App Service (The Brain):**
    - **Runtime:** Node.js (TypeScript).
    - **Role:** Manages Systems, Members, and Proxy logic.
    - **Interfaces:**
      - Matrix AppService API (receiving events, managing ghosts).
      - Internal HTTP API (answering the Gatekeeper).
      - Web Dashboard (React/Vite) for user configuration.
4.  **Synapse Module (The Muscle):**
    - **Runtime:** Python (running inside Synapse container).
    - **Role:** Hooks into `check_event_for_spam`. Calls the App Service to decide whether to Block (and Proxy) or Allow (pass-through) a message.

## 2. Implementation Phases

### Phase 1: Infrastructure & Environment

- [ ] Create project directory structure.
- [ ] Create `docker-compose.yml` defining:
  - `synapse`: The homeserver (mounting our custom module).
  - `postgres`: The database.
  - `app-service`: Our Node.js application.
- [ ] Configure Synapse (`homeserver.yaml`) to:
  - Register our App Service (`app-service.yaml`).
  - Load our custom Python module.

### Phase 2: The "Muscle" (Python Module)

- [ ] Create `synapse_module/plural_gatekeeper.py`.
- [ ] Implement `check_event_for_spam` callback.
- [ ] Implement the synchronous HTTP call to the App Service.
- [ ] Add "Fail-Open" logic (if AS is down, allow message).
- [ ] Add "Loop Prevention" (whitelist AS user and Ghosts).

### Phase 3: The "Brain" (App Service Backend)

- [ ] Initialize TypeScript project (`app-service/`).
- [ ] Set up `matrix-bot-sdk` for App Service registration.
- [ ] Set up Database (Prisma ORM with PostgreSQL).
  - Models: `System`, `Member`, `ProxyRule`.
- [ ] Implement the `/check` API endpoint for the Module.
  - Logic: Regex match -> Queue Ghost Message -> Return "BLOCK".
- [ ] Implement Ghost management (auto-register users, set avatars).

### Phase 4: The "Face" (Web Dashboard)

- [ ] Initialize React + Vite project inside `app-service/client`.
- [ ] Implement "Login with Matrix" (OpenID Connect).
- [ ] Create UI for:
  - Creating a System.
  - Adding Members (Name, Avatar, Proxy Tags).
  - Importing from PluralKit (JSON).

### Phase 5: Integration & Polish

- [ ] End-to-end testing of the "Zero Flash" flow.
- [ ] Stress testing (spamming messages).
- [ ] Packaging for deployment (production `Dockerfile`).

## 3. Directory Structure

```
pluralmatrix/
├── docker-compose.yml
├── synapse/
│   ├── config/
│   │   ├── homeserver.yaml
│   │   └── app-service-registration.yaml
│   └── modules/
│       └── plural_gatekeeper.py  <-- The Python Module
└── app-service/
    ├── package.json
    ├── prisma/
    │   └── schema.prisma         <-- DB Schema
    ├── src/
    │   ├── index.ts              <-- Entry point
    │   ├── bot.ts                <-- Matrix logic
    │   └── api.ts                <-- Gatekeeper API
    └── client/                   <-- React Dashboard
```
