/**
 * Simple async sleep utility.
 */
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
