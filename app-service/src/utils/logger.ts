/**
 * Simple utility to add ISO timestamps to all console logs.
 * Import this at the very top of the entry point.
 */
export function initializeLogger() {
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalInfo = console.info;

    const getTimestamp = () => `[${new Date().toISOString()}]`;

    console.log = (...args: unknown[]) => {
        originalLog(getTimestamp(), ...args);
    };

    console.error = (...args: unknown[]) => {
        originalError(getTimestamp(), ...args);
    };

    console.warn = (...args: unknown[]) => {
        originalWarn(getTimestamp(), ...args);
    };

    console.info = (...args: unknown[]) => {
        originalInfo(getTimestamp(), ...args);
    };
    
    console.log("[Logger] Timestamps initialized.");
}
