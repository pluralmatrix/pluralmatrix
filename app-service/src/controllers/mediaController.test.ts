import express from 'express';
import request from 'supertest';
import { config } from '../config';

// Create a stable mock config object that we can modify
const mockConfig = {
    projectName: 'test',
    synapseUrl: 'http://test-synapse:8008',
    asToken: 'test_token',
    appPort: 9000,
    synapseDomain: 'localhost',
    cacheTtlSeconds: 300,
    cryptoDeviceId: 'PLURAL_CTX_V10',
    rustHelperPath: '/usr/local/bin/rust-crypto-helper',
    jwtSecret: 'test_jwt_secret',
    gatekeeperSecret: 'test_gatekeeper_secret',
    databaseUrl: 'postgresql://...'
};

// Mock config module to return our stable object
jest.mock('../config', () => ({
    config: mockConfig,
    validateConfig: jest.fn()
}));

describe('Media Controller', () => {
    let fetchMock: jest.Mock;
    let app: express.Express;

    beforeEach(() => {
        // Reset properties to default for each test
        mockConfig.asToken = 'test_token';
        mockConfig.synapseUrl = 'http://test-synapse:8008';

        // Mock global fetch
        fetchMock = jest.fn();
        global.fetch = fetchMock;

        // Re-require the controller to ensure it uses the mock
        const { uploadMedia, downloadMedia } = require('./mediaController');
        
        app = express();
        app.post('/upload', express.raw({ type: 'image/*', limit: '2mb' }), uploadMedia);
        app.get('/download/:server/:mediaId', downloadMedia);
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    describe('POST /upload', () => {
        it('should accept valid images and proxy to Synapse', async () => {
            fetchMock.mockResolvedValue({
                ok: true,
                json: async () => ({ content_uri: 'mxc://localhost/12345' })
            });

            const response = await request(app)
                .post('/upload?filename=avatar.png')
                .set('Content-Type', 'image/png')
                .send(Buffer.from('fake_image_data'));

            expect(response.status).toBe(200);
            expect(response.body).toEqual({ content_uri: 'mxc://localhost/12345' });
            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining('_matrix/media/v3/upload?filename=avatar.png'),
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'Authorization': 'Bearer test_token',
                        'Content-Type': 'image/png'
                    })
                })
            );
        });

        it('should reject invalid image formats', async () => {
            const response = await request(app)
                .post('/upload?filename=avatar.gif')
                .set('Content-Type', 'image/gif')
                .send(Buffer.from('fake_gif_data'));

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('must be in .jpg, .png, or .webp');
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('should reject files larger than 1MB', async () => {
            const oversizedBuffer = Buffer.alloc(1025 * 1024); // 1025 KB

            const response = await request(app)
                .post('/upload?filename=large.png')
                .set('Content-Type', 'image/png')
                .send(oversizedBuffer);

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('under 1024 KB');
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('should fail if AS_TOKEN is missing', async () => {
            // Modify config for this test only
            mockConfig.asToken = '';
            
            // Still mock fetch just in case it doesn't return early
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

            const response = await request(app)
                .post('/upload?filename=test.png')
                .set('Content-Type', 'image/png')
                .send(Buffer.from('data'));
                
            expect(response.status).toBe(500);
            expect(response.body.error).toBe('AS_TOKEN is not configured');
        });

        it('should pass through Synapse API errors', async () => {
            fetchMock.mockResolvedValue({
                ok: false,
                status: 429,
                json: async () => ({ errcode: 'M_LIMIT_EXCEEDED', error: 'Too many requests' })
            });

            const response = await request(app)
                .post('/upload?filename=test.png')
                .set('Content-Type', 'image/png')
                .send(Buffer.from('data'));

            expect(response.status).toBe(429);
            expect(response.body.errcode).toBe('M_LIMIT_EXCEEDED');
        });
    });

    describe('GET /download/:server/:mediaId', () => {
        it('should proxy successful downloads', async () => {
            fetchMock.mockResolvedValue({
                ok: true,
                headers: new Map([['content-type', 'image/webp']]),
                arrayBuffer: async () => new Uint8Array(Buffer.from('image_bytes')).buffer
            });

            const response = await request(app)
                .get('/download/localhost/abcdef');

            expect(response.status).toBe(200);
            expect(response.headers['content-type']).toBe('image/webp');
            expect(response.body).toEqual(Buffer.from('image_bytes'));
            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining('/_matrix/client/v1/media/download/localhost/abcdef'),
                expect.objectContaining({
                    headers: { 'Authorization': 'Bearer test_token' }
                })
            );
        });

        it('should proxy Synapse error statuses', async () => {
            fetchMock.mockResolvedValue({
                ok: false,
                status: 404
            });

            const response = await request(app)
                .get('/download/localhost/notfound');

            expect(response.status).toBe(404);
        });

        it('should fail if AS_TOKEN is missing during download', async () => {
            mockConfig.asToken = '';
            
            const response = await request(app)
                .get('/download/localhost/123');
                
            expect(response.status).toBe(500);
        });
    });
});
