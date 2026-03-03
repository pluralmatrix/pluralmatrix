export interface Config {
    // Database
    databaseUrl: string;

    // Project Identification
    projectName: string;

    // Synapse / Matrix
    synapseUrl: string;
    synapseDomain: string;
    synapsePort: number;

    // App Service Auth
    asToken: string;
    jwtSecret: string;
    gatekeeperSecret: string;

    // App Service Infrastructure
    appPort: number;
    cryptoDeviceId: string;
    rustHelperPath: string;

    // Internal Features
    cacheTtlSeconds: number;
}

const projectName = process.env.PROJECT_NAME || "pluralmatrix";

export const config: Config = {
    // Database
    databaseUrl: process.env.DATABASE_URL || "",

    // Project Identification
    projectName: projectName,

    // Synapse / Matrix
    synapseUrl: process.env.SYNAPSE_URL || `http://${projectName}-synapse:8008`,
    synapseDomain: process.env.SYNAPSE_DOMAIN || process.env.SYNAPSE_SERVER_NAME || "localhost",
    synapsePort: parseInt(process.env.SYNAPSE_PORT || "8008"),

    // App Service Auth
    asToken: process.env.AS_TOKEN || "",
    jwtSecret: process.env.JWT_SECRET || "",
    gatekeeperSecret: process.env.GATEKEEPER_SECRET || "",

    // App Service Infrastructure
    appPort: parseInt(process.env.APP_PORT || "9000"),
    cryptoDeviceId: process.env.CRYPTO_DEVICE_ID || "PLURAL_CTX_V10",
    rustHelperPath: process.env.RUST_HELPER_PATH || '/usr/local/bin/rust-crypto-helper',

    // Internal Features
    cacheTtlSeconds: parseInt(process.env.CACHE_TTL_SECONDS || "300"),
};

/**
 * Validates that critical configuration is present.
 * Throws an error if configuration is missing.
 */
export const validateConfig = () => {
    const missing = [];
    if (!config.asToken) missing.push("AS_TOKEN");
    if (!config.jwtSecret) missing.push("JWT_SECRET");

    if (missing.length > 0) {
        throw new Error(`CRITICAL CONFIGURATION MISSING: ${missing.join(", ")}. Please check your .env file.`);
    }
};
