import { Request, Response } from 'express';
import { prisma } from '../bot';
import { loginToMatrix, generateToken, AuthRequest } from '../auth';
import { proxyCache } from '../services/cache';
import { LoginSchema } from '../schemas/auth';
import { ensureUniqueSlug } from '../utils/slug';
import { z } from 'zod';
import { config } from '../config';

const DOMAIN = config.synapseDomain;

export const login = async (req: Request, res: Response) => {
    try {
        let { mxid, password } = LoginSchema.parse(req.body);

        const success = await loginToMatrix(mxid, password);

        if (success) {
            // Consistently lowercase and format the MXID
            mxid = mxid.toLowerCase();
            if (!mxid.startsWith('@')) mxid = `@${mxid}`;
            if (!mxid.includes(':')) mxid = `${mxid}:${DOMAIN}`;

            // Check if link exists
            const link = await prisma.accountLink.findUnique({
                where: { matrixId: mxid }
            });

            if (!link) {
                const localpart = mxid.split(':')[0].substring(1);
                
                // Retry loop for slug race conditions
                let attempts = 0;
                while (attempts < 5) {
                    try {
                        const slug = await ensureUniqueSlug(prisma, localpart);
                        await prisma.system.create({
                            data: {
                                slug,
                                name: `${localpart}'s System`,
                                accountLinks: {
                                    create: { matrixId: mxid }
                                }
                            }
                        });
                        break; // Success
                    } catch (err: any) {
                        if (err.code === 'P2002' && err.meta?.target?.includes('slug')) {
                            attempts++;
                            console.warn(`[Auth] Slug race condition detected for ${localpart}, retrying (attempt ${attempts})...`);
                            continue;
                        }
                        throw err; // Rethrow other errors
                    }
                }
                
                if (attempts >= 5) {
                    throw new Error(`Failed to create system after ${attempts} slug collision retries.`);
                }
            }

            // Invalidate cache to ensure new system is picked up if needed
            proxyCache.invalidate(mxid);

            const token = generateToken(mxid);
            return res.json({ token, mxid });
        } else {
            return res.status(401).json({ error: 'Invalid Matrix credentials' });
        }
    } catch (e) {
        if (e instanceof z.ZodError) {
            return res.status(400).json({ error: 'Invalid input format', details: e.issues });
        }
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const me = (req: AuthRequest, res: Response) => {
    res.json({ user: req.user });
};
