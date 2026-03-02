import express from 'express';
import request from 'supertest';
import bodyParser from 'body-parser';

// Store original env
const originalEnv = process.env;

describe('Media Controller', () => {
    let fetchMock: jest.Mock;
    let app: express.Express;

    beforeEach(() => {
        jest.resetModules(); // Clear cache so controller re-evaluates process.env
        process.env = { ...originalEnv, AS_TOKEN: 'test_token', PROJECT_NAME: 'test', SYNAPSE_URL: 'http://test-synapse:8008' }; 
        
        // Mock global fetch
        fetchMock = jest.fn();
        global.fetch = fetchMock;

        // Re-require the controller after env is set
        const { uploadMedia, downloadMedia } = require('./mediaController');
        
        app = express();
        app.post('/upload', express.raw({ type: 'image/*', limit: '2mb' }), uploadMedia);
        app.get('/download/:server/:mediaId', downloadMedia);
    });

    afterAll(() => {
        process.env = originalEnv;
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
            let isolatedApp: any;
            jest.isolateModules(() => {
                delete process.env.AS_TOKEN;
                const { uploadMedia: isolatedUpload } = require('./mediaController');
                isolatedApp = express();
                isolatedApp.post('/up', express.raw({ type: 'image/*' }), isolatedUpload);
            });
            
            const response = await request(isolatedApp)
                .post('/up?filename=test.png')
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
        
        it('should fail if filename is missing (Zod validation)', async () => {
            const response = await request(app)
                .post('/upload')
                .set('Content-Type', 'image/png')
                .send(Buffer.from('data'));

            expect(response.status).toBe(500); // Controller catches ZodError and returns 500 currently
            expect(response.body.error).toBe('Internal server error');
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

        it('should handle internal errors gracefully', async () => {
            fetchMock.mockRejectedValue(new Error('Network failure'));

            const response = await request(app)
                .get('/download/localhost/error');

            expect(response.status).toBe(500);
        });
        
        it('should fail if AS_TOKEN is missing', async () => {
            let isolatedApp: any;
            jest.isolateModules(() => {
                delete process.env.AS_TOKEN;
                const { downloadMedia: isolatedDownload } = require('./mediaController');
                isolatedApp = express();
                isolatedApp.get('/dl/:server/:id', isolatedDownload);
            });
            
            const response = await request(isolatedApp)
                .get('/dl/localhost/123');
                
            expect(response.status).toBe(500);
        });
    });
});
