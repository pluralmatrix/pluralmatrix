import { OlmMachine, UserId, DeviceId, RequestType } from "@matrix-org/matrix-sdk-crypto-nodejs";
import * as fs from "fs";
import * as path from "path";
import { Mutex } from "async-mutex";
import { config } from "../config";
import { bootstrapCrossSigning, BootstrapResult } from "./CrossSigningBootstrapper";

export class OlmMachineManager {
    private machines: Map<string, OlmMachine> = new Map();
    private locks: Map<string, Mutex> = new Map();
    private storageRoot: string;
    private bridge: any;
    private asToken: string | undefined;

    constructor(storageRoot: string = "./data/crypto") {
        this.storageRoot = storageRoot;
        if (!fs.existsSync(this.storageRoot)) {
            fs.mkdirSync(this.storageRoot, { recursive: true });
        }
    }

    setContext(bridge: any, asToken: string) {
        this.bridge = bridge;
        this.asToken = asToken;
    }

    async getMachine(userId: string): Promise<OlmMachine> {
        // 1. Fast path: already initialized
        if (this.machines.has(userId)) {
            return this.machines.get(userId)!;
        }

        // 2. Slow path: Acquire per-user lock to prevent race conditions during initialization
        if (!this.locks.has(userId)) {
            this.locks.set(userId, new Mutex());
        }
        
        const mutex = this.locks.get(userId)!;
        return await mutex.runExclusive(async () => {
            // Check again after acquiring lock
            if (this.machines.has(userId)) {
                return this.machines.get(userId)!;
            }

            const sanitizedId = userId.replace(/[^a-zA-Z0-9]/g, "_");
            const storePath = path.join(this.storageRoot, sanitizedId);
            const deviceId = config.cryptoDeviceId; 
            const deviceIdFile = path.join(storePath, ".device_id");

            // Ensure store directory exists and check for device ID changes
            if (!fs.existsSync(storePath)) {
                fs.mkdirSync(storePath, { recursive: true });
            } else {
                let storedDeviceId = "";
                if (fs.existsSync(deviceIdFile)) {
                    storedDeviceId = fs.readFileSync(deviceIdFile, "utf-8").trim();
                }
                
                // If we have a stored ID and it differs from the current one, wipe the state
                if (storedDeviceId && storedDeviceId !== deviceId) {
                    console.log(`[Crypto] Device ID changed from ${storedDeviceId} to ${deviceId}. Wiping crypto store for ${userId}...`);
                    fs.rmSync(storePath, { recursive: true, force: true });
                    fs.mkdirSync(storePath, { recursive: true });
                }
            }

            // Record the active device ID
            fs.writeFileSync(deviceIdFile, deviceId, "utf-8");

            // Automated Cross-Signing Bootstrapping via Rust Sidecar
            // Must happen BEFORE OlmMachine.initialize to avoid sqlite locks
            let bootstrapResult: BootstrapResult | null = null;
            if (this.bridge && this.asToken) {
                bootstrapResult = await bootstrapCrossSigning(
                    userId,
                    deviceId,
                    storePath,
                    this.bridge.getIntent(userId),
                    this.asToken
                );
            }

            console.log(`[Crypto] Initializing OlmMachine for ${userId} (Device: ${deviceId}) at ${storePath}`);
            const machine = await OlmMachine.initialize(new UserId(userId), new DeviceId(deviceId), storePath);
            
            // Identity Keys are read-only properties
            const keys = machine.identityKeys;
            console.log(`[Crypto] Machine initialized for ${userId}. Identity: curve25519=${keys.curve25519.toString().substring(0,10)}...`);
            
            this.machines.set(userId, machine);
            return machine;
        });
    }
}
