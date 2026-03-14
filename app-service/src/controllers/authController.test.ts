import { login } from './authController';
import { prisma } from '../bot';
import * as auth from '../auth';

jest.mock('../bot', () => ({
    prisma: {
        accountLink: {
            findUnique: jest.fn()
        },
        system: {
            create: jest.fn()
        }
    }
}));

jest.mock('../auth', () => ({
    loginToMatrix: jest.fn(),
    generateToken: jest.fn().mockReturnValue('mock_token')
}));

jest.mock('../utils/slug', () => ({
    ensureUniqueSlug: jest.fn()
}));

jest.mock('../services/cache', () => ({
    proxyCache: {
        invalidate: jest.fn()
    }
}));

describe('AuthController - login', () => {
    let mockReq: import('express').Request;
    let mockRes: import('express').Response;

    beforeEach(() => {
        jest.clearAllMocks();
        mockReq = {
            body: { mxid: '@alice:localhost', password: 'password' }
        } as unknown as import('express').Request;
        mockRes = {
            json: jest.fn(),
            status: jest.fn().mockReturnThis()
        } as unknown as import('express').Response;
    });

    it('should return token and hasSystem: true if user has a system', async () => {
        (auth.loginToMatrix as jest.Mock).mockResolvedValue(true);
        (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({ id: "link1" });

        await login(mockReq, mockRes);

        expect(prisma.system.create).not.toHaveBeenCalled();
        expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
            token: 'mock_token',
            hasSystem: true
        }));
    });

    it('should auto-format mxid if missing @ or domain', async () => {
        mockReq.body.mxid = 'ALICE';
        (auth.loginToMatrix as jest.Mock).mockResolvedValue(true);
        (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({ id: "link1" });

        await login(mockReq, mockRes);

        expect(prisma.accountLink.findUnique).toHaveBeenCalledWith({
            where: { matrixId: '@alice:localhost' }
        });
        expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
            mxid: '@alice:localhost'
        }));
    });

    it('should return token and hasSystem: false if user has no system', async () => {
        (auth.loginToMatrix as jest.Mock).mockResolvedValue(true);
        (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue(null);

        await login(mockReq, mockRes);

        expect(prisma.system.create).not.toHaveBeenCalled();
        expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
            token: 'mock_token',
            hasSystem: false
        }));
    });

    it('should return 401 if matrix login fails', async () => {
        (auth.loginToMatrix as jest.Mock).mockResolvedValue(false);

        await login(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(401);
        expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid Matrix credentials' });
    });

    it('should return 400 for invalid inputs', async () => {
        mockReq.body = { mxid: 'just-string' }; // Missing password

        await login(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid input format' }));
    });

    it('should return 500 on unexpected errors', async () => {
        (auth.loginToMatrix as jest.Mock).mockRejectedValue(new Error('Matrix server down'));

        await login(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(500);
        expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    });
});

import { me } from './authController';

describe('AuthController - me', () => {
    it('should return req.user', () => {
        const mockReq = { user: { mxid: '@test:localhost' } } as Partial<import('express').Request> as import('express').Request;
        const mockRes = { json: jest.fn() } as unknown as import('express').Response;

        me(mockReq, mockRes);

        expect(mockRes.json).toHaveBeenCalledWith({ user: { mxid: '@test:localhost' } });
    });
});
