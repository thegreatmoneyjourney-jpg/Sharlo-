// Minimal static file server for the detection-engine test harness
// (M1-010) — serves tests/detection-harness/ so Playwright can navigate
// to harness.html in a real browser. Started by playwright.config.ts's
// `webServer`, not run directly. No new server dependency: this is a
// handful of static files (html/js), well within what Node's built-in
// http/fs modules handle on their own.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const webRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rootDir = path.join(webRoot, 'tests/detection-harness');
const port = Number(process.env.DETECTION_HARNESS_PORT ?? 4174);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const urlPath = new URL(req.url ?? '/', 'http://localhost').pathname;
    const relative = urlPath === '/' ? 'harness.html' : urlPath.replace(/^\/+/, '');
    const filePath = path.join(rootDir, relative);

    if (!filePath.startsWith(rootDir)) {
      res.writeHead(403);
      res.end();
      return;
    }

    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error('not a file');

    const body = await readFile(filePath);
    const contentType = CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(port, () => {
  console.log(`Detection harness static server listening on http://localhost:${port}`);
});
