import { Request, Response, NextFunction } from 'express';
import { config } from './config';

// Create a stable mock config object
const mockConfig = {
    gatekeeperSecret: 'test_gatekeeper_secret',
    jwtSecret: 'test_jwt_secret',
    synapseDomain: 'localhost',
    synapseUrl: 'http://localhost:8008'
};

// Mock config module BEFORE importing auth
jest.mock('./config', () => ({
    config: mockConfig
}));

// Now import auth
import { authenticateGatekeeper } from './auth';

describe('authenticateGatekeeper Middleware', () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let nextFunction: NextFunction = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        mockReq = {
            headers: {},
            ip: '127.0.0.1'
        };
        mockRes = {
            sendStatus: jest.fn(),
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        mockConfig.gatekeeperSecret = 'test_gatekeeper_secret';
    });

    it('should allow request with correct Bearer token', () => {
        mockReq.headers!['authorization'] = 'Bearer test_gatekeeper_secret';

        authenticateGatekeeper(mockReq as Request, mockRes as Response, nextFunction);

        expect(nextFunction).toHaveBeenCalled();
        expect(mockRes.sendStatus).not.toHaveBeenCalled();
    });

    it('should reject request with incorrect Bearer token', () => {
        mockReq.headers!['authorization'] = 'Bearer wrong_secret';

        authenticateGatekeeper(mockReq as Request, mockRes as Response, nextFunction);

        expect(nextFunction).not.toHaveBeenCalled();
        expect(mockRes.sendStatus).toHaveBeenCalledWith(401);
    });

    it('should reject request with no Authorization header', () => {
        authenticateGatekeeper(mockReq as Request, mockRes as Response, nextFunction);

        expect(nextFunction).not.toHaveBeenCalled();
        expect(mockRes.sendStatus).toHaveBeenCalledWith(401);
    });

    it('should reject request with malformed Authorization header', () => {
        mockReq.headers!['authorization'] = 'Basic some_creds';

        authenticateGatekeeper(mockReq as Request, mockRes as Response, nextFunction);

        expect(nextFunction).not.toHaveBeenCalled();
        expect(mockRes.sendStatus).toHaveBeenCalledWith(401);
    });

    it('should return 500 if GATEKEEPER_SECRET is not configured', () => {
        // We use cast to any to allow clearing it for the test
        (mockConfig as any).gatekeeperSecret = '';

        authenticateGatekeeper(mockReq as Request, mockRes as Response, nextFunction);

        expect(nextFunction).not.toHaveBeenCalled();
        expect(mockRes.status).toHaveBeenCalledWith(500);
        expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal server configuration error' });
    });
});
