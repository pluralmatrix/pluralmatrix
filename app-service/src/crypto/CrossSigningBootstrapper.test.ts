import { bootstrapCrossSigning } from './CrossSigningBootstrapper';
import * as fs from 'fs';
import { Intent } from 'matrix-appservice-bridge';

jest.mock('util', () => {
    const mockFn = jest.fn();
    return {
        promisify: () => mockFn,
        _mockExecFileAsync: mockFn // Expose it for tests to configure
    };
});

jest.mock('fs', () => ({
    existsSync: jest.fn()
}));

const { _mockExecFileAsync } = require('util');

describe('CrossSigningBootstrapper', () => {
    let fetchMock: jest.Mock;
    let mockIntent: any;

    beforeEach(() => {
        jest.clearAllMocks();
        
        fetchMock = jest.fn();
        global.fetch = fetchMock;

        mockIntent = {
            matrixClient: {
                homeserverUrl: 'http://test-server:8008'
            }
        };

        // Suppress console logs during tests to keep output clean
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should return null if the sqlite database already exists', async () => {
        // Simulate DB existing
        (fs.existsSync as jest.Mock).mockReturnValue(true);

        const result = await bootstrapCrossSigning(
            '@ghost:localhost', 
            'DEV_123', 
            '/fake/store/path', 
            mockIntent as Intent, 
            'as_token_123'
        );

        expect(result).toBeNull();
        expect(_mockExecFileAsync).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should execute sidecar, format payloads correctly, and proxy to Synapse', async () => {
        // Simulate DB NOT existing
        (fs.existsSync as jest.Mock).mockReturnValue(false);

        // Mock the stdout from the rust-crypto-helper sidecar
        const mockSidecarOutput = {
            upload_keys_id: "req_keys_1",
            upload_keys: {
                master_key: { keys: { "ed25519:master": "key_data" } },
                self_signing_key: { keys: { "ed25519:self": "key_data" } },
                user_signing_key: { keys: { "ed25519:user": "key_data" } }
            },
            upload_signatures_id: "req_sig_1",
            upload_signatures: {
                "@ghost:localhost": {
                    "DEV_123": { signatures: { "@ghost:localhost": { "ed25519:master": "sig" } } }
                }
            }
        };

        _mockExecFileAsync.mockResolvedValue({ stdout: JSON.stringify(mockSidecarOutput), stderr: '' });

        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ success: true })
        });

        const result = await bootstrapCrossSigning(
            '@ghost:localhost', 
            'DEV_123', 
            '/fake/store/path', 
            mockIntent as Intent, 
            'as_token_123'
        );

        // Assert Sidecar Execution
        expect(_mockExecFileAsync).toHaveBeenCalledWith(
            expect.any(String), // The path to the helper
            ['@ghost:localhost', 'DEV_123', '/fake/store/path']
        );

        // Assert HTTP Requests
        expect(fetchMock).toHaveBeenCalledTimes(2);

        // 1. Device Signing Upload Check
        const keysCallUrl = new URL(fetchMock.mock.calls[0][0]);
        const keysCallArgs = fetchMock.mock.calls[0][1];
        
        expect(keysCallUrl.pathname).toBe('/_matrix/client/v3/keys/device_signing/upload');
        expect(keysCallUrl.searchParams.get('user_id')).toBe('@ghost:localhost');
        expect(keysCallArgs.method).toBe('POST');
        expect(keysCallArgs.headers['Authorization']).toBe('Bearer as_token_123');
        
        const keysBody = JSON.parse(keysCallArgs.body);
        expect(keysBody.auth).toEqual({ type: 'm.login.dummy' }); // Ensure UIA is bypassed via AS token
        expect(keysBody.master_key).toBeDefined();

        // 2. Signatures Upload Check
        const sigCallUrl = new URL(fetchMock.mock.calls[1][0]);
        const sigCallArgs = fetchMock.mock.calls[1][1];
        
        expect(sigCallUrl.pathname).toBe('/_matrix/client/v3/keys/signatures/upload');
        expect(sigCallUrl.searchParams.get('user_id')).toBe('@ghost:localhost');
        expect(sigCallArgs.method).toBe('POST');
        
        const sigBody = JSON.parse(sigCallArgs.body);
        expect(sigBody["@ghost:localhost"]).toBeDefined();

        // Assert Return Value
        expect(result).toEqual({
            keysRequestId: 'req_keys_1',
            keysResponse: { success: true },
            signaturesRequestId: 'req_sig_1',
            signaturesResponse: { success: true }
        });
    });

    it('should throw an error if the Matrix API rejects the upload', async () => {
        (fs.existsSync as jest.Mock).mockReturnValue(false);
        _mockExecFileAsync.mockResolvedValue({ stdout: JSON.stringify({ upload_keys: {}, upload_signatures: {} }), stderr: '' });

        // Mock Synapse rejecting the request
        fetchMock.mockResolvedValue({
            ok: false,
            status: 400,
            text: async () => '{"error": "Invalid payload"}'
        });

        await expect(
            bootstrapCrossSigning('@ghost:localhost', 'DEV_1', '/path', mockIntent as Intent, 'token')
        ).rejects.toThrow(/Matrix API Error 400/);
    });

    it('should throw an error if the Rust sidecar crashes', async () => {
        (fs.existsSync as jest.Mock).mockReturnValue(false);
        
        _mockExecFileAsync.mockRejectedValue(new Error("Sidecar panic"));

        await expect(
            bootstrapCrossSigning('@ghost:localhost', 'DEV_1', '/path', mockIntent as Intent, 'token')
        ).rejects.toThrow(/Sidecar panic/);
        
        expect(fetchMock).not.toHaveBeenCalled();
    });
});


