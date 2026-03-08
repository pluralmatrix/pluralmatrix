import { useState, useCallback } from 'react';

export function useDirtyState<T>(initialState: T) {
    const [state, setState] = useState<T>(initialState);
    const [isDirty, setIsDirty] = useState(false);

    const setDirtyState = useCallback((newState: T | ((prevState: T) => T)) => {
        console.log('[useDirtyState] setDirtyState called!', new Error().stack?.split('\n')[2]);
        setIsDirty(true);
        setState(newState);
    }, []);

    const resetState = useCallback((newState: T) => {
        setIsDirty(false);
        setState(newState);
    }, []);

    return [state, setDirtyState, isDirty, resetState] as const;
}