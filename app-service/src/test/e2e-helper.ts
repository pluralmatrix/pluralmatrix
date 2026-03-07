import { execSync } from 'child_process';
import { MatrixClient, RustSdkCryptoStorageProvider, MemoryStorageProvider, AutojoinRoomsMixin } from '@vector-im/matrix-bot-sdk';
import * as path from 'path';
import * as fs from 'fs';
import { config } from '../config';

// Use a helper to get the effective Synapse URL for E2E tests.
// Outside of Docker, we want to talk to localhost.
const getSynapseUrl = () => {
    if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
        return "http://localhost:8008";
    }
    return config.synapseUrl;
};

const getAppServiceUrl = () => `http://localhost:${config.appPort}`;

const printRateLimitHelp = () => {
    console.error(`
================================================================================
⚠️  E2E FAILURE: M_LIMIT_EXCEEDED detected!
================================================================================
Your Synapse server is rate-limiting the E2E tests. To fix this:

1. Open 'synapse/config/homeserver.yaml'
2. Uncomment the 'rc_registration', 'rc_login', and 'rc_message' blocks 
   (see 'synapse/config/homeserver.yaml.example' for reference).
3. Restart Synapse: ./restart-stack.sh
4. Run tests again.
================================================================================
`);
};

export const registerUser = async (username: string, password: string): Promise<string> => {
    console.log(`[E2E] Registering user ${username} with password ${password}...`);
    const domain = config.synapseDomain;
    const hsUrl = getSynapseUrl();
    try {
        const response = await fetch(`${hsUrl}/_matrix/client/v3/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: username,
                password: password,
                auth: { type: "m.login.dummy" }
            })
        });

        const data = await response.json() as any;
        if (!response.ok) {
            if (data.errcode === 'M_USER_IN_USE') {
                console.log(`[E2E] User ${username} already exists.`);
                return `@${username}:${domain}`;
            }
            if (data.errcode === 'M_LIMIT_EXCEEDED') {
                printRateLimitHelp();
            }
            throw new Error(`Registration failed: ${JSON.stringify(data)}`);
        }

        console.log(`[E2E] User ${username} registered successfully.`);
        return `@${username}:${domain}`;
    } catch (e: any) {
        console.error(`[E2E] Registration failed for ${username}:`, e.message);
        throw e;
    }
};

export const getMatrixClient = async (username: string, password: string): Promise<MatrixClient> => {
    console.log(`[E2E] Logging in user ${username} to Matrix...`);
    const hsUrl = getSynapseUrl();
    const response = await fetch(`${hsUrl}/_matrix/client/v3/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            type: "m.login.password",
            identifier: { type: "m.id.user", user: username },
            password: password
        })
    });
    
    const data = await response.json() as any;
    if (!response.ok) {
        if (data.errcode === 'M_LIMIT_EXCEEDED') {
            printRateLimitHelp();
        }
        console.error(`[E2E] Matrix login failed for ${username}:`, JSON.stringify(data));
        throw new Error(`Login failed: ${JSON.stringify(data)}`);
    }
    
    console.log(`[E2E] User ${username} logged in to Matrix.`);

    // Enable E2EE for E2E tests
    const storagePath = path.join(process.cwd(), 'data', 'e2e_crypto', username);
    if (!fs.existsSync(storagePath)) {
        fs.mkdirSync(storagePath, { recursive: true });
    }

    // In modern matrix-bot-sdk, the 3rd arg is the base storage, 4th is crypto
    const baseStorage = new MemoryStorageProvider();
    const crypto = new RustSdkCryptoStorageProvider(storagePath, 0); // 0 = Sqlite (usually)
    
    const client = new MatrixClient(hsUrl, data.access_token, baseStorage, crypto);
    AutojoinRoomsMixin.setupOnClient(client);
    return client;
};

export const getPluralMatrixToken = async (mxid: string, password: string): Promise<string> => {
    console.log(`[E2E] Fetching PluralMatrix JWT for ${mxid}...`);
    const response = await fetch(`${getAppServiceUrl()}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mxid, password })
    });
    
    const data = await response.json() as any;
    if (!response.ok) {
        console.error(`[E2E] PluralMatrix login failed for ${mxid}:`, JSON.stringify(data));
        throw new Error(`PluralMatrix login failed: ${JSON.stringify(data)}`);
    }
    
    console.log(`[E2E] PluralMatrix JWT obtained for ${mxid}.`);
    return data.token;
};

export const setupTestRoom = async (client: MatrixClient): Promise<string> => {
    console.log(`[E2E] Creating test room...`);
    const domain = config.synapseDomain;
    const roomId = await client.createRoom({
        visibility: 'private',
        name: `E2E Test Room ${Date.now()}`,
        invite: [`@plural_bot:${domain}`]
    });
    console.log(`[E2E] Test room created: ${roomId}`);
    return roomId;
};

export const deactivateUser = async (userId: string, accessToken: string) => {
    console.log(`[E2E] Deactivating user ${userId} via Admin API...`);
    const hsUrl = getSynapseUrl();
    try {
        const response = await fetch(`${hsUrl}/_synapse/admin/v1/deactivate/${encodeURIComponent(userId)}`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ erase: true })
        });
        
        if (!response.ok) {
            const data = await response.json() as any;
            console.warn(`[E2E] Deactivation failed for ${userId}: ${JSON.stringify(data)}`);
        } else {
            console.log(`[E2E] User ${userId} successfully deactivated.`);
        }
    } catch (e: any) {
        console.error(`[E2E] Error during deactivation of ${userId}:`, e.message);
    }
};

export const cleanupCryptoStorage = (username: string) => {
    const storagePath = path.join(process.cwd(), 'data', 'e2e_crypto', username);
    if (fs.existsSync(storagePath)) {
        console.log(`[E2E] Cleaning up crypto storage for ${username}...`);
        fs.rmSync(storagePath, { recursive: true, force: true });
    }
};
