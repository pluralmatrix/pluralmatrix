import { maskMxid } from './privacy';

describe('maskMxid', () => {
    it('should mask a standard MXID', () => {
        expect(maskMxid('@alice:example.com')).toBe('@ali...:example.com');
    });

    it('should mask an MXID with a port number', () => {
        expect(maskMxid('@alice:example.com:8448')).toBe('@ali...:example.com:8448');
    });

    it('should handle very short localparts', () => {
        expect(maskMxid('@a:example.com')).toBe('@a:example.com');
    });

    it('should handle null/undefined', () => {
        expect(maskMxid(null)).toBe('unknown');
        expect(maskMxid(undefined)).toBe('unknown');
    });

    it('should handle malformed strings', () => {
        expect(maskMxid('not-an-mxid')).toBe('not-an-mxid');
    });
});
