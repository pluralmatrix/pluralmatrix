import { Request, Response } from 'express';
import { prisma } from '../bot';
import { AuthRequest } from '../auth';
import { SystemSchema } from '../schemas/member';
import { proxyCache } from '../services/cache';
import { emitSystemUpdate, systemEvents } from '../services/events';
import { messageQueue } from '../services/queue/MessageQueue';
import { syncGhostProfile, decommissionGhost } from '../import';
import { z } from 'zod';

import { ensureUniqueSlug } from '../utils/slug';
import { maskMxid } from '../utils/privacy';

export const streamSystemEvents = async (req: AuthRequest, res: Response) => {
    const mxid = req.user!.mxid;
    console.log(`[SSE] Client connected: ${maskMxid(mxid)}`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send initial heartbeat
    res.write(': heartbeat\n\n');

    const onUpdate = (updatedMxid: string) => {
        if (updatedMxid.toLowerCase() === mxid.toLowerCase()) {
            res.write(`data: ${JSON.stringify({ type: 'SYSTEM_UPDATE' })}\n\n`);
        }
    };

    const heartbeatInterval = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 30000);

    systemEvents.on('update', onUpdate);

    req.on('close', () => {
        console.log(`[SSE] Client disconnected: ${maskMxid(mxid)}`);
        clearInterval(heartbeatInterval);
        systemEvents.off('update', onUpdate);
    });
};

export const getPublicSystem = async (req: Request, res: Response) => {
    try {
        const slug = req.params.slug as string;
        const system = await prisma.system.findUnique({
            where: { slug },
            select: {
                slug: true,
                name: true,
                systemTag: true,
                description: true,
                pronouns: true,
                avatarUrl: true,
                banner: true,
                color: true,
                createdAt: true,
                members: {
                    select: {
                        id: true,
                        slug: true,
                        name: true,
                        displayName: true,
                        avatarUrl: true,
                        pronouns: true,
                        description: true,
                        color: true,
                        proxyTags: true,
                        createdAt: true
                    },
                    orderBy: {
                        slug: 'asc'
                    }
                }
            }
        });

        if (!system) {
            return res.status(404).json({ error: 'System not found' });
        }

        res.json(system);
    } catch (e) {
        console.error('[SystemController] Failed to fetch public system:', e);
        res.status(500).json({ error: 'Failed to fetch public system' });
    }
};

export const getSystem = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const link = await prisma.accountLink.findUnique({
            where: { matrixId: mxid },
            include: { system: true }
        });

        if (link) {
            return res.json(link.system);
        }

        // Create new system and link
        const localpart = mxid.split(':')[0].substring(1);
        const slug = await ensureUniqueSlug(prisma, localpart);
        
        const system = await prisma.system.create({
            data: {
                slug,
                name: `${localpart}'s System`,
                accountLinks: {
                    create: { matrixId: mxid, isPrimary: true }
                }
            }
        });

        res.json(system);
    } catch (e) {
        console.error('[SystemController] Failed to fetch/create system:', e);
        res.status(500).json({ error: 'Failed to fetch system' });
    }
};

export const updateSystem = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const { name, systemTag, slug: requestedSlug, autoproxyId } = SystemSchema.parse(req.body);

        const link = await prisma.accountLink.findUnique({
            where: { matrixId: mxid }
        });

        if (!link) {
            return res.status(404).json({ error: 'No system found for this account' });
        }

        const currentSystemId = link.systemId;
        let finalSlug = undefined;
        let slugChanged = false;

        if (requestedSlug) {
            // Check if slug is taken by SOME OTHER system
            const existing = await prisma.system.findUnique({
                where: { slug: requestedSlug }
            });

            if (existing && existing.id !== currentSystemId) {
                return res.status(409).json({ error: `The slug '${requestedSlug}' is already taken.` });
            }
            
            // Check if it's actually a change
            const currentSystem = await prisma.system.findUnique({ where: { id: currentSystemId } });
            if (currentSystem && currentSystem.slug !== requestedSlug) {
                slugChanged = true;
            }
            
            finalSlug = requestedSlug;
        }

        // If the system slug is changing, we must decommission all old ghosts
        let membersToMigrate: any[] = [];
        if (slugChanged) {
            const systemWithMembers = await prisma.system.findUnique({
                where: { id: currentSystemId },
                include: { members: true }
            });
            if (systemWithMembers) {
                for (const member of systemWithMembers.members) {
                    await decommissionGhost(member, systemWithMembers);
                }
                membersToMigrate = systemWithMembers.members;
            }
        }

        const updated = await prisma.system.update({
            where: { id: currentSystemId },
            data: { 
                name, 
                systemTag, 
                slug: finalSlug, 
                autoproxyId 
            }
        });

        // Re-sync ghosts under the new slug
        if (slugChanged) {
            for (const member of membersToMigrate) {
                await syncGhostProfile(member, updated);
            }
        }

        proxyCache.invalidate(mxid);
        emitSystemUpdate(mxid);
        res.json(updated);
    } catch (e) {
        if (e instanceof z.ZodError) {
            return res.status(400).json({ error: 'Invalid input format', details: e.issues });
        }
        console.error('[SystemController] Update failed:', e);
        res.status(500).json({ error: 'Failed to update system' });
    }
};

export const getLinks = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const link = await prisma.accountLink.findUnique({
            where: { matrixId: mxid }
        });

        if (!link) return res.status(404).json({ error: 'System not found' });

        const links = await prisma.accountLink.findMany({
            where: { systemId: link.systemId }
        });

        res.json(links);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch links' });
    }
};

export const createLink = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        let { targetMxid } = req.body;
        if (!targetMxid) return res.status(400).json({ error: 'Missing targetMxid' });

        targetMxid = targetMxid.toLowerCase();
        if (!targetMxid.startsWith('@')) targetMxid = `@${targetMxid}`;
        if (!targetMxid.includes(':')) {
            const domain = mxid.split(':')[1];
            targetMxid = `${targetMxid}:${domain}`;
        }

        const link = await prisma.accountLink.findUnique({
            where: { matrixId: mxid }
        });

        if (!link) return res.status(404).json({ error: 'System not found' });

        // Safety check: target existing system
        const targetLink = await prisma.accountLink.findUnique({
            where: { matrixId: targetMxid },
            include: { system: { include: { members: true, accountLinks: true } } }
        });

        if (targetLink) {
            if (targetLink.systemId === link.systemId) {
                return res.status(400).json({ error: 'Account is already linked' });
            }
            if (targetLink.system.members.length > 0) {
                return res.status(400).json({ error: 'Target account already has members in its system.' });
            }

            // Cleanup target's empty system if they were the only link
            if (targetLink.system.accountLinks.length === 1) {
                await prisma.system.delete({ where: { id: targetLink.systemId } });
            } else {
                await prisma.accountLink.delete({ where: { matrixId: targetMxid } });
            }
        }

        const existingPrimary = await prisma.accountLink.findFirst({
            where: { systemId: link.systemId, isPrimary: true }
        });

        const newLink = await prisma.accountLink.create({
            data: { 
                matrixId: targetMxid, 
                systemId: link.systemId,
                isPrimary: !existingPrimary
            }
        });

        proxyCache.invalidate(targetMxid);
        emitSystemUpdate(targetMxid);
        emitSystemUpdate(mxid);
        res.json(newLink);
    } catch (e) {
        res.status(500).json({ error: 'Failed to create link' });
    }
};

export const deleteLink = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const targetMxid = (req.params.mxid as string).toLowerCase();

        if (targetMxid === mxid.toLowerCase()) {
            return res.status(400).json({ error: 'You cannot unlink your own account.' });
        }

        const link = await prisma.accountLink.findUnique({
            where: { matrixId: mxid }
        });

        if (!link) return res.status(404).json({ error: 'System not found' });

        const targetLink = await prisma.accountLink.findUnique({
            where: { matrixId: targetMxid }
        });

        if (!targetLink || targetLink.systemId !== link.systemId) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const isTargetPrimary = targetLink.isPrimary;

        await prisma.accountLink.delete({ where: { matrixId: targetMxid } });

        // Cleanup if no links remain
        const remainingLinks = await prisma.accountLink.findMany({
            where: { systemId: link.systemId }
        });

        if (remainingLinks.length === 0) {
            // Unlink last account -> delete entire system and decommission ghosts
            const fullSystem = await prisma.system.findUnique({
                where: { id: link.systemId },
                include: { members: true }
            });
            if (fullSystem) {
                for (const member of fullSystem.members) {
                    await decommissionGhost(member, fullSystem);
                }
                await prisma.system.delete({ where: { id: link.systemId } });
            }
        } else if (isTargetPrimary) {
            // Promote another account to primary (prefer the current user)
            const nextPrimary = remainingLinks.find(l => l.matrixId.toLowerCase() === mxid.toLowerCase()) || remainingLinks[0];
            await prisma.accountLink.update({
                where: { matrixId: nextPrimary.matrixId },
                data: { isPrimary: true }
            });
        }

        proxyCache.invalidate(targetMxid);
        emitSystemUpdate(targetMxid);
        emitSystemUpdate(mxid);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete link' });
    }
};

export const setPrimaryAccount = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        let { targetMxid } = req.body;
        if (!targetMxid) return res.status(400).json({ error: 'Missing targetMxid' });

        targetMxid = targetMxid.toLowerCase();

        const link = await prisma.accountLink.findUnique({
            where: { matrixId: mxid }
        });

        if (!link) return res.status(404).json({ error: 'System not found' });

        // Verify target is part of the same system
        const targetLink = await prisma.accountLink.findUnique({
            where: { matrixId: targetMxid }
        });

        if (!targetLink || targetLink.systemId !== link.systemId) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        // Transaction to update primary status
        await prisma.$transaction([
            prisma.accountLink.updateMany({
                where: { systemId: link.systemId },
                data: { isPrimary: false }
            }),
            prisma.accountLink.update({
                where: { matrixId: targetMxid },
                data: { isPrimary: true }
            })
        ]);

        proxyCache.invalidate(mxid);
        emitSystemUpdate(mxid);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to set primary account' });
    }
};

export const getDeadLetters = async (req: AuthRequest, res: Response) => {
    const mxid = req.user!.mxid;
    // We filter dead letters to only show ones where the sender was this user's primary/linked account
    // For simplicity right now, we return all DLs for the ghost user ID prefix matching their system
    try {
        const link = await prisma.accountLink.findUnique({
            where: { matrixId: mxid },
            include: { system: true }
        });
        
        if (!link) return res.json([]);

        const allDl = messageQueue.getDeadLetters();
        const userDl = allDl.filter(dl => dl.ghostUserId.startsWith(`@_plural_${link.system.slug}_`));
        
        res.json(userDl);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch dead letters' });
    }
};

export const deleteDeadLetter = async (req: AuthRequest, res: Response) => {
    // Basic auth check already done by middleware
    const { id } = req.params;
    messageQueue.deleteDeadLetter(id as string);
    res.json({ success: true });
};

