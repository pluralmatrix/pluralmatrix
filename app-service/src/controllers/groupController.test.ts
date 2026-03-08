import express from 'express';
import request from 'supertest';
import bodyParser from 'body-parser';
import * as groupController from './groupController';

// Mock dependencies
jest.mock('../bot', () => ({
    prisma: {
        accountLink: {
            findUnique: jest.fn()
        },
        group: {
            create: jest.fn(),
            findFirst: jest.fn(),
            update: jest.fn(),
            delete: jest.fn()
        }
    }
}));

jest.mock('../services/events', () => ({
    emitSystemUpdate: jest.fn()
}));

import { prisma } from '../bot';
import { emitSystemUpdate } from '../services/events';

const app = express();
app.use(bodyParser.json());

// Mock auth middleware injecting the user
const mockAuth = (req: any, res: any, next: any) => {
    req.user = { mxid: '@alice:localhost' };
    next();
};

app.get('/groups', mockAuth, groupController.listGroups);
app.post('/groups', mockAuth, groupController.createGroup);
app.put('/groups/:id', mockAuth, groupController.updateGroup);
app.delete('/groups/:id', mockAuth, groupController.deleteGroup);

describe('Group Controller', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /groups', () => {
        it('should list groups for the user', async () => {
            const mockGroups = [{ id: 'g1', name: 'Test Group', members: [] }];
            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({
                system: { groups: mockGroups }
            });

            const res = await request(app).get('/groups');

            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockGroups);
        });
    });

    describe('POST /groups', () => {
        it('should create a new group', async () => {
            const mockSystem = { id: 'sys1' };
            const newGroup = { id: 'g1', name: 'New Group', slug: 'new-group' };

            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({
                system: mockSystem
            });
            (prisma.group.create as jest.Mock).mockResolvedValue(newGroup);

            const res = await request(app)
                .post('/groups')
                .send({ name: 'New Group', slug: 'new-group' });

            expect(res.status).toBe(201);
            expect(prisma.group.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ name: 'New Group' })
            }));
            expect(emitSystemUpdate).toHaveBeenCalledWith('@alice:localhost');
        });

        it('should validate inputs', async () => {
            const res = await request(app)
                .post('/groups')
                .send({ name: '' }); // Invalid name

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Invalid input format');
        });
    });

    describe('PUT /groups/:id', () => {
        it('should update an existing group', async () => {
            const mockGroup = { id: 'g1', name: 'Old Name' };
            const updatedGroup = { id: 'g1', name: 'Updated Name' };

            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({
                systemId: 'sys1'
            });
            (prisma.group.findFirst as jest.Mock).mockResolvedValue(mockGroup);
            (prisma.group.update as jest.Mock).mockResolvedValue(updatedGroup);

            const res = await request(app)
                .put('/groups/g1')
                .send({ name: 'Updated Name', slug: 'updated-name' });

            expect(res.status).toBe(200);
            expect(prisma.group.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'g1' },
                data: expect.objectContaining({ name: 'Updated Name' })
            }));
            expect(emitSystemUpdate).toHaveBeenCalledWith('@alice:localhost');
        });
    });

    describe('DELETE /groups/:id', () => {
        it('should delete a group', async () => {
            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({
                systemId: 'sys1'
            });
            (prisma.group.findFirst as jest.Mock).mockResolvedValue({ id: 'g1' });

            const res = await request(app).delete('/groups/g1');

            expect(res.status).toBe(204);
            expect(prisma.group.delete).toHaveBeenCalledWith({ where: { id: 'g1' } });
            expect(emitSystemUpdate).toHaveBeenCalledWith('@alice:localhost');
        });

        it('should return 404 if group not found', async () => {
            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({
                systemId: 'sys1'
            });
            (prisma.group.findFirst as jest.Mock).mockResolvedValue(null);

            const res = await request(app).delete('/groups/g1');

            expect(res.status).toBe(404);
            expect(prisma.group.delete).not.toHaveBeenCalled();
        });
    });
});