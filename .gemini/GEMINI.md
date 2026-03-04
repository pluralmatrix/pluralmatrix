# PluralMatrix: Developer Notes 🌌

## Git Mandate
* **NEVER** commit and push to GitHub without stopping and asking for explicit permission first.
* **Security Guard:** A local `pre-push` hook has been installed in `.git/hooks/pre-push`. It uses the `GEMINI_CLI=1` environment variable to detect my process and hard-block any `git push` attempts I make. This ensures that only the user can push code to the remote repository from a standard terminal.
* **Reinstalling Guard:** If working in a new clone, run `./.gemini/install-hooks.sh` to reinstall this protection.

## Pre-Commit Checklist 🛡️
* **ALWAYS** run `./restart-stack.sh` before committing. This ensures the frontend build (React/TSC) and backend types are valid.
* **ALWAYS** run all tests and verify 100% pass rate: `cd app-service && ./test.sh`. This now runs both Backend (Jest) and UI (Playwright) tests.
* **ALWAYS** run Synapse module tests: `cd synapse/modules && ./test.sh`.
* **SCHEMA CHANGES:** Any changes to the database schema MUST include updates to the Prisma migrations. Verify that the migrations are correctly applied.
* **NEVER** amend a commit without explicit permission.

## Stack Management

Since `docker-compose` can be unreliable in this environment (due to `ContainerConfig` errors), use the helper script to rebuild and restart the services.

## Modified Synapse (Blackhole Feature)
* **Modified Source:** Located in `/synapse-src`. This is a fork of Synapse v1.147.1.
* **New Hook:** Added `check_visibility_can_see_event` to `ThirdPartyEventRules` to allow modules to blackhole specific events from certain users.
* **Visibility Logic:** Integrated into `synapse/visibility.py` and `synapse/handlers/sync.py`.
* **Rebuilding:** If you modify the Python or Rust code in `/synapse-src`, run `./rebuild-synapse.sh` to compile and install it into the running container.

### Restart the Stack
Run this from the project root:
```bash
./restart-stack.sh
```
This will:
1. Rebuild the App Service (TypeScript code).
2. Manually launch the container with correct network and volume mappings.
3. Restart Synapse to refresh the Python Gatekeeper module.

## Database Seeding
To reset or seed the test system:
```bash
sudo docker exec -it pluralmatrix-app-service npx ts-node seed-db.ts
```

## Testing

When running `npm test` within the App Service, always redirect stdout and stderr to a temporary file and then `cat` it to avoid hanging issues in the Gemini CLI:
```bash
cd app-service && npm test > test_output.log 2>&1; cat test_output.log
```

## Troubleshooting
* **Logs:** `sleep 5 && sudo docker logs pluralmatrix-app-service --tail 50` (Never use -f!)
* **Synapse Logs:** `sudo docker logs pluralmatrix-synapse --tail 50`
* **Permission Issues:** If Synapse crashes on boot, run:
  `sudo chown -R 991:991 synapse/config`
