import { execFile } from 'child_process';
import { promisify } from 'util';
import { Intent } from "matrix-appservice-bridge";
import { config } from "../config";

import * as path from 'path';
import * as fs from 'fs';

const execFileAsync = promisify(execFile);

// Helper to perform raw fetch using AS Token
async function doAsRequest(
    hsUrl: string, 
    asToken: string, 
    targetUserId: string, 
    method: string, 
    path: string, 
    body: any
) {
    const url = new URL(`${hsUrl}${path}`);
    url.searchParams.set("user_id", targetUserId);

    const headers = {
        'Authorization': `Bearer ${asToken}`,
        'Content-Type': 'application/json'
    };

    const res = await fetch(url.toString(), {
        method: method,
        headers: headers,
        body: body ? JSON.stringify(body) : undefined
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Matrix API Error ${res.status}: ${text}`);
    }
    return res.json();
}

export interface BootstrapResult {
    keysRequestId: string;
    keysResponse: any;
    signaturesRequestId: string;
    signaturesResponse: any;
}

/**
 * Bootstraps cross-signing for a ghost user using the Rust sidecar.
 * This MUST be called BEFORE initializing the Node.js OlmMachine for this user.
 */
export async function bootstrapCrossSigning(
    userId: string, 
    deviceId: string, 
    storePath: string, 
    intent: Intent, 
    asToken: string
): Promise<BootstrapResult | null> {
    // Check if we need to bootstrap (sqlite file doesn't exist or is fresh)
    const dbPath = path.join(storePath, 'matrix-sdk-crypto.sqlite3');
    if (fs.existsSync(dbPath)) {
        return null;
    }

    console.log(`[Crypto] Bootstrapping cross-signing for ${userId} via Rust sidecar...`);

    const helperPath = config.rustHelperPath;
    
    try {
        const { stdout } = await execFileAsync(helperPath, [userId, deviceId, storePath]);
        const output = JSON.parse(stdout);

        const hsUrl = intent.matrixClient.homeserverUrl.replace(/\/$/, "");

        // 1. Upload Signing Keys (Master, Self-signing, User-signing)
        const keysPayload = output.upload_keys;
        keysPayload.auth = { type: "m.login.dummy" };

        const keysResponse = await doAsRequest(hsUrl, asToken, userId, "POST", "/_matrix/client/v3/keys/device_signing/upload", keysPayload);
        console.log(`[Crypto] Uploaded cross-signing keys for ${userId}`);

        // 2. Upload Signatures
        const signaturesResponse = await doAsRequest(hsUrl, asToken, userId, "POST", "/_matrix/client/v3/keys/signatures/upload", output.upload_signatures);
        console.log(`[Crypto] Uploaded cross-signing signatures for ${userId}`);

        return {
            keysRequestId: output.upload_keys_id,
            keysResponse,
            signaturesRequestId: output.upload_signatures_id,
            signaturesResponse
        };

    } catch (e: any) {
        console.error(`[Crypto] Failed to bootstrap cross-signing for ${userId}:`, e.message);
        throw e;
    }
}
