// Spike target server: serves the fake invoice portal and accepts the
// extension's report, written to spike-results.json for inspection.
import http from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(dir, '..', 'spike-results.json');

const server = http.createServer((req, res) => {
  if (req.url === '/spike.html') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(readFileSync(join(dir, 'spike.html')));
  } else if (req.url === '/health') {
    res.end('ok');
  } else if (req.url === '/report' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        writeFileSync(RESULTS, JSON.stringify(JSON.parse(body), null, 2));
        console.log('[serve] report written to spike-results.json');
        res.end('ok');
      } catch (err) {
        res.statusCode = 400;
        res.end(String(err));
      }
    });
  } else {
    res.statusCode = 404;
    res.end();
  }
});

server.listen(8899, () => console.log('[serve] spike server on http://localhost:8899'));
