import { registerDevice, clearRegisteredDevicesCache } from './crypto-utils';
import { Intent } from 'matrix-appservice-bridge';

describe('Crypto Device Registration Persistence', () => {
    let mockIntent: any;
    let mockPrisma: any;

    beforeEach(() => {
        jest.clearAllMocks();
        clearRegisteredDevicesCache();
        
        mockIntent = {
            userId: '@alice:localhost',
            matrixClient: {
                doRequest: jest.fn().mockResolvedValue({})
            }
        };

        mockPrisma = {
            member: {
                findUnique: jest.fn(),
                update: jest.fn()
            }
        };
    });

    it('should call Matrix API and update DB if not registered', async () => {
        // Mock DB: Not registered
        mockPrisma.member.findUnique.mockResolvedValue({ deviceRegistered: false });
        mockPrisma.member.update.mockResolvedValue({});

        const newlyRegistered = await registerDevice(mockIntent as Intent, 'DEV1', mockPrisma, 'm1');

        expect(newlyRegistered).toBe(true);
        expect(mockIntent.matrixClient.doRequest).toHaveBeenCalledWith('POST', expect.any(String), null, expect.objectContaining({
            device_id: 'DEV1'
        }));
        expect(mockPrisma.member.update).toHaveBeenCalledWith({
            where: { id: 'm1' },
            data: { deviceRegistered: true }
        });
    });

    it('should skip Matrix API if already registered in DB', async () => {
        // Mock DB: ALREADY registered
        mockPrisma.member.findUnique.mockResolvedValue({ deviceRegistered: true });

        const newlyRegistered = await registerDevice(mockIntent as Intent, 'DEV1', mockPrisma, 'm1');

        expect(newlyRegistered).toBe(false);
        expect(mockIntent.matrixClient.doRequest).not.toHaveBeenCalled();
        expect(mockPrisma.member.update).not.toHaveBeenCalled();
    });

    it('should consider user registered if Matrix returns "already exists"', async () => {
        mockPrisma.member.findUnique.mockResolvedValue({ deviceRegistered: false });
        
        // Mock Matrix returning error object
        const error: any = new Error('Request failed');
        error.errcode = 'M_USER_IN_USE';
        error.body = 'User ID already taken';
        mockIntent.matrixClient.doRequest.mockRejectedValue(error);

        const newlyRegistered = await registerDevice(mockIntent as Intent, 'DEV1', mockPrisma, 'm1');

        expect(newlyRegistered).toBe(true);
        expect(mockPrisma.member.update).toHaveBeenCalledWith({
            where: { id: 'm1' },
            data: { deviceRegistered: true }
        });
    });

    it('should handle System (Bot) registration persistence', async () => {
        mockPrisma.system = {
            findUnique: jest.fn().mockResolvedValue({ deviceRegistered: false }),
            update: jest.fn().mockResolvedValue({})
        };

        const newlyRegistered = await registerDevice(mockIntent as Intent, 'BOT_DEV', mockPrisma, undefined, 'sys1');

        expect(newlyRegistered).toBe(true);
        expect(mockPrisma.system.findUnique).toHaveBeenCalledWith({
            where: { id: 'sys1' },
            select: { deviceRegistered: true }
        });
        expect(mockPrisma.system.update).toHaveBeenCalledWith({
            where: { id: 'sys1' },
            data: { deviceRegistered: true }
        });
    });
});
