/**
 * Obfuscates a Matrix ID for privacy-safe logging.
 * e.g. "@alice:example.com" -> "@al...:example.com"
 */
export const maskMxid = (mxid: string | null | undefined): string => {
    if (!mxid) return "unknown";
    const parts = mxid.split(':');
    if (parts.length < 2) return mxid;
    
    const local = parts[0];
    const domain = parts.slice(1).join(':');
    
    // Mask the localpart (e.g. @ali...)
    const maskedLocal = local.length > 4 ? local.substring(0, 4) + '...' : local;
    
    return `${maskedLocal}:${domain}`;
};
