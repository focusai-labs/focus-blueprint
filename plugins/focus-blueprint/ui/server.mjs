// The local page server of Focus Blueprint. Node only, no dependencies.
// It listens on this machine alone, on a free port, behind a random token in
// the address, and writes what the user answers into the project folder.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 1024 * 1024;

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // The address is printed as well, so the user can open it by hand.
  }
}

/**
 * Start the server. Resolves with the address once it is listening.
 * once: stop shortly after the first saved answer.
 */
export async function startUi({ projectDir, once = false, idleMinutes = 30 } = {}) {
  const token = crypto.randomBytes(16).toString('hex');
  const uiDir = path.join(projectDir, '.blueprint', 'ui');
  const answersDir = path.join(uiDir, 'answers');
  const infoFile = path.join(uiDir, 'server.json');
  fs.mkdirSync(answersDir, { recursive: true });

  let port = 0;
  let idleTimer = null;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(idleTimer);
    try {
      fs.unlinkSync(infoFile);
    } catch {
      // Already gone.
    }
    server.close();
    server.closeAllConnections();
  };
  const touch = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(close, idleMinutes * 60 * 1000);
  };

  const server = http.createServer(async (req, res) => {
    touch();
    // Only this machine, by its own name. A page on another site that points a
    // hostname at 127.0.0.1 arrives with a different Host and is refused.
    const host = req.headers.host || '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 403, { error: 'forbidden' });

    const parts = new URL(req.url, 'http://local').pathname.split('/').filter(Boolean);
    if (parts[0] !== token) return send(res, 404, { error: 'not found' });
    const route = parts.slice(1).join('/');

    if (req.method === 'GET' && route === '') {
      return send(res, 200, fs.readFileSync(path.join(here, 'probe.html'), 'utf8'), 'text/html; charset=utf-8');
    }

    if (req.method === 'POST' && route === 'api/answer') {
      // A JSON content type cannot be sent across sites without a preflight,
      // and this server answers none.
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
        return send(res, 415, { error: 'json only' });
      }
      let data;
      try {
        data = JSON.parse(await readBody(req));
      } catch {
        return send(res, 400, { error: 'bad request' });
      }
      const name = String(data.name || '');
      if (!/^[a-z0-9-]{1,40}$/.test(name)) return send(res, 400, { error: 'bad name' });
      const file = path.join(answersDir, `${name}.json`);
      const record = { name, answer: data.answer, savedAt: new Date().toISOString() };
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(record, null, 2));
      fs.renameSync(`${file}.tmp`, file);
      send(res, 200, { ok: true });
      if (once) setTimeout(close, 1000);
      return;
    }

    return send(res, 404, { error: 'not found' });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  port = server.address().port;
  const url = `http://127.0.0.1:${port}/${token}/`;
  fs.writeFileSync(infoFile, JSON.stringify({ url, port, pid: process.pid, startedAt: Date.now() }, null, 2));
  touch();

  return { url, port, close, closed: new Promise((resolve) => server.once('close', resolve)) };
}
