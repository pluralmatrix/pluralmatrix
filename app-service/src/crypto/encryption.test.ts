import { sendEncryptedEvent } from "./encryption";
import { OlmMachineManager } from "./OlmMachineManager";

// Mock dependencies
const mockIntent = {
    userId: "@ghost:localhost",
    matrixClient: {
        getRoomStateEvent: jest.fn(),
        getJoinedRoomMembers: jest.fn(),
        homeserverUrl: "http://localhost:8008",
        doRequest: jest.fn().mockResolvedValue({})
    },
    sendEvent: jest.fn()
};

const mockMachine = {
    deviceId: { toString: () => "MOCK_DEVICE" },
    encryptRoomEvent: jest.fn(),
    updateTrackedUsers: jest.fn().mockResolvedValue(undefined),
    receiveSyncChanges: jest.fn().mockResolvedValue(undefined),
    shareRoomKey: jest.fn().mockResolvedValue([]),
    getMissingSessions: jest.fn().mockResolvedValue(null),
    outgoingRequests: jest.fn().mockResolvedValue([])
};

const mockManager = {
    getMachine: jest.fn().mockResolvedValue(mockMachine)
};

// Mock matrix-sdk-crypto-nodejs
jest.mock("@matrix-org/matrix-sdk-crypto-nodejs", () => {
    return {
        RoomId: jest.fn().mockImplementation((id) => id),
        UserId: jest.fn().mockImplementation((id) => id),
        EncryptionSettings: jest.fn().mockImplementation(() => ({})),
        DeviceLists: jest.fn().mockImplementation(() => ({}))
    };
});

describe("sendEncryptedEvent", () => {
    const roomId = "!room:localhost";
    const ghostId = "@ghost:localhost";
    const asToken = "mock_as_token";

    // Increase timeout for this file as encryption ops can be slow
    jest.setTimeout(10000);

    beforeEach(() => {
        jest.clearAllMocks();
        mockIntent.userId = ghostId;
        mockManager.getMachine.mockResolvedValue(mockMachine);
    });

    it("should send plaintext if room is not encrypted (404 on state event)", async () => {
        mockIntent.matrixClient.getRoomStateEvent.mockRejectedValue(new Error("Not found"));

        await sendEncryptedEvent(mockIntent as any, roomId, "m.room.message", { body: "hello" }, mockManager as any, asToken);

        expect(mockIntent.sendEvent).toHaveBeenCalledWith(roomId, "m.room.message", { body: "hello" });
        expect(mockManager.getMachine).not.toHaveBeenCalled();
    });

    it("should send plaintext if room encryption event exists but algorithm is not megolm", async () => {
        mockIntent.matrixClient.getRoomStateEvent.mockResolvedValue({ algorithm: "other" });

        await sendEncryptedEvent(mockIntent as any, roomId, "m.room.message", { body: "hello" }, mockManager as any, asToken);

        expect(mockIntent.sendEvent).toHaveBeenCalledWith(roomId, "m.room.message", { body: "hello" });
        expect(mockManager.getMachine).not.toHaveBeenCalled();
    });

    it("should encrypt and send if room is encrypted", async () => {
        mockIntent.matrixClient.getRoomStateEvent.mockResolvedValue({ algorithm: "m.megolm.v1.aes-sha2" });
        mockIntent.matrixClient.getJoinedRoomMembers.mockResolvedValue([ghostId, "@alice:localhost"]);
        
        const encryptedContent = {
            algorithm: "m.megolm.v1.aes-sha2",
            ciphertext: "s3cr3t"
        };
        mockMachine.encryptRoomEvent.mockResolvedValue(JSON.stringify(encryptedContent));

        await sendEncryptedEvent(mockIntent as any, roomId, "m.room.message", { body: "hello" }, mockManager as any, asToken);

        expect(mockManager.getMachine).toHaveBeenCalledWith(ghostId);
        expect(mockMachine.updateTrackedUsers).toHaveBeenCalled();
        expect(mockMachine.encryptRoomEvent).toHaveBeenCalled();
        expect(mockIntent.sendEvent).toHaveBeenCalledWith(roomId, "m.room.encrypted", expect.objectContaining({
            algorithm: "m.megolm.v1.aes-sha2",
            ciphertext: "s3cr3t"
        }));
    });
});
