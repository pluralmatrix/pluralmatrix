# PluralMatrix Dashboard: Implementation Plan 🌌

This plan covers the development of the web-based configuration dashboard for PluralMatrix, allowing users to manage their systems and members natively on Matrix.

## 1. Architecture

- **Backend:** Node.js (Express) integrated into the existing App Service.
- **Database:** PostgreSQL (via Prisma).
- **Frontend:** React (Vite) + Tailwind CSS.
- **Authentication:** Matrix-based login (verifying against Synapse) + JWT session management.

## 2. Phase 1: Authentication Engine 🔐

**Goal:** Allow users to log in with their Matrix ID and password to securely manage their system.

- [ ] Install JWT dependencies (`jsonwebtoken`).
- [ ] Implement `POST /api/auth/login` endpoint:
  - Authenticates with Synapse using standard Matrix Login API.
  - On success, generates a signed JWT containing the user's MXID.
- [ ] Implement `authenticateToken` middleware to protect future API routes.
- [ ] Create automated tests for the login flow.

## 3. Phase 2: Member CRUD API 📝

**Goal:** Backend logic for managing system members.

- [ ] Implement `GET /api/members`: Fetch all system members for the logged-in user.
- [ ] Implement `POST /api/members`: Create a new system member.
- [ ] Implement `PATCH /api/members/:id`: Update system member attributes.
- [ ] Implement `DELETE /api/members/:id`: Remove a system member.
- [ ] Implement avatar upload handling (Proxying to Matrix Media Repo).

## 4. Phase 3: PluralKit Importer 🚀

**Goal:** Seamless migration from Discord.

- [ ] Implement `POST /api/import/pluralkit`:
  - Parse PluralKit JSON export.
  - Map fields to PluralMatrix schema.
  - **Avatar Migration:** Download external images and re-upload to local Matrix server.
  - Bulk-insert/upsert into database.

## 5. Phase 4: Frontend UI 🎨

**Goal:** A polished, modern dashboard.

- [ ] Setup Tailwind CSS.
- [ ] Build Login Page.
- [ ] Build System Dashboard (Stats & System Name).
- [ ] Build Member Grid (Cards with avatars).
- [ ] Build System Member Editor (Forms for editing tags, names, etc.).
- [ ] Build Import UI (Drag & Drop JSON).

## 6. Verification Steps

- **Backend:** Automated Jest tests for API endpoints.
- **Manual:** Verification via `curl` and eventually the browser UI.
