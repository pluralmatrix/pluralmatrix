import express from 'express';
import request from 'supertest';
import bodyParser from 'body-parser';
import * as memberController from './memberController';
import { z } from 'zod';

// Mock dependencies
jest.mock('../bot', () => ({
    prisma: {
        accountLink: {
            findUnique: jest.fn()
        },
        member: {
            findFirst: jest.fn(),
            findMany: jest.fn(),
            update: jest.fn(),
            create: jest.fn(),
            delete: jest.fn(),
            deleteMany: jest.fn()
        },
        system: {
            findUnique: jest.fn()
        }
    }
}));

jest.mock('../services/cache', () => ({
    proxyCache: {
        invalidate: jest.fn()
    }
}));

jest.mock('../services/events', () => ({
    emitSystemUpdate: jest.fn()
}));

jest.mock('../import', () => ({
    syncGhostProfile: jest.fn().mockResolvedValue(null),
    decommissionGhost: jest.fn().mockResolvedValue(null)
}));

import { prisma } from '../bot';
import { syncGhostProfile, decommissionGhost } from '../import';

const app = express();
app.use(bodyParser.json());

// Mock auth middleware injecting the user
const mockAuth = (req: any, res: any, next: any) => {
    req.user = { mxid: '@alice:localhost' };
    next();
};

app.patch('/members/:id', mockAuth, memberController.updateMember);
app.delete('/members/:id', mockAuth, memberController.deleteMember);
app.delete('/members', mockAuth, memberController.deleteAllMembers);

describe('Member Controller', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('PATCH /members/:id', () => {
        it('should decommission the old ghost when the member slug is changed', async () => {
            const mockSystem = { id: 'sys1', slug: 'sys-slug', members: [] };
            const oldMember = { id: 'm1', slug: 'old-slug', systemId: 'sys1' };
            const updatedMember = { id: 'm1', slug: 'new-slug', systemId: 'sys1', system: mockSystem };

            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({ systemId: 'sys1', system: mockSystem });
            (prisma.member.findFirst as jest.Mock).mockResolvedValue(oldMember);
            (prisma.member.update as jest.Mock).mockResolvedValue(updatedMember);

            const res = await request(app)
                .patch('/members/m1')
                .send({ slug: 'new-slug' });

            expect(res.status).toBe(200);
            
            // Should decommission the OLD ghost
            expect(decommissionGhost).toHaveBeenCalledWith(oldMember, mockSystem);
            
            // Should sync the NEW ghost
            expect(syncGhostProfile).toHaveBeenCalledWith(updatedMember, mockSystem);
        });

        it('should NOT decommission the ghost if the slug is unchanged', async () => {
            const mockSystem = { id: 'sys1', slug: 'sys-slug', members: [] };
            const oldMember = { id: 'm1', slug: 'same-slug', systemId: 'sys1' };
            const updatedMember = { id: 'm1', slug: 'same-slug', name: 'New Name', systemId: 'sys1', system: mockSystem };

            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({ systemId: 'sys1', system: mockSystem });
            (prisma.member.findFirst as jest.Mock).mockResolvedValue(oldMember);
            (prisma.member.update as jest.Mock).mockResolvedValue(updatedMember);

            const res = await request(app)
                .patch('/members/m1')
                .send({ name: 'New Name' });

            expect(res.status).toBe(200);
            
            // Should NOT decommission
            expect(decommissionGhost).not.toHaveBeenCalled();
            
            // Should just update the existing ghost
            expect(syncGhostProfile).toHaveBeenCalledWith(updatedMember, mockSystem);
        });

        it('should return 400 Bad Request on Zod validation failure', async () => {
            const res = await request(app)
                .patch('/members/m1')
                .send({ slug: 'INVALID SLUG WITH SPACES AND CAPS' });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Invalid input format');
            expect(prisma.member.update).not.toHaveBeenCalled();
        });
    });

    describe('DELETE /members/:id', () => {
        it('should decommission the ghost before deleting the member from DB', async () => {
            const mockSystem = { id: 'sys1', slug: 'sys-slug' };
            const mockMember = { id: 'm1', slug: 'lily', systemId: 'sys1', system: mockSystem };

            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({ systemId: 'sys1' });
            (prisma.member.findFirst as jest.Mock).mockResolvedValue(mockMember);

            const res = await request(app).delete('/members/m1');

            expect(res.status).toBe(200);
            expect(decommissionGhost).toHaveBeenCalledWith(mockMember, mockSystem);
            expect(prisma.member.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
        });
    });

    describe('DELETE /members', () => {
        it('should decommission every member ghost before bulk deleting', async () => {
            const mockSystem = { id: 'sys1', slug: 'sys-slug' };
            const mockMembers = [
                { id: 'm1', slug: 'alice', systemId: 'sys1', system: mockSystem },
                { id: 'm2', slug: 'bob', systemId: 'sys1', system: mockSystem }
            ];

            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({ systemId: 'sys1' });
            (prisma.member.findMany as jest.Mock).mockResolvedValue(mockMembers);

            const res = await request(app).delete('/members');

            expect(res.status).toBe(200);
            expect(decommissionGhost).toHaveBeenCalledTimes(2);
            expect(prisma.member.deleteMany).toHaveBeenCalledWith({ where: { systemId: 'sys1' } });
        });
    });
});
