import { login } from './authController';
import { prisma } from '../bot';
import * as auth from '../auth';
import { ensureUniqueSlug } from '../utils/slug';

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
    let mockReq: any;
    let mockRes: any;

    beforeEach(() => {
        jest.clearAllMocks();
        mockReq = {
            body: { mxid: '@alice:localhost', password: 'password' }
        };
        mockRes = {
            json: jest.fn(),
            status: jest.fn().mockReturnThis()
        };
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
});
