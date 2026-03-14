import { doAsRequest, registerDevice } from './crypto-utils';
import * as timer from '../utils/timer';
import { Intent } from 'matrix-appservice-bridge';

// Mock the timer module
jest.mock('../utils/timer', () => ({
    sleep: jest.fn().mockResolvedValue(undefined)
}));

describe('Crypto Resilience Utilities', () => {
    const hsUrl = "http://localhost:8008";
    const asToken = "mock_token";
    const userId = "@alice:localhost";

    beforeEach(() => {
        jest.clearAllMocks();
        // Mock global fetch
        global.fetch = jest.fn();
    });

    describe('doAsRequest', () => {
        it('should retry on 429 rate limits and eventually succeed', async () => {
            const mockFetch = global.fetch as jest.Mock;
            
            // 1st call: 429
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 429,
                text: () => Promise.resolve('{"errcode": "M_LIMIT_EXCEEDED"}')
            });
            
            // 2nd call: 200 Success
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ success: true })
            });

            const result = await doAsRequest(hsUrl, asToken, userId, "POST", "/test", { foo: "bar" }) as { success: boolean };
            
            expect(result.success).toBe(true);
            expect(mockFetch).toHaveBeenCalledTimes(2);
            expect(timer.sleep).toHaveBeenCalled();
        });

        it('should eventually fail after max attempts', async () => {
            const mockFetch = global.fetch as jest.Mock;
            
            // Return 429 every time
            mockFetch.mockResolvedValue({
                ok: false,
                status: 429,
                text: () => Promise.resolve('{"errcode": "M_LIMIT_EXCEEDED"}')
            });

            await expect(doAsRequest(hsUrl, asToken, userId, "POST", "/test", {}))
                .rejects.toThrow(/Max attempts reached/);
            
            expect(mockFetch).toHaveBeenCalledTimes(5);
        });
    });

    describe('registerDevice', () => {
        const mockIntent = {
            userId: userId,
            matrixClient: {
                doRequest: jest.fn()
            }
        };

        it('should retry device registration on rate limit', async () => {
            const mockDoRequest = mockIntent.matrixClient.doRequest;

            mockDoRequest.mockRejectedValueOnce(new Error('M_LIMIT_EXCEEDED'));
            mockDoRequest.mockResolvedValueOnce({});

            const result = await registerDevice(mockIntent as unknown as Intent, "NEW_DEVICE");
            
            expect(result).toBe(true);
            expect(mockDoRequest).toHaveBeenCalledTimes(2);
            expect(timer.sleep).toHaveBeenCalled();
        });

        it('should respect the concurrency semaphore without OOMing', async () => {
            const mockDoRequest = mockIntent.matrixClient.doRequest;
            
            // To avoid infinite loops in the test, we mock sleep to actually pause execution briefly
            (timer.sleep as jest.Mock).mockImplementation(() => new Promise(r => setTimeout(r, 10)));
            
            // Fast mock response
            mockDoRequest.mockResolvedValue({});

            // Fire off 5 registrations (Semaphore limit is 1)
            const results = await Promise.all([
                registerDevice(mockIntent as unknown as Intent, "DEV1"),
                registerDevice(mockIntent as unknown as Intent, "DEV2"),
                registerDevice(mockIntent as unknown as Intent, "DEV3"),
                registerDevice(mockIntent as unknown as Intent, "DEV4"),
                registerDevice(mockIntent as unknown as Intent, "DEV5")
            ]);

            expect(results.every(r => r === true)).toBe(true);
            expect(mockDoRequest).toHaveBeenCalledTimes(5);
        });
    });
});
