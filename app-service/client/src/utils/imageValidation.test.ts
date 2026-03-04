import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateAvatarImage, validateAvatarUrl } from './imageValidation';

describe('imageValidation', () => {
    describe('validateAvatarUrl', () => {
        it('should accept valid URLs under 256 characters', () => {
            const result = validateAvatarUrl('https://example.com/avatar.png');
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('should reject URLs over 256 characters', () => {
            const longUrl = 'https://example.com/' + 'a'.repeat(250) + '.png';
            const result = validateAvatarUrl(longUrl);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('must be 256 characters or fewer');
        });
    });

    describe('validateAvatarImage', () => {
        beforeEach(() => {
            // Mock URL.createObjectURL
            window.URL.createObjectURL = vi.fn(() => 'mock-url');
            window.URL.revokeObjectURL = vi.fn();

            // Intercept Image constructor to control load behavior
            vi.stubGlobal('Image', class {
                width = 500;
                height = 500;
                _src = '';
                onload: any = null;
                onerror: any = null;

                set src(_value: string) {
                    this._src = _value;
                    setTimeout(() => {
                        if (this.width === -1) {
                            if (this.onerror) this.onerror(new Event('error'));
                        } else {
                            if (this.onload) this.onload();
                        }
                    }, 10);
                }
                
                get src() {
                    return this._src;
                }
            });
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('should reject invalid file types', async () => {
            const file = new File([''], 'test.gif', { type: 'image/gif' });
            const result = await validateAvatarImage(file);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('The image must be in .jpg, .png, or .webp format. Your file type is gif.');
        });

        it('should handle unknown file types gracefully', async () => {
            const file = new File([''], 'test.txt', { type: '' });
            const result = await validateAvatarImage(file);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Your file type is unknown.');
        });

        it('should reject files over 1MB', async () => {
            const size = 1024 * 1024 + 2048; // 1026 KB
            const largeBuffer = new ArrayBuffer(size);
            const file = new File([largeBuffer], 'test.jpg', { type: 'image/jpeg' });
            const result = await validateAvatarImage(file);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('The image must be under 1024 KB (1 MB). Your image is 1026 KB.');
        });

        it('should accept a file exactly 1MB', async () => {
            const size = 1024 * 1024;
            const buffer = new ArrayBuffer(size);
            const file = new File([buffer], 'test.jpg', { type: 'image/jpeg' });
            const result = await validateAvatarImage(file);
            expect(result.valid).toBe(true);
        });

        it('should accept valid images', async () => {
            const file = new File(['mock'], 'test.png', { type: 'image/png' });
            const result = await validateAvatarImage(file);
            expect(result.valid).toBe(true);
        });

        it('should reject images with smallest axis >= 1000px', async () => {
            const file = new File(['mock'], 'test.png', { type: 'image/png' });
            
            // Override the global stub just for this test
            vi.stubGlobal('Image', class {
                width = 1000;
                height = 1500;
                onload: any = null;
                set src(_v: string) {
                    setTimeout(() => { if (this.onload) this.onload(); }, 10);
                }
            });

            const result = await validateAvatarImage(file);
            expect(result.valid).toBe(false);
            expect(result.error).toBe("The image must be below 1000 x 1000 pixels in resolution along its smallest axis. Your image's smallest axis is 1000 pixels (1000x1500).");
        });

        it('should reject images with largest axis > 4000px', async () => {
            const file = new File(['mock'], 'test.png', { type: 'image/png' });
            
            vi.stubGlobal('Image', class {
                width = 500;
                height = 4001;
                onload: any = null;
                set src(_v: string) {
                    setTimeout(() => { if (this.onload) this.onload(); }, 10);
                }
            });

            const result = await validateAvatarImage(file);
            expect(result.valid).toBe(false);
            expect(result.error).toBe("The image must be 4000 pixels or fewer along its largest axis. Your image's largest axis is 4001 pixels (500x4001).");
        });

        it('should accept an image with largest axis exactly 4000px', async () => {
            const file = new File(['mock'], 'test.png', { type: 'image/png' });
            
            vi.stubGlobal('Image', class {
                width = 4000;
                height = 500;
                onload: any = null;
                set src(_v: string) {
                    setTimeout(() => { if (this.onload) this.onload(); }, 10);
                }
            });

            const result = await validateAvatarImage(file);
            expect(result.valid).toBe(true);
        });

        it('should reject images that fail to load', async () => {
            const file = new File(['mock'], 'test.png', { type: 'image/png' });
            
            vi.stubGlobal('Image', class {
                onerror: any = null;
                set src(_value: string) {
                    setTimeout(() => { if (this.onerror) this.onerror(new Event('error')); }, 10);
                }
            });

            const result = await validateAvatarImage(file);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Failed to load image');
        });
    });
});
