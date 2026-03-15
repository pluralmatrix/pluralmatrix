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
    let jsonMock: jest.Mock;
    let statusMock: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        mockReq = {
            body: { mxid: '@alice:localhost', password: 'password' }
        } as unknown as import('express').Request;
        jsonMock = jest.fn();
        statusMock = jest.fn().mockReturnThis();
        mockRes = {
            json: jsonMock,
            status: statusMock
        } as unknown as import('express').Response;
    });

    it('should return token and hasSystem: true if user has a system', async () => {
        (auth.loginToMatrix as jest.Mock).mockResolvedValue(true);
        (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({ id: "link1" });

        await login(mockReq, mockRes);

        expect(jest.spyOn(prisma.system, 'create')).not.toHaveBeenCalled();
        expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
            token: 'mock_token',
            hasSystem: true
        }));
    });

    it('should auto-format mxid if missing @ or domain', async () => {
        (mockReq.body as { mxid: string }).mxid = 'ALICE';
        (auth.loginToMatrix as jest.Mock).mockResolvedValue(true);
        (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({ id: "link1" });

        await login(mockReq, mockRes);

        expect(jest.spyOn(prisma.accountLink, 'findUnique')).toHaveBeenCalledWith({
            where: { matrixId: '@alice:localhost' }
        });
        expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
            mxid: '@alice:localhost'
        }));
    });

    it('should return token and hasSystem: false if user has no system', async () => {
        (auth.loginToMatrix as jest.Mock).mockResolvedValue(true);
        (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue(null);

        await login(mockReq, mockRes);

        expect(jest.spyOn(prisma.system, 'create')).not.toHaveBeenCalled();
        expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
            token: 'mock_token',
            hasSystem: false
        }));
    });

    it('should return 401 if matrix login fails', async () => {
        (auth.loginToMatrix as jest.Mock).mockResolvedValue(false);

        await login(mockReq, mockRes);

        expect(statusMock).toHaveBeenCalledWith(401);
        expect(jsonMock).toHaveBeenCalledWith({ error: 'Invalid Matrix credentials' });
    });

    it('should return 400 for invalid inputs', async () => {
        mockReq.body = { mxid: 'just-string' }; // Missing password

        await login(mockReq, mockRes);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid input format' }));
    });

    it('should return 500 on unexpected errors', async () => {
        (auth.loginToMatrix as jest.Mock).mockRejectedValue(new Error('Matrix server down'));

        await login(mockReq, mockRes);

        expect(statusMock).toHaveBeenCalledWith(500);
        expect(jsonMock).toHaveBeenCalledWith({ error: 'Internal server error' });
    });
});

import { me } from './authController';

describe('AuthController - me', () => {
    it('should return req.user', () => {
        const mockReq = { user: { mxid: '@test:localhost' } } as Partial<import('express').Request> as import('express').Request;
        const jsonMockMe = jest.fn();
        const mockRes = { json: jsonMockMe } as unknown as import('express').Response;

        me(mockReq, mockRes);

        expect(jsonMockMe).toHaveBeenCalledWith({ user: { mxid: '@test:localhost' } });
    });
});
