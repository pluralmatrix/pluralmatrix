import { OlmMachine, RequestType, KeysUploadRequest, KeysQueryRequest, KeysClaimRequest, SignatureUploadRequest, DeviceLists } from "@matrix-org/matrix-sdk-crypto-nodejs";
import { Intent } from "matrix-appservice-bridge";
import { PrismaClient } from "@prisma/client";
import { sleep } from "../utils/timer";

// In-memory cache to prevent redundant registrations/logins within a single session
let registeredDevices = new Set<string>();

/**
 * Clears the in-memory registered devices cache. (Mainly for tests)
 */
export const clearRegisteredDevicesCache = () => {
    registeredDevices = new Set<string>();
};

// Helper to perform raw fetch using AS Token (MSC3202 style)
export async function doAsRequest(
    hsUrl: string, 
    asToken: string, 
    targetUserId: string, 
    method: string, 
    path: string, 
    body: any,
    msc3202DeviceId?: string
) {
    const url = new URL(`${hsUrl}${path}`);
    url.searchParams.set("user_id", targetUserId);
    if (msc3202DeviceId) {
        url.searchParams.set("org.matrix.msc3202.device_id", msc3202DeviceId);
    }

    const headers = {
        'Authorization': `Bearer ${asToken}`,
        'Content-Type': 'application/json'
    };

    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
        try {
            const res = await fetch(url.toString(), {
                method: method,
                headers: headers,
                body: body ? JSON.stringify(body) : undefined
            });

            if (!res.ok) {
                const text = await res.text();
                
                // Handle Rate Limiting
                if (res.status === 429 || text.includes("M_LIMIT_EXCEEDED")) {
                    attempts++;
                    const waitTime = Math.pow(2, attempts) * 1000 + (Math.random() * 1000);
                    console.warn(`[Crypto] Rate limited during ${method} ${path} for ${targetUserId}. Waiting ${Math.round(waitTime)}ms...`);
                    await sleep(waitTime);
                    continue;
                }

                console.error(`[Crypto] Matrix API Error ${res.status}: ${text} (${method} ${url.toString()})`);
                
                const error: any = new Error(`Matrix API Error ${res.status}`);
                error.status = res.status;
                error.body = text;
                throw error;
            }
            return res.json();
        } catch (e: any) {
            if (e.status === 429 || e.message?.includes("M_LIMIT_EXCEEDED")) {
                // Already handled above if possible, but catch network-level or other errors here
                attempts++;
                const waitTime = Math.pow(2, attempts) * 1000 + (Math.random() * 1000);
                await sleep(waitTime);
                continue;
            }
            throw e;
        }
    }

    throw new Error(`Max attempts reached for ${method} ${path}`);
}

// Semaphore to limit concurrent registrations (Synapse gets cranky if too many happen at once)
let activeRegistrations = 0;
const MAX_CONCURRENT_REGISTRATIONS = 1;

/**
 * Ensures a device is registered on the homeserver.
 * Returns true if the device was newly registered in this session.
 */
export async function registerDevice(intent: Intent, deviceId: string, prisma?: PrismaClient, memberId?: string, systemId?: string): Promise<boolean> {
    const userId = intent.userId;
    const cacheKey = `${userId}|${deviceId}`;
    
    // 1. Check in-memory cache (fastest)
    if (registeredDevices.has(cacheKey)) return false;

    // 2. Check DB if memberId provided
    if (prisma && memberId) {
        const member = await prisma.member.findUnique({
            where: { id: memberId },
            select: { deviceRegistered: true }
        });
        if (member?.deviceRegistered) {
            registeredDevices.add(cacheKey);
            return false;
        }
    }

    // 3. Check DB if systemId provided (for Bot)
    if (prisma && systemId) {
        const system = await prisma.system.findUnique({
            where: { id: systemId },
            select: { deviceRegistered: true }
        });
        if (system?.deviceRegistered) {
            registeredDevices.add(cacheKey);
            return false;
        }
    }

    // Wait for slot in semaphore
    while (activeRegistrations >= MAX_CONCURRENT_REGISTRATIONS) {
        await sleep(500 + Math.random() * 500);
    }

    activeRegistrations++;
    try {
        let attempts = 0;
        const maxAttempts = 5;

        while (attempts < maxAttempts) {
            try {
                if (attempts > 0) {
                    console.log(`[Crypto] Retrying registration for ${userId} (Attempt ${attempts + 1}/${maxAttempts})...`);
                } else {
                    console.log(`[Crypto] Registering/Verifying device ${deviceId} for ${userId}...`);
                }

                await intent.matrixClient.doRequest("POST", "/_matrix/client/v3/login", null, {
                    type: "m.login.application_service",
                    identifier: {
                        type: "m.id.user",
                        user: userId 
                    },
                    device_id: deviceId,
                    initial_device_display_name: "PluralMatrix (Native E2EE)"
                });
                
                console.log(`[Crypto] Device ${deviceId} registration verified.`);
                
                // Persist to DB
                if (prisma && memberId) {
                    await prisma.member.update({
                        where: { id: memberId },
                        data: { deviceRegistered: true }
                    });
                }
                if (prisma && systemId) {
                    await prisma.system.update({
                        where: { id: systemId },
                        data: { deviceRegistered: true }
                    });
                }

                registeredDevices.add(cacheKey);
                return true;
            } catch (e: any) {
                let isRateLimit = e.message?.includes("M_LIMIT_EXCEEDED");
                if (!isRateLimit && e.body) {
                    try {
                        const parsedBody = typeof e.body === 'string' ? JSON.parse(e.body) : e.body;
                        isRateLimit = parsedBody.errcode === "M_LIMIT_EXCEEDED";
                    } catch (parseErr) {}
                }
                
                if (isRateLimit) {
                    attempts++;
                    const waitTime = Math.pow(2, attempts) * 1000 + (Math.random() * 1000);
                    console.warn(`[Crypto] Rate limited while registering device ${deviceId} for ${userId}. Waiting ${Math.round(waitTime)}ms...`);
                    await sleep(waitTime);
                    continue;
                }
                
                console.error(`[Crypto] Device registration call failed for ${userId}:`, e.message);
                
                // If it's a 400 "already registered" error, we consider it a success
                const bodyStr = typeof e.body === 'string' ? e.body : (e.body ? JSON.stringify(e.body) : "");
                const errorStr = (e.message + bodyStr).toLowerCase();
                
                if (e.errcode === "M_USER_IN_USE" || errorStr.includes("already exists") || errorStr.includes("already taken") || errorStr.includes("in use")) {
                    console.log(`[Crypto] Device ${deviceId} was already registered for ${userId}.`);
                    if (prisma && memberId) {
                        await prisma.member.update({ where: { id: memberId }, data: { deviceRegistered: true } });
                    }
                    if (prisma && systemId) {
                        await prisma.system.update({ where: { id: systemId }, data: { deviceRegistered: true } });
                    }
                    registeredDevices.add(cacheKey);
                    return true;
                }

                registeredDevices.add(cacheKey);
                return false;
            }
        }

        console.error(`[Crypto] Max registration attempts reached for ${userId}`);
        return false;
    } finally {
        activeRegistrations--;
    }
}

/**
 * Dispatches a single cryptographic request to Synapse.
 */
export async function dispatchRequest(machine: OlmMachine, intent: Intent, asToken: string, req: any) {
    const userId = intent.userId;
    const hsUrl = intent.matrixClient.homeserverUrl.replace(/\/$/, "");
    const deviceId = machine.deviceId.toString();

    try {
        let response: any;

        switch (req.type) {
            case RequestType.KeysUpload:
                try {
                    response = await doAsRequest(hsUrl, asToken, userId, "POST", "/_matrix/client/v3/keys/upload", JSON.parse(req.body), deviceId);
                } catch (err: any) {
                    if (err.body && err.body.includes("already exists")) {
                        response = { "one_time_key_counts": { "signed_curve25519": 50 } }; 
                    } else throw err;
                }
                break;

            case RequestType.KeysQuery:
                const queryBody = JSON.parse(req.body);
                response = await doAsRequest(hsUrl, asToken, userId, "POST", "/_matrix/client/v3/keys/query", queryBody);
                const devCount = Object.keys(response.device_keys || {}).length;
                console.log(`[KEY_EXCHANGE] KeysQuery success for ${userId}. Found ${devCount} users.`);
                break;

            case RequestType.KeysClaim:
                const claimBody = JSON.parse(req.body);
                response = await doAsRequest(hsUrl, asToken, userId, "POST", "/_matrix/client/v3/keys/claim", claimBody);
                const OTKCount = response.one_time_keys ? Object.keys(response.one_time_keys).length : 0;
                console.log(`[KEY_EXCHANGE] KeysClaim success for ${userId}. Obtained OTKs for ${OTKCount} users.`);
                break;
            
            case RequestType.SignatureUpload:
                response = await doAsRequest(hsUrl, asToken, userId, "POST", "/_matrix/client/v3/keys/signatures/upload", JSON.parse(req.body));
                break;

            case RequestType.ToDevice:
                console.log(`[KEY_EXCHANGE] Sending ToDevice ${req.eventType} from ${userId}`);
                response = await doAsRequest(hsUrl, asToken, userId, "PUT", `/_matrix/client/v3/sendToDevice/${encodeURIComponent(req.eventType)}/${encodeURIComponent(req.txnId)}`, JSON.parse(req.body));
                break;

            default:
                console.warn(`[Crypto] Unknown request type: ${req.type}`);
                return;
        }
        
        await machine.markRequestAsSent(req.id, req.type, JSON.stringify(response));
    } catch (e: any) {
        console.error(`[KEY_EXCHANGE] ❌ FAILED request ${req.id} (Type ${req.type}) for ${userId}:`, e.message);
    }
}

export async function processCryptoRequests(machine: OlmMachine, intent: Intent, asToken: string) {
    let loopCount = 0;
    while (loopCount < 10) {
        const requests = await machine.outgoingRequests();
        if (requests.length === 0) break;
        for (const req of requests) {
            await dispatchRequest(machine, intent, asToken, req);
        }
        loopCount++;
    }
}
