import { config } from '../config';

/**
 * Ensures a valid web URL by stripping trailing slashes from the base URL
 * and ensuring the path starts with a slash, preventing double slashes (e.g. //s/slug)
 */
export const buildWebUrl = (path: string = ''): string => {
    const baseUrl = config.publicWebUrl.endsWith('/') 
        ? config.publicWebUrl.slice(0, -1) 
        : config.publicWebUrl;
        
    if (!path) return baseUrl;
    
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${baseUrl}${cleanPath}`;
};