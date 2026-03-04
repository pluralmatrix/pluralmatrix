import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config';

export interface AuthRequest extends Request {
    user?: {
        mxid: string;
    };
}

/**
 * Middleware to protect routes with JWT
 */
export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.split(' ')[1]) || (req.query.token as string);

    if (!token) return res.sendStatus(401);
    if (!config.jwtSecret) {
        console.error('[Auth] JWT_SECRET is not configured!');
        return res.sendStatus(500);
    }

    jwt.verify(token, config.jwtSecret, (err: any, user: any) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

/**
 * Middleware to protect internal gatekeeper routes with a shared secret
 */
export const authenticateGatekeeper = (req: Request, res: Response, next: NextFunction) => {
    const gatekeeperSecret = config.gatekeeperSecret;
    if (!gatekeeperSecret) {
        console.error('[Auth] GATEKEEPER_SECRET is not configured!');
        return res.status(500).json({ error: 'Internal server configuration error' });
    }

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token === gatekeeperSecret) {
        return next();
    }

    console.warn(`[Auth] Gatekeeper authentication failed from ${req.ip}`);
    res.sendStatus(401);
};

/**
 * Logic to verify Matrix credentials against the user's home server
 */
export const loginToMatrix = async (mxid: string, password: string): Promise<boolean> => {
    try {
        let domain = config.synapseDomain;
        let fullMxid = mxid;
        
        // Ensure full MXID
        if (mxid.includes(':')) {
            domain = mxid.split(':')[1];
            fullMxid = mxid.startsWith('@') ? mxid : `@${mxid}`;
        } else {
            fullMxid = `@${mxid}:${domain}`;
        }

        // 1. Discover the correct homeserver URL via .well-known
        let serverUrl = `https://${domain}`;
        
        // Skip .well-known lookup for the local server if we have an internal URL configured
        if (domain === config.synapseDomain && config.synapseUrl) {
             serverUrl = config.synapseUrl;
        } else {
            try {
                const wellKnownRes = await fetch(`https://${domain}/.well-known/matrix/client`);
                if (wellKnownRes.ok) {
                    const wellKnownData = await wellKnownRes.json();
                    if (wellKnownData['m.homeserver']?.base_url) {
                        serverUrl = wellKnownData['m.homeserver'].base_url;
                        // Strip trailing slash if present
                        if (serverUrl.endsWith('/')) {
                            serverUrl = serverUrl.slice(0, -1);
                        }
                    }
                }
            } catch (err) {
                console.log(`[Auth] .well-known discovery failed for ${domain}, falling back to https://${domain}`);
            }
        }

        // 2. Authenticate against the discovered server
        const response = await fetch(`${serverUrl}/_matrix/client/v3/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'm.login.password',
                identifier: {
                    type: 'm.id.user',
                    user: fullMxid
                },
                password: password
            })
        });

        if (response.ok) {
            return true;
        } else {
            const data = await response.json();
            console.warn(`[Auth] Login failed for ${fullMxid} on ${serverUrl}:`, data.error);
            return false;
        }
    } catch (error) {
        console.error(`[Auth] Error connecting to homeserver for ${mxid}:`, error);
        return false;
    }
};

/**
 * Generate a JWT for a verified user
 */
export const generateToken = (mxid: string) => {
    // Ensure we use the full MXID format and LOWERCASE it for consistency
    const domain = config.synapseDomain;
    let fullMxid = mxid.includes(':') ? mxid : `@${mxid}:${domain}`;
    if (!fullMxid.startsWith('@')) fullMxid = `@${fullMxid}`;
    
    if (!config.jwtSecret) {
        throw new Error('JWT_SECRET is not configured!');
    }
    
    return jwt.sign({ mxid: fullMxid.toLowerCase() }, config.jwtSecret, { expiresIn: '7d' });
};
