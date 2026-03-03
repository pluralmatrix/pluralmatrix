import express from 'express';
import request from 'supertest';
import bodyParser from 'body-parser';
import * as systemController from './systemController';

// Mock dependencies
jest.mock('../bot', () => ({
    prisma: {
        accountLink: {
            findUnique: jest.fn(),
            findMany: jest.fn(),
            findFirst: jest.fn(),
            create: jest.fn(),
            delete: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn()
        },
        system: {
            findUnique: jest.fn(),
            delete: jest.fn(),
            create: jest.fn(),
            update: jest.fn()
        },
        $transaction: jest.fn().mockImplementation((promises) => Promise.all(promises))
    }
}));

jest.mock('../services/cache', () => ({
    proxyCache: {
        invalidate: jest.fn()
    }
}));

jest.mock('../services/events', () => ({
    emitSystemUpdate: jest.fn(),
    systemEvents: {
        on: jest.fn(),
        off: jest.fn()
    }
}));

jest.mock('../services/queue/MessageQueue', () => ({
    messageQueue: {
        getDeadLetters: jest.fn(),
        deleteDeadLetter: jest.fn()
    }
}));

import { prisma } from '../bot';
import { proxyCache } from '../services/cache';
import { emitSystemUpdate } from '../services/events';
import { messageQueue } from '../services/queue/MessageQueue';

const app = express();
app.use(bodyParser.json());

// Mock auth middleware injecting the user
const mockAuth = (mxid: string) => (req: any, res: any, next: any) => {
    req.user = { mxid };
    next();
};

// Route setup
app.get('/system', mockAuth('@alice:localhost'), systemController.getSystem);
app.get('/links', mockAuth('@alice:localhost'), systemController.getLinks);
app.post('/links', mockAuth('@alice:localhost'), systemController.createLink);
app.delete('/links/:mxid', mockAuth('@alice:localhost'), systemController.deleteLink);
app.post('/links/primary', mockAuth('@alice:localhost'), systemController.setPrimaryAccount);
app.get('/dlq', mockAuth('@alice:localhost'), systemController.getDeadLetters);
app.delete('/dlq/:id', mockAuth('@alice:localhost'), systemController.deleteDeadLetter);
app.patch('/system', mockAuth('@alice:localhost'), systemController.updateSystem);
app.get('/public/:slug', systemController.getPublicSystem);

import { decommissionGhost, syncGhostProfile } from '../import';
import { ensureUniqueSlug } from '../utils/slug';

jest.mock('../utils/slug', () => ({
    ensureUniqueSlug: jest.fn()
}));

jest.mock('../import', () => ({
    syncGhostProfile: jest.fn().mockResolvedValue(null),
    decommissionGhost: jest.fn().mockResolvedValue(null)
}));

describe('System Controller', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /links', () => {
        it('should return linked accounts', async () => {
            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({ systemId: 'sys1' });
            (prisma.accountLink.findMany as jest.Mock).mockResolvedValue([
                { matrixId: '@alice:localhost', isPrimary: true },
                { matrixId: '@bob:localhost', isPrimary: false }
            ]);

            const res = await request(app).get('/links');
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(2);
        });

        it('should return 404 if system not found', async () => {
            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue(null);
            const res = await request(app).get('/links');
            expect(res.status).toBe(404);
        });
    });

    describe('GET /system', () => {
        it('should return existing system if it exists', async () => {
            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({ 
                system: { id: 'sys1', slug: 'alice' } 
            });

            const res = await request(app).get('/system');
            expect(res.status).toBe(200);
            expect(res.body.slug).toBe('alice');
        });

        it('should auto-create system with slug retry if it does not exist', async () => {
            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue(null);
            (ensureUniqueSlug as jest.Mock).mockResolvedValue('alice');

            (prisma.system.create as jest.Mock)
                .mockRejectedValueOnce({ code: 'P2002', meta: { target: ['slug'] } })
                .mockResolvedValueOnce({ id: 'sys1', slug: 'alice-2' });

            const res = await request(app).get('/system');

            expect(res.status).toBe(200);
            expect(prisma.system.create).toHaveBeenCalledTimes(2);
            expect(res.body.id).toBe('sys1');
        });
    });

    describe('POST /links', () => {
        it('should create a new link', async () => {
            (prisma.accountLink.findUnique as jest.Mock)
                .mockResolvedValueOnce({ systemId: 'sys1' }) // Sender
                .mockResolvedValueOnce(null); // Target

            (prisma.accountLink.findFirst as jest.Mock).mockResolvedValue({ isPrimary: true });
            (prisma.accountLink.create as jest.Mock).mockResolvedValue({ matrixId: '@bob:localhost', isPrimary: false });

            const res = await request(app).post('/links').send({ targetMxid: '@bob:localhost' });

            expect(res.status).toBe(200);
            expect(prisma.accountLink.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ matrixId: '@bob:localhost', systemId: 'sys1', isPrimary: false })
            }));
            expect(proxyCache.invalidate).toHaveBeenCalledWith('@bob:localhost');
            expect(emitSystemUpdate).toHaveBeenCalledTimes(2);
        });

        it('should fail if target already has members', async () => {
            (prisma.accountLink.findUnique as jest.Mock)
                .mockResolvedValueOnce({ systemId: 'sys1' }) // Sender
                .mockResolvedValueOnce({ systemId: 'sys2', system: { members: [{ id: 'm1' }] } }); // Target

            const res = await request(app).post('/links').send({ targetMxid: '@bob:localhost' });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('already has members');
        });

        it('should fail if already linked to same system', async () => {
            (prisma.accountLink.findUnique as jest.Mock)
                .mockResolvedValueOnce({ systemId: 'sys1' }) // Sender
                .mockResolvedValueOnce({ systemId: 'sys1', system: { members: [] } }); // Target

            const res = await request(app).post('/links').send({ targetMxid: '@alice_alt:localhost' });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('already linked');
        });

        it('should delete empty target system if it was the only link', async () => {
            (prisma.accountLink.findUnique as jest.Mock)
                .mockResolvedValueOnce({ systemId: 'sys1' }) // Sender
                .mockResolvedValueOnce({ 
                    systemId: 'sys2', 
                    system: { members: [], accountLinks: [{}] } // 1 link
                }); 

            await request(app).post('/links').send({ targetMxid: '@bob:localhost' });

            expect(prisma.system.delete).toHaveBeenCalledWith({ where: { id: 'sys2' } });
        });
    });

    describe('DELETE /links/:mxid', () => {
        it('should delete a link', async () => {
            (prisma.accountLink.findUnique as jest.Mock)
                .mockResolvedValueOnce({ systemId: 'sys1' }) // Sender
                .mockResolvedValueOnce({ systemId: 'sys1', isPrimary: false }); // Target

            (prisma.accountLink.findMany as jest.Mock).mockResolvedValue([
                { matrixId: '@alice:localhost', isPrimary: true }
            ]);

            const res = await request(app).delete('/links/@bob:localhost');

            expect(res.status).toBe(200);
            expect(prisma.accountLink.delete).toHaveBeenCalledWith({ where: { matrixId: '@bob:localhost' } });
        });

        it('should prevent deleting own account', async () => {
            const res = await request(app).delete('/links/@alice:localhost');
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('cannot unlink your own account');
        });

        it('should assign a new primary if primary is deleted', async () => {
            (prisma.accountLink.findUnique as jest.Mock)
                .mockResolvedValueOnce({ systemId: 'sys1' }) // Sender
                .mockResolvedValueOnce({ systemId: 'sys1', isPrimary: true }); // Target

            (prisma.accountLink.findMany as jest.Mock).mockResolvedValue([
                { matrixId: '@alice:localhost', isPrimary: false } // Remaining
            ]);

            await request(app).delete('/links/@bob:localhost');

            expect(prisma.accountLink.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { matrixId: '@alice:localhost' },
                data: { isPrimary: true }
            }));
        });

        it('should delete system if no links remain', async () => {
            (prisma.accountLink.findUnique as jest.Mock)
                .mockResolvedValueOnce({ systemId: 'sys1' }) // Sender (bypassed own check in mock for simplicity, though real logic blocks it)
                .mockResolvedValueOnce({ systemId: 'sys1', isPrimary: true }); // Target

            (prisma.accountLink.findMany as jest.Mock).mockResolvedValue([]); // No remaining

            (prisma.system.findUnique as jest.Mock).mockResolvedValue({
                id: 'sys1',
                members: [{ id: 'm1', slug: 'm1' }]
            });

            // Overriding the auth middleware for this specific test to simulate deleting the last OTHER account?
            // Actually, if the user deletes the *only other* account, and 0 remain? Wait, the user themselves must remain.
            // But if we mock findMany to return [], it will trigger system deletion.
            
            // To pass the "own account" check, we use a different target
            await request(app).delete('/links/@bob:localhost');
            expect(prisma.system.delete).toHaveBeenCalledWith({ where: { id: 'sys1' } });
        });
    });

    describe('POST /links/primary', () => {
        it('should update primary status via transaction', async () => {
            (prisma.accountLink.findUnique as jest.Mock)
                .mockResolvedValueOnce({ systemId: 'sys1' })
                .mockResolvedValueOnce({ systemId: 'sys1' });

            const res = await request(app).post('/links/primary').send({ targetMxid: '@bob:localhost' });

            expect(res.status).toBe(200);
            expect(prisma.$transaction).toHaveBeenCalled();
            expect(prisma.accountLink.updateMany).toHaveBeenCalledWith({
                where: { systemId: 'sys1' },
                data: { isPrimary: false }
            });
            expect(prisma.accountLink.update).toHaveBeenCalledWith({
                where: { matrixId: '@bob:localhost' },
                data: { isPrimary: true }
            });
        });
    });

    describe('Dead Letter Queue', () => {
        it('should return dead letters matching the system slug', async () => {
            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({ 
                system: { slug: 'sys1' } 
            });

            (messageQueue.getDeadLetters as jest.Mock).mockReturnValue([
                { ghostUserId: '@_plural_sys1_ghost:localhost', eventId: '$1' },
                { ghostUserId: '@_plural_other_ghost:localhost', eventId: '$2' }
            ]);

            const res = await request(app).get('/dlq');

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].eventId).toBe('$1');
        });

        it('should delete a dead letter', async () => {
            const res = await request(app).delete('/dlq/dl123');
            expect(res.status).toBe(200);
            expect(messageQueue.deleteDeadLetter).toHaveBeenCalledWith('dl123');
        });
    });

    describe('PATCH /system', () => {
        it('should decommission all ghosts and resync them if the system slug changes', async () => {
            const mockSystemWithMembers = {
                id: 'sys1',
                slug: 'old-sys-slug',
                members: [
                    { id: 'm1', slug: 'alice' },
                    { id: 'm2', slug: 'bob' }
                ]
            };

            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({ systemId: 'sys1' });
            
            // First call checks if the new slug is taken (returns null meaning it's free)
            // Second call gets the current system to check if it changed
            // Third call gets the system with members to decommission
            (prisma.system.findUnique as jest.Mock)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ id: 'sys1', slug: 'old-sys-slug' })
                .mockResolvedValueOnce(mockSystemWithMembers);

            const updatedSystem = { id: 'sys1', slug: 'new-sys-slug' };
            (prisma.system.update as jest.Mock).mockResolvedValue(updatedSystem);

            const res = await request(app)
                .patch('/system')
                .send({ slug: 'new-sys-slug' });

            expect(res.status).toBe(200);
            
            // Should decommission the old ghosts
            expect(decommissionGhost).toHaveBeenCalledTimes(2);
            expect(decommissionGhost).toHaveBeenCalledWith(mockSystemWithMembers.members[0], mockSystemWithMembers);
            expect(decommissionGhost).toHaveBeenCalledWith(mockSystemWithMembers.members[1], mockSystemWithMembers);
            
            // Should sync the new ghosts under the updated system
            expect(syncGhostProfile).toHaveBeenCalledTimes(2);
            expect(syncGhostProfile).toHaveBeenCalledWith(mockSystemWithMembers.members[0], updatedSystem);
            expect(syncGhostProfile).toHaveBeenCalledWith(mockSystemWithMembers.members[1], updatedSystem);
        });

        it('should NOT decommission ghosts if the system slug is unchanged', async () => {
            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({ systemId: 'sys1' });
            
            (prisma.system.findUnique as jest.Mock)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ id: 'sys1', slug: 'same-slug' });

            (prisma.system.update as jest.Mock).mockResolvedValue({ id: 'sys1', slug: 'same-slug', name: 'New Name' });

            const res = await request(app)
                .patch('/system')
                .send({ slug: 'same-slug', name: 'New Name' });

            expect(res.status).toBe(200);
            
            // Should NOT decommission or resync
            expect(decommissionGhost).not.toHaveBeenCalled();
            expect(syncGhostProfile).not.toHaveBeenCalled();
        });

        it('should return 400 Bad Request on Zod validation failure', async () => {
            const res = await request(app)
                .patch('/system')
                .send({ slug: 'INVALID SLUG WITH SPACES' });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Invalid input format');
            expect(prisma.system.update).not.toHaveBeenCalled();
        });
    });

    describe('GET /public/:slug', () => {
        it('should return only safe fields for unauthenticated users', async () => {
            const mockPublicData = {
                slug: 'sys1',
                name: 'Public System',
                systemTag: '🚀',
                members: [
                    { id: 'm1', slug: 'alice', name: 'Alice' }
                ]
            };

            (prisma.system.findUnique as jest.Mock).mockResolvedValue(mockPublicData);

            const res = await request(app).get('/public/sys1');

            expect(res.status).toBe(200);
            expect(res.body.slug).toBe('sys1');
            expect(res.body.name).toBe('Public System');
            // Ensure internal fields are missing
            expect(res.body.id).toBeUndefined();
            expect(res.body.autoproxyId).toBeUndefined();
            expect(res.body.pkId).toBeUndefined();
        });

        it('should return 404 if system not found', async () => {
            (prisma.system.findUnique as jest.Mock).mockResolvedValue(null);
            const res = await request(app).get('/public/missing');
            expect(res.status).toBe(404);
        });
    });
});
