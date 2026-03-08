import { Response } from 'express';
import { prisma } from '../bot';
import { AuthRequest } from '../auth';
import { MemberSchema } from '../schemas/member';
import { proxyCache } from '../services/cache';
import { emitSystemUpdate } from '../services/events';
import { syncGhostProfile, decommissionGhost } from '../import';
import { z } from 'zod';

export const listMembers = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const link = await prisma.accountLink.findUnique({
            where: { matrixId: mxid },
            include: { system: { include: { members: { include: { groups: true } } } } }
        });
        res.json(link?.system?.members || []);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch members' });
    }
};

export const createMember = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const { name, displayName, avatarUrl, proxyTags, slug, description, pronouns, color, groups, privacy } = MemberSchema.parse(req.body);

        const link = await prisma.accountLink.findUnique({ 
            where: { matrixId: mxid },
            include: { system: { include: { members: true } } }
        });
        if (!link) return res.status(404).json({ error: 'System not found' });
        const system = link.system;

        // Check for duplicate proxy tags in the same system
        for (const member of system.members) {
            const existingTags = member.proxyTags as any[];
            for (const tag of proxyTags) {
                if (existingTags.some(et => et.prefix === tag.prefix && et.suffix === (tag.suffix || ""))) {
                    return res.status(400).json({ error: `The proxy tag "${tag.prefix}...${tag.suffix || ""}" is already in use by ${member.name}.` });
                }
            }
        }

        const member = await prisma.member.create({
            data: {
                systemId: system.id,
                slug: slug, 
                name,
                displayName,
                avatarUrl,
                proxyTags: proxyTags || [],
                description,
                pronouns,
                color,
                privacy: privacy as any,
                groups: groups ? { connect: groups.map(id => ({ id })) } : undefined
            }
        });

        // Sync profile to Matrix
        await syncGhostProfile(member, system);

        proxyCache.invalidate(mxid);
        emitSystemUpdate(mxid);
        res.status(201).json(member);
    } catch (e) {
        if (e instanceof z.ZodError) {
            return res.status(400).json({ error: 'Invalid input format', details: e.issues });
        }
        console.error(e);
        res.status(500).json({ error: 'Failed to create member' });
    }
};

export const updateMember = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const id = req.params.id as string;
        const updateData = MemberSchema.partial().parse(req.body);

        const link = await prisma.accountLink.findUnique({
            where: { matrixId: mxid },
            include: { system: { include: { members: true } } }
        });
        if (!link) return res.status(403).json({ error: 'Forbidden' });

        const memberToUpdate = await prisma.member.findFirst({
            where: { id, systemId: link.systemId }
        });
        if (!memberToUpdate) return res.status(404).json({ error: 'Member not found' });

        // Check for duplicate proxy tags in the same system (excluding the current member)
        if (updateData.proxyTags) {
            for (const member of link.system.members) {
                if (member.id === id) continue;
                const existingTags = member.proxyTags as any[];
                for (const tag of updateData.proxyTags) {
                    if (existingTags.some(et => et.prefix === tag.prefix && et.suffix === (tag.suffix || ""))) {
                        return res.status(400).json({ error: `The proxy tag "${tag.prefix}...${tag.suffix || ""}" is already in use by ${member.name}.` });
                    }
                }
            }
        }

        // If the slug is changing, we must decommission the old ghost first
        if (updateData.slug && updateData.slug !== memberToUpdate.slug) {
            await decommissionGhost(memberToUpdate, link.system);
        }

        const { groups, privacy, ...prismaUpdateData } = updateData;

        const updated = await prisma.member.update({
            where: { id },
            data: {
                ...prismaUpdateData,
                privacy: privacy === undefined ? undefined : (privacy as any),
                groups: groups ? { set: groups.map(groupId => ({ id: groupId })) } : undefined
            },
            include: { system: true }
        }) as any;

        // Sync updated profile to Matrix (under the new slug if it changed)
        await syncGhostProfile(updated, updated.system);

        proxyCache.invalidate(mxid);
        emitSystemUpdate(mxid);
        res.json(updated);
    } catch (e) {
        if (e instanceof z.ZodError) {
            return res.status(400).json({ error: 'Invalid input format', details: e.issues });
        }
        res.status(500).json({ error: 'Failed to update member' });
    }
};

export const deleteMember = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const id = req.params.id as string;

        const link = await prisma.accountLink.findUnique({
            where: { matrixId: mxid }
        });
        if (!link) return res.status(403).json({ error: 'Forbidden' });

        const member = await prisma.member.findFirst({
            where: { id, systemId: link.systemId },
            include: { system: true }
        });
        if (!member) return res.status(404).json({ error: 'Member not found' });

        // Cleanup Matrix state before DB deletion to ensure ghost leaves rooms
        await decommissionGhost(member, member.system);

        await prisma.member.delete({ where: { id } });
        proxyCache.invalidate(mxid);
        emitSystemUpdate(mxid);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete member' });
    }
};

export const deleteAllMembers = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        
        const link = await prisma.accountLink.findUnique({
            where: { matrixId: mxid }
        });
        if (!link) return res.status(403).json({ error: 'Forbidden' });

        // Find all members to decommission their ghosts first
        const members = await prisma.member.findMany({
            where: { systemId: link.systemId },
            include: { system: true }
        });

        for (const member of members) {
            await decommissionGhost(member, member.system);
        }

        await prisma.member.deleteMany({
            where: { systemId: link.systemId }
        });
        proxyCache.invalidate(mxid);
        emitSystemUpdate(mxid);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete all members' });
    }
};
