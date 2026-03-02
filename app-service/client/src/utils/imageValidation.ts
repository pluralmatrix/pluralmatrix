/**
 * Validates an image file against avatar limits.
 */
export interface ImageValidationResult {
    valid: boolean;
    error?: string;
}

export const validateAvatarImage = async (file: File): Promise<ImageValidationResult> => {
    // 1. File Format Check
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
        return {
            valid: false,
            error: `The image must be in .jpg, .png, or .webp format. Your file type is ${file.type.split('/')[1] || 'unknown'}.`
        };
    }

    // 2. File Size Check
    const maxSizeInBytes = 1024 * 1024; // 1024 KB
    if (file.size > maxSizeInBytes) {
        return {
            valid: false,
            error: `The image must be under 1024 KB (1 MB). Your image is ${Math.round(file.size / 1024)} KB.`
        };
    }

    // 3. Resolution and Animation Check
    return new Promise((resolve) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(objectUrl);

            // Resolution Check: below 1000x1000 pixels along its smallest axis
            const smallestAxis = Math.min(img.width, img.height);
            if (smallestAxis >= 1000) {
                resolve({
                    valid: false,
                    error: `The image must be below 1000 x 1000 pixels in resolution along its smallest axis. Your image's smallest axis is ${smallestAxis} pixels (${img.width}x${img.height}).`
                });
                return;
            }

            // Resolution Check: max 4000 pixels along its largest axis
            const largestAxis = Math.max(img.width, img.height);
            if (largestAxis > 4000) {
                resolve({
                    valid: false,
                    error: `The image must be 4000 pixels or fewer along its largest axis. Your image's largest axis is ${largestAxis} pixels (${img.width}x${img.height}).`
                });
                return;
            }

            // Animation Check: (GIFs are already excluded by mime type check above)
            // Note: Detecting animated WebP or APNG is more complex but mime check covers basic GIF restriction.
            
            resolve({ valid: true });
        };

        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            resolve({
                valid: false,
                error: "Failed to load image for validation. It may be corrupted or an unsupported format."
            });
        };

        img.src = objectUrl;
    });
};

export const validateAvatarUrl = (url: string): ImageValidationResult => {
    if (url.length > 256) {
        return {
            valid: false,
            error: `The avatar URL must be 256 characters or fewer. Your URL is ${url.length} characters.`
        };
    }
    return { valid: true };
};
