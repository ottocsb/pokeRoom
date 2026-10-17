// Standalone deployment: serves the built client from dist/ and the multiplayer endpoint on one port.
//   npm run build && npm run server        (PORT=8787 by default)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createPokerServer } from './poker-server';
import { WS_PATH } from '../src/protocol';

const root = path.resolve(process.cwd(), 'dist');
const port = Number(process.env.PORT) || 8787;
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = path.join(root, url);
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' }).end(data);
  });
});

const ps = createPokerServer({ dataDir: path.resolve(process.cwd(), 'server-data') });
server.on('upgrade', (req, socket, head) => {
  if (req.url?.split('?')[0] === WS_PATH) ps.handleUpgrade(req, socket, head);
  else socket.destroy();
});
server.listen(port, () => console.log(`[poker] http://localhost:${port}  (ws ${WS_PATH})`));
