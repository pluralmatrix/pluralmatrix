import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;
const PROJECT_NAME = process.env.PROJECT_NAME || 'pluralmatrix';
const HOMESERVER_URL = process.env.SYNAPSE_URL || `http://${PROJECT_NAME}-synapse:8008`;

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
    if (!JWT_SECRET) {
        console.error('[Auth] JWT_SECRET is not configured!');
        return res.sendStatus(500);
    }

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

/**
 * Middleware to protect internal gatekeeper routes with a shared secret
 */
export const authenticateGatekeeper = (req: Request, res: Response, next: NextFunction) => {
    const gatekeeperSecret = process.env.GATEKEEPER_SECRET;
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
 * Logic to verify Matrix credentials against Synapse
 */
export const loginToMatrix = async (mxid: string, password: string): Promise<boolean> => {
    try {
        // Extract localpart if full MXID provided
        const localpart = mxid.startsWith('@') ? mxid.split(':')[0].substring(1) : mxid;

        const response = await fetch(`${HOMESERVER_URL}/_matrix/client/v3/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'm.login.password',
                user: localpart,
                password: password
            })
        });

        if (response.ok) {
            return true;
        } else {
            const data = await response.json();
            console.warn(`[Auth] Login failed for ${mxid}:`, data.error);
            return false;
        }
    } catch (error) {
        console.error('[Auth] Error connecting to Synapse:', error);
        return false;
    }
};

/**
 * Generate a JWT for a verified user
 */
export const generateToken = (mxid: string) => {
    // Ensure we use the full MXID format and LOWERCASE it for consistency
    const domain = process.env.SYNAPSE_DOMAIN || 'localhost';
    let fullMxid = mxid.includes(':') ? mxid : `@${mxid}:${domain}`;
    if (!fullMxid.startsWith('@')) fullMxid = `@${fullMxid}`;
    
    if (!JWT_SECRET) {
        throw new Error('JWT_SECRET is not configured!');
    }
    
    return jwt.sign({ mxid: fullMxid.toLowerCase() }, JWT_SECRET, { expiresIn: '7d' });
};
