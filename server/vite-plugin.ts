import path from 'node:path';
import type { Plugin } from 'vite';
import type { Server as HttpServer } from 'node:http';
import { createPokerServer } from './poker-server';
import { WS_PATH } from '../src/protocol';

/** Mounts the multiplayer WebSocket endpoint on Vite's dev and preview servers. */
export function pokerServerPlugin(): Plugin {
  const mount = (http: HttpServer | null | undefined) => {
    if (!http) return;
    const ps = createPokerServer({ dataDir: path.resolve(process.cwd(), 'server-data') });
    http.on('upgrade', (req, socket, head) => {
      if (req.url?.split('?')[0] === WS_PATH) ps.handleUpgrade(req, socket, head);
    });
    http.on('close', () => ps.close());
  };
  return {
    name: 'poker-server',
    configureServer(server) {
      mount(server.httpServer as HttpServer | null);
    },
    configurePreviewServer(server) {
      mount(server.httpServer as HttpServer);
    },
  };
}
