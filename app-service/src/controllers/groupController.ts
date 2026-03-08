import { Response } from 'express';
import { prisma } from '../bot';
import { AuthRequest } from '../auth';
import { GroupSchema } from '../schemas/group';
import { emitSystemUpdate } from '../services/events';
import { z } from 'zod';

export const listGroups = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const link = await prisma.accountLink.findUnique({
            where: { matrixId: mxid },
            include: { system: { include: { groups: { include: { members: true } } } } }
        });
        res.json(link?.system?.groups || []);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch groups' });
    }
};

export const createGroup = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const { name, slug, displayName, description, icon, color, members, privacy } = GroupSchema.parse(req.body);

        const link = await prisma.accountLink.findUnique({ 
            where: { matrixId: mxid },
            include: { system: true }
        });
        if (!link) return res.status(404).json({ error: 'System not found' });
        const system = link.system;

        const group = await prisma.group.create({
            data: {
                systemId: system.id,
                slug, 
                name,
                displayName,
                description,
                icon,
                color,
                privacy: privacy as any,
                members: members ? { connect: members.map(id => ({ id })) } : undefined
            },
            include: { members: true }
        });

        emitSystemUpdate(mxid);
        res.status(201).json(group);
    } catch (e) {
        if (e instanceof z.ZodError) {
            return res.status(400).json({ error: 'Invalid input format', details: e.issues });
        }
        console.error(e);
        res.status(500).json({ error: 'Failed to create group' });
    }
};

export const updateGroup = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const id = req.params.id as string;
        const { members, privacy, ...updateData } = GroupSchema.partial().parse(req.body);

        const link = await prisma.accountLink.findUnique({
            where: { matrixId: mxid }
        });
        if (!link) return res.status(403).json({ error: 'Forbidden' });

        const groupToUpdate = await prisma.group.findFirst({
            where: { id, systemId: link.systemId }
        });
        if (!groupToUpdate) return res.status(404).json({ error: 'Group not found' });

        const group = await prisma.group.update({
            where: { id },
            data: {
                ...updateData,
                privacy: privacy === undefined ? undefined : (privacy as any),
                members: members ? { set: members.map(mId => ({ id: mId })) } : undefined
            },
            include: { members: true }
        });

        emitSystemUpdate(mxid);
        res.json(group);
    } catch (e) {
        if (e instanceof z.ZodError) {
            return res.status(400).json({ error: 'Invalid input format', details: e.issues });
        }
        console.error(e);
        res.status(500).json({ error: 'Failed to update group' });
    }
};

export const deleteGroup = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const id = req.params.id as string;

        const link = await prisma.accountLink.findUnique({
            where: { matrixId: mxid }
        });
        if (!link) return res.status(403).json({ error: 'Forbidden' });

        const group = await prisma.group.findFirst({
            where: { id, systemId: link.systemId }
        });

        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
        }

        await prisma.group.delete({ where: { id } });

        emitSystemUpdate(mxid);
        res.status(204).send();
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to delete group' });
    }
};
