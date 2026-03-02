import { validateImageBuffer } from './import';

jest.mock('image-size', () => {
    return jest.fn().mockImplementation((buffer: Buffer) => {
        // We use the buffer's first byte to determine the mock's behavior for testing
        const typeByte = buffer[0];
        
        if (typeByte === 0) return { type: 'jpg', width: 500, height: 500 }; // Valid
        if (typeByte === 1) return { type: 'gif', width: 500, height: 500 }; // Invalid format
        if (typeByte === 2) return { type: 'png', width: 1200, height: 1200 }; // Invalid: Smallest axis > 1000
        if (typeByte === 3) return { type: 'webp', width: 500, height: 4500 }; // Invalid: Largest axis > 4000
        if (typeByte === 4) return { type: 'png', width: 500, height: 1200 }; // Valid: Smallest < 1000, Largest < 4000
        
        throw new TypeError('Invalid image format');
    });
});

describe('Backend Image Validation (validateImageBuffer)', () => {
    const createMockBuffer = (typeByte: number, sizeInBytes: number = 1024) => {
        const buffer = Buffer.alloc(sizeInBytes);
        buffer[0] = typeByte;
        return buffer;
    };

    it('should accept valid images (under 1MB, correct format, valid dimensions)', () => {
        const result = validateImageBuffer(createMockBuffer(0, 500 * 1024), 'test.jpg');
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
    });

    it('should reject images over 1MB', () => {
        const result = validateImageBuffer(createMockBuffer(0, 1.5 * 1024 * 1024), 'test.jpg');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Image too large');
        expect(result.error).toContain('Must be under 1024 KB');
    });

    it('should reject invalid formats (e.g. GIFs)', () => {
        const result = validateImageBuffer(createMockBuffer(1), 'test.gif');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid format');
        expect(result.error).toContain('gif');
    });

    it('should reject images where the smallest axis is >= 1000px', () => {
        const result = validateImageBuffer(createMockBuffer(2), 'test.png');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Resolution too high');
        expect(result.error).toContain('Smallest axis must be below 1000px');
    });

    it('should reject images where the largest axis is > 4000px', () => {
        const result = validateImageBuffer(createMockBuffer(3), 'test.webp');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Resolution too high');
        expect(result.error).toContain('Largest axis must be 4000px or fewer');
    });

    it('should accept images with extreme aspect ratios as long as they fit within limits', () => {
        // e.g. 500x1200 (Smallest is 500 < 1000, Largest is 1200 <= 4000)
        const result = validateImageBuffer(createMockBuffer(4), 'test.png');
        expect(result.valid).toBe(true);
    });

    it('should gracefully handle unparseable images', () => {
        const result = validateImageBuffer(createMockBuffer(99), 'broken.jpg');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Failed to parse image dimensions');
    });
});
