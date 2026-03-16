import { OlmMachineManager } from './OlmMachineManager';
import * as fs from 'fs';
import { OlmMachine } from '@matrix-org/matrix-sdk-crypto-nodejs';
import { bootstrapCrossSigning } from './CrossSigningBootstrapper';
import { Intent } from 'matrix-appservice-bridge';

jest.mock('fs');
jest.mock('@matrix-org/matrix-sdk-crypto-nodejs', () => ({
  OlmMachine: {
    initialize: jest.fn(),
  },
  UserId: jest.fn().mockImplementation((id: string) => id),
  DeviceId: jest.fn().mockImplementation((id: string) => id),
}));
jest.mock('./CrossSigningBootstrapper', () => ({
  bootstrapCrossSigning: jest.fn(),
}));

describe('OlmMachineManager', () => {
  let manager: OlmMachineManager;

  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue('FAKE_DEVICE');
    manager = new OlmMachineManager('./mock-storage');
  });

  it('should initialize and cache a new machine', async () => {
    const mockMachine = {
      identityKeys: { curve25519: { toBase64: () => 'fake_key' } },
      deviceId: { toString: () => 'FAKE_DEVICE' },
    };
    const initializeMock = jest.spyOn(OlmMachine, 'initialize') as jest.Mock;
    initializeMock.mockResolvedValue(mockMachine);

    const mockIntent = {
      matrixClient: {
        doRequest: jest.fn().mockResolvedValue({}),
      },
    } as unknown as Intent;

    manager.setContext({ getIntent: jest.fn().mockReturnValue(mockIntent) }, 'fake-token');

    const machine = await manager.getMachine('@alice:localhost');

    expect(initializeMock).toHaveBeenCalled();
    expect(bootstrapCrossSigning).toHaveBeenCalled();
    expect(machine).toBe(mockMachine);

    // Second call should return cached machine without re-initializing
    const cachedMachine = await manager.getMachine('@alice:localhost');
    expect(cachedMachine).toBe(mockMachine);
    expect(initializeMock).toHaveBeenCalledTimes(1);
  });

  it('should create storage directory if it does not exist', () => {
    const existsSyncMock = jest.spyOn(fs, 'existsSync') as jest.Mock;
    existsSyncMock.mockReturnValue(false);
    new OlmMachineManager('./new-storage');
    expect(fs.mkdirSync).toHaveBeenCalledWith('./new-storage', { recursive: true });
  });

  it('should gracefully handle initialization failure', async () => {
    const initializeMock = jest.spyOn(OlmMachine, 'initialize') as jest.Mock;
    initializeMock.mockRejectedValue(new Error('Failed'));
    await expect(manager.getMachine('@alice:localhost')).rejects.toThrow('Failed');
  });
});
