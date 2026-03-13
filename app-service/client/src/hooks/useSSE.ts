import { useEffect, useRef, useState } from 'react';

type SSEStatus = 'connected' | 'reconnecting' | 'error';

/**
 * Manages an SSE connection with exponential backoff reconnection.
 * Closes the native EventSource on error and reschedules connection
 * manually so the browser's fixed-1s auto-retry loop never fires.
 * The onMessage callback is stored in a ref, so callers don't need
 * to memoize it — the latest version is always used.
 */
export function useSSE(
    url: string | null,
    onMessage: (event: MessageEvent) => void
): SSEStatus {
    const [status, setStatus] = useState<SSEStatus>('connected');
    const attemptsRef = useRef(0);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const esRef = useRef<EventSource | null>(null);
    const onMessageRef = useRef(onMessage);
    onMessageRef.current = onMessage;

    useEffect(() => {
        if (!url) return;

        function connect() {
            const es = new EventSource(url!);
            esRef.current = es;

            es.onopen = () => {
                attemptsRef.current = 0;
                setStatus('connected');
            };

            es.onmessage = (event) => onMessageRef.current(event);

            es.onerror = () => {
                es.close();
                const attempt = ++attemptsRef.current;
                // Backoff: 1s, 2s, 4s, 8s, 16s, 32s, capped at 60s
                const delay = Math.min(1000 * 2 ** (attempt - 1), 60_000);
                setStatus(attempt <= 5 ? 'reconnecting' : 'error');
                timerRef.current = setTimeout(connect, delay);
            };
        }

        connect();

        return () => {
            esRef.current?.close();
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [url]);

    return status;
}
