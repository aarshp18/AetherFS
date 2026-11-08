import { useEffect, useRef, useState } from 'react';
import { FsEvent } from './types';

const host = typeof window !== 'undefined' ? window.location.hostname : '127.0.0.1';
export const WS_EVENT_URL = `ws://${host}:8080/api/v1/events`;
const RECONNECT_DELAY_MS = 2500;

/**
 * Returns true if path contains or starts with:
 * .cache, .git/, node_modules/, target/, .vite/, dist/, or .tmp
 */
export function isIgnoredPath(path: string): boolean {
  if (!path) return false;
  const clean = path.replace(/\\/g, '/').replace(/^\/+/, '');
  const patterns = [
    '.cache',
    '.git/',
    'node_modules/',
    'target/',
    '.vite/',
    'dist/',
    '.tmp',
  ];

  for (const pattern of patterns) {
    if (clean.startsWith(pattern) || clean.includes(pattern)) {
      return true;
    }
    if (pattern.endsWith('/')) {
      const dirName = pattern.slice(0, -1);
      if (clean === dirName || clean.endsWith('/' + dirName) || clean.includes('/' + dirName + '/')) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Custom React hook that opens a WebSocket connection to AetherFS event engine,
 * auto-reconnects on drop after a short delay, and dispatches incoming events.
 */
export function useEvents(onEvent?: (event: FsEvent) => void) {
  const [isConnected, setIsConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let isDisposed = false;

    function connect() {
      if (isDisposed) return;

      try {
        ws = new WebSocket(WS_EVENT_URL);

        ws.onopen = () => {
          if (isDisposed) {
            ws?.close();
            return;
          }
          setIsConnected(true);
          console.log('[AetherFS] WebSocket connected to', WS_EVENT_URL);
        };

        ws.onmessage = (event: MessageEvent) => {
          if (isDisposed) return;
          try {
            const data: FsEvent = JSON.parse(event.data);
            onEventRef.current?.(data);
          } catch (err) {
            console.error('[AetherFS] Failed to parse event payload:', err);
          }
        };

        ws.onerror = (err) => {
          console.warn('[AetherFS] WebSocket encountered an error:', err);
          // onerror is typically followed by onclose
        };

        ws.onclose = () => {
          setIsConnected(false);
          ws = null;
          if (!isDisposed) {
            console.log(`[AetherFS] WebSocket closed. Reconnecting in ${RECONNECT_DELAY_MS}ms...`);
            reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
          }
        };
      } catch (err) {
        console.error('[AetherFS] Error creating WebSocket:', err);
        if (!isDisposed) {
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      }
    }

    connect();

    return () => {
      isDisposed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (ws) {
        ws.close();
      }
    };
  }, []);

  return { isConnected };
}
