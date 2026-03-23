import { useEffect, useRef } from 'react';

export function useWebSocket(onGraphUpdate: () => void) {
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'graph-updated') {
          onGraphUpdate();
        }
      } catch {}
    };

    ws.onclose = () => {
      // Reconnect after a delay
      setTimeout(() => {
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
      }, 3000);
    };

    return () => {
      ws.close();
    };
  }, [onGraphUpdate]);
}
