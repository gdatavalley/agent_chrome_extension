// E2E harness server: serves the fake invoice portal, a one-shot command
// queue for the extension's dev poller, and a report endpoint.
import http from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(dir, '..', 'spike-results.json');

const commands = [];

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
  });
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/spike.html') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(readFileSync(join(dir, 'spike.html')));
  } else if (req.url === '/health') {
    res.end('ok');
  } else if (req.url === '/command' && req.method === 'POST') {
    commands.push(JSON.parse(await readBody(req)));
    res.end('ok');
  } else if (req.url === '/command' && req.method === 'GET') {
    const cmd = commands.shift();
    if (cmd == null) {
      res.statusCode = 204;
      res.end();
    } else {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(cmd));
    }
  } else if (req.url === '/report' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      writeFileSync(RESULTS, JSON.stringify(JSON.parse(body), null, 2));
      console.log('[serve] report written');
      res.end('ok');
    } catch (err) {
      res.statusCode = 400;
      res.end(String(err));
    }
  } else {
    res.statusCode = 404;
    res.end();
  }
});

server.listen(8899, () => console.log('[serve] harness server on http://localhost:8899'));
