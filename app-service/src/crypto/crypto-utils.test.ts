import { doAsRequest, processCryptoRequests, dispatchRequest } from './crypto-utils';
import { OlmMachine, RequestType } from '@matrix-org/matrix-sdk-crypto-nodejs';
import { Intent } from 'matrix-appservice-bridge';

describe('crypto-utils', () => {
  describe('doAsRequest', () => {
    it('should throw an error if the request fails', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: jest.fn().mockResolvedValue('{"errcode":"M_UNKNOWN_TOKEN"}'),
      } as unknown as Response);

      await expect(doAsRequest('http://local', '/test', 'GET', '{}', 'token')).rejects.toThrow('Matrix API Error 401');
      expect(fetchSpy).toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('should return parsed json on success', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue('{"success":true}'),
        json: jest.fn().mockResolvedValue({ success: true }),
      } as unknown as Response);

      const res = await doAsRequest('http://local', '/test', 'GET', '{}', 'token');
      expect(res).toEqual({ success: true });
      fetchSpy.mockRestore();
    });
  });

  describe('dispatchRequest', () => {
    it('should handle SignatureUpload requests', async () => {
      const markRequestAsSentMock = jest.fn();
      const mockMachine = {
        markRequestAsSent: markRequestAsSentMock,
        deviceId: { toString: () => 'dev1' },
      } as unknown as OlmMachine;

      const mockIntent = {
        userId: '@ghost:localhost',
        matrixClient: { homeserverUrl: 'http://local' },
      } as unknown as Intent;

      const mockReq = {
        type: RequestType.SignatureUpload,
        id: 'req1',
        body: '{"signatures": {}}',
      };

      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue('{"failures": {}}'),
        json: jest.fn().mockResolvedValue({ failures: {} }),
      } as unknown as Response);

      await dispatchRequest(mockMachine, mockIntent, 'token', mockReq);
      expect(markRequestAsSentMock).toHaveBeenCalledWith('req1', RequestType.SignatureUpload, '{"failures":{}}');
      fetchSpy.mockRestore();
    });

    it('should handle KeysUpload requests', async () => {
      const markRequestAsSentMock = jest.fn();
      const mockMachine = {
        markRequestAsSent: markRequestAsSentMock,
        deviceId: { toString: () => 'dev1' },
      } as unknown as OlmMachine;

      const mockIntent = {
        userId: '@ghost:localhost',
        matrixClient: { homeserverUrl: 'http://local' },
      } as unknown as Intent;

      const mockReq = {
        type: RequestType.KeysUpload,
        id: 'req2',
        body: '{"device_keys": {}}',
      };

      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue('{"one_time_key_counts": {}}'),
        json: jest.fn().mockResolvedValue({ one_time_key_counts: {} }),
      } as unknown as Response);

      await dispatchRequest(mockMachine, mockIntent, 'token', mockReq);
      expect(markRequestAsSentMock).toHaveBeenCalledWith('req2', RequestType.KeysUpload, '{"one_time_key_counts":{}}');
      fetchSpy.mockRestore();
    });

    it('should gracefully handle M_UNKNOWN_DEVICE during KeysUpload', async () => {
      const markRequestAsSentMock = jest.fn();
      const mockMachine = {
        markRequestAsSent: markRequestAsSentMock,
        deviceId: { toString: () => 'dev1' },
      } as unknown as OlmMachine;

      const mockIntent = {
        userId: '@ghost:localhost',
        // Instead of letting registerDevice run its real logic which causes test side-effects and hangs, we mock its doRequest specifically
        matrixClient: {
          homeserverUrl: 'http://local',
          doRequest: jest.fn().mockResolvedValue({}),
        },
      } as unknown as Intent;

      const mockReq = {
        type: RequestType.KeysUpload,
        id: 'req_unknown_device',
        body: '{}',
      };

      const fetchSpy = jest
        .spyOn(global, 'fetch')
        // 1. Initial KeysUpload fails with M_UNKNOWN_DEVICE
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          text: jest.fn().mockResolvedValue('{"errcode": "M_UNKNOWN_DEVICE"}'),
        } as unknown as Response)
        // 2. The retry upload succeeds (registerDevice doesn't use global.fetch directly, it uses intent.matrixClient.doRequest)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: jest.fn().mockResolvedValue('{"one_time_key_counts": {"signed_curve25519": 50}}'),
          json: jest.fn().mockResolvedValue({ one_time_key_counts: { signed_curve25519: 50 } }),
        } as unknown as Response);

      await dispatchRequest(mockMachine, mockIntent, 'token', mockReq);
      expect(markRequestAsSentMock).toHaveBeenCalledWith(
        'req_unknown_device',
        RequestType.KeysUpload,
        '{"one_time_key_counts":{"signed_curve25519":50}}',
      );
      fetchSpy.mockRestore();
    });

    it('should handle KeysQuery requests', async () => {
      const markRequestAsSentMock = jest.fn();
      const mockMachine = {
        markRequestAsSent: markRequestAsSentMock,
        deviceId: { toString: () => 'dev1' },
      } as unknown as OlmMachine;

      const mockIntent = {
        userId: '@ghost:localhost',
        matrixClient: { homeserverUrl: 'http://local' },
      } as unknown as Intent;

      const mockReq = {
        type: RequestType.KeysQuery,
        id: 'req3',
        body: '{"device_keys": {}}',
      };

      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue('{"device_keys": {}}'),
        json: jest.fn().mockResolvedValue({ device_keys: {} }),
      } as unknown as Response);

      await dispatchRequest(mockMachine, mockIntent, 'token', mockReq);
      expect(markRequestAsSentMock).toHaveBeenCalledWith('req3', RequestType.KeysQuery, '{"device_keys":{}}');
      fetchSpy.mockRestore();
    });
  });

  describe('processCryptoRequests', () => {
    it('should iterate outgoing requests and dispatch them', async () => {
      const outgoingRequestsMock = jest
        .fn()
        .mockResolvedValueOnce([{ type: RequestType.KeysQuery, id: 'req1' }])
        .mockResolvedValueOnce([]); // Return empty second time to break the while loop
      const markRequestAsSentMock = jest.fn();

      const mockMachine = {
        deviceId: { toString: () => 'dev1' },
        outgoingRequests: outgoingRequestsMock,
        markRequestAsSent: markRequestAsSentMock,
      } as unknown as OlmMachine;

      const mockIntent = {
        userId: '@ghost:localhost',
        matrixClient: { homeserverUrl: 'http://local' },
      } as unknown as Intent;

      // Mock fetch so dispatchRequest succeeds
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue('{}'),
        json: jest.fn().mockResolvedValue({}),
      } as unknown as Response);

      await processCryptoRequests(mockMachine, mockIntent, 'token');
      expect(outgoingRequestsMock).toHaveBeenCalled();
      expect(markRequestAsSentMock).toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });
});
