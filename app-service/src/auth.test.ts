import { loginToMatrix, generateToken } from './auth';
import jwt from 'jsonwebtoken';

describe('Authentication Engine', () => {
    const JWT_SECRET = 'test_jwt_secret';

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('loginToMatrix', () => {
        it('should return true on successful login', async () => {
            // Mock successful fetch
            global.fetch = jest.fn().mockImplementation(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ access_token: 'valid_token' }),
                })
            );

            const result = await loginToMatrix('@user:localhost', 'password');
            expect(result).toBe(true);
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/_matrix/client/v3/login'),
                expect.objectContaining({
                    method: 'POST',
                    body: expect.stringContaining('"user":"@user:localhost"')
                })
            );
        });

        it('should return false on failed login', async () => {
            // Mock failed fetch
            global.fetch = jest.fn().mockImplementation(() =>
                Promise.resolve({
                    ok: false,
                    json: () => Promise.resolve({ error: 'M_FORBIDDEN' }),
                })
            );

            const result = await loginToMatrix('@user:localhost', 'wrong_password');
            expect(result).toBe(false);
        });

        it('should perform .well-known discovery for federated accounts', async () => {
            // Mock fetch to simulate the .well-known resolution and subsequent login
            global.fetch = jest.fn().mockImplementation((url: string) => {
                if (url === 'https://remote.org/.well-known/matrix/client') {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ 'm.homeserver': { base_url: 'https://matrix.remote.org' } }),
                    });
                }
                if (url === 'https://matrix.remote.org/_matrix/client/v3/login') {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ access_token: 'valid_remote_token' }),
                    });
                }
                return Promise.reject(new Error(`Unexpected URL: ${url}`));
            });

            const result = await loginToMatrix('@chiara:remote.org', 'password');
            expect(result).toBe(true);
            
            expect(global.fetch).toHaveBeenCalledWith('https://remote.org/.well-known/matrix/client');
            expect(global.fetch).toHaveBeenCalledWith(
                'https://matrix.remote.org/_matrix/client/v3/login',
                expect.objectContaining({
                    method: 'POST',
                    body: expect.stringContaining('"user":"@chiara:remote.org"')
                })
            );
        });

        it('should fallback to base domain if .well-known fails', async () => {
            global.fetch = jest.fn().mockImplementation((url: string) => {
                if (url.includes('.well-known')) {
                    return Promise.resolve({ ok: false });
                }
                if (url === 'https://noconfig.com/_matrix/client/v3/login') {
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
                }
                return Promise.reject(new Error(`Unexpected URL: ${url}`));
            });

            const result = await loginToMatrix('@user:noconfig.com', 'pass');
            expect(result).toBe(true);
            expect(global.fetch).toHaveBeenCalledWith('https://noconfig.com/_matrix/client/v3/login', expect.any(Object));
        });
    });

    describe('generateToken', () => {
        it('should generate a valid JWT with mxid', () => {
            const mxid = '@chiara:localhost';
            const token = generateToken(mxid);
            expect(token).toBeDefined();

            const decoded = jwt.verify(token, JWT_SECRET) as any;
            expect(decoded.mxid).toBe(mxid);
        });

        it('should handle localparts by converting to full MXID', () => {
            const localpart = 'chiara';
            const token = generateToken(localpart);
            const decoded = jwt.verify(token, JWT_SECRET) as any;
            expect(decoded.mxid).toBe('@chiara:localhost');
        });
    });
});
