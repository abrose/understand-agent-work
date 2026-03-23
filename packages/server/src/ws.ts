import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';

let wss: WebSocketServer | null = null;

export function setupWebSocket(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'connected' }));
  });

  return wss;
}

export function broadcastGraphUpdate(): void {
  if (!wss) return;
  const message = JSON.stringify({ type: 'graph-updated' });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}
