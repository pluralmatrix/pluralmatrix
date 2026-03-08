import { buildWebUrl } from './url';
import { config } from '../config';

describe('buildWebUrl', () => {
    const originalUrl = config.publicWebUrl;

    afterEach(() => {
        config.publicWebUrl = originalUrl;
    });

    it('should combine base url and path without double slashes', () => {
        config.publicWebUrl = 'http://localhost:9000/';
        expect(buildWebUrl('/s/my-system')).toBe('http://localhost:9000/s/my-system');
        expect(buildWebUrl('s/my-system')).toBe('http://localhost:9000/s/my-system');
    });

    it('should handle base url without trailing slash', () => {
        config.publicWebUrl = 'http://localhost:9000';
        expect(buildWebUrl('/s/my-system')).toBe('http://localhost:9000/s/my-system');
        expect(buildWebUrl('s/my-system')).toBe('http://localhost:9000/s/my-system');
    });

    it('should return just the base url if no path is provided', () => {
        config.publicWebUrl = 'http://localhost:9000/';
        expect(buildWebUrl()).toBe('http://localhost:9000');
        
        config.publicWebUrl = 'http://localhost:9000';
        expect(buildWebUrl()).toBe('http://localhost:9000');
    });
});