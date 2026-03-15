# Rust Crypto Helper 🦀🛡️

This is a specialized CLI sidecar for PluralMatrix that handles cryptographic identity bootstrapping for Matrix ghost users.

## What is this?

The `rust-crypto-helper` is a tiny Rust binary built directly against the [Matrix Rust SDK](https://github.com/matrix-org/matrix-rust-sdk). Its sole responsibility is to:

1. Open a ghost user's SQLite crypto store.
2. Generate a full cross-signing identity (Master Key, Self-Signing Key, and User-Signing Key).
3. Cryptographically sign the ghost's current device.
4. Output the resulting JSON payloads to `stdout` so the main Node.js application can upload them to the homeserver.

## Why do we need it? (The "Why not TypeScript?" question)

We cannot perform this specific task directly in the main TypeScript application for two primary reasons:

### 1. Missing Bindings in the Node.js Wrapper

The [matrix-sdk-crypto-nodejs](https://github.com/matrix-org/matrix-rust-sdk-crypto-nodejs) library used by the main App Service is a set of high-level bindings. While it provides a `bootstrapCrossSigning()` method, the current beta version (v0.4.0) has a critical limitation: **it does not return the key upload payloads.**

In the underlying Rust SDK, `bootstrap_cross_signing` returns the raw HTTP request bodies that must be sent to the homeserver to publish the keys. The Node.js wrapper executes the local generation but effectively "drops" the network payloads, making it impossible to actually complete the verification process from within Node.js.

### 2. Bypassing User Interactive Authentication (UIA)

Setting up cross-signing usually requires a user to enter their password (UIA). Since ghosts are automated accounts, they cannot answer password prompts.

By using this helper to extract the raw payloads, the main Node.js orchestrator can inject a "Dummy Auth" block and append the Appservice `user_id` query parameter. This tells Synapse: _"This request is coming from a trusted Application Service; bypass the password check."_

### 3. SQLite Lock Management

The Matrix Rust SDK uses SQLite for persistence and enforces strict file locking. By running this helper as a subprocess **before** the main Node.js `OlmMachine` is initialized for a specific user, we ensure that:

- The Rust helper can safely initialize, generate keys, and write to the DB.
- The helper exits and releases the lock.
- The Node.js app then takes over the DB with the keys already locally "baked in."

## Usage

The binary is executed by `CrossSigningBootstrapper.ts` with the following arguments:

```bash
./rust-crypto-helper <user_id> <device_id> <store_path>
```

It returns a JSON object containing `upload_keys` and `upload_signatures`.
