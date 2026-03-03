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

describe('AuthController - login slug retry', () => {
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

    it('should retry system creation if slug collision occurs', async () => {
        (auth.loginToMatrix as jest.Mock).mockResolvedValue(true);
        (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue(null);
        
        // Mock slug resolution to return the same slug twice
        (ensureUniqueSlug as jest.Mock).mockResolvedValue('alice');

        // Mock first creation attempt to fail with P2002 (Slug Collision)
        // Then second attempt succeeds
        (prisma.system.create as jest.Mock)
            .mockRejectedValueOnce({
                code: 'P2002',
                meta: { target: ['slug'] }
            })
            .mockResolvedValueOnce({ id: 'sys123', slug: 'alice-2' });

        await login(mockReq, mockRes);

        // Should have called ensureUniqueSlug at least twice
        expect(ensureUniqueSlug).toHaveBeenCalledTimes(2);
        // Should have called prisma.system.create twice
        expect(prisma.system.create).toHaveBeenCalledTimes(2);
        
        expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
            token: 'mock_token'
        }));
    });

    it('should fail after 5 attempts of slug collision', async () => {
        (auth.loginToMatrix as jest.Mock).mockResolvedValue(true);
        (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue(null);
        (ensureUniqueSlug as jest.Mock).mockResolvedValue('alice');

        // Mock all 5 creation attempts to fail
        const collisionError = {
            code: 'P2002',
            meta: { target: ['slug'] }
        };
        (prisma.system.create as jest.Mock).mockRejectedValue(collisionError);

        await login(mockReq, mockRes);

        // Should have given up and returned 500
        expect(mockRes.status).toHaveBeenCalledWith(500);
        expect(prisma.system.create).toHaveBeenCalledTimes(5);
    });
});
