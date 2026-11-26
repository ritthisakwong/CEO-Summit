import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import QRCode from 'qrcode';

const password = process.env.ADMIN_PASSWORD;
if (!password || password.length < 20 || !/^[!-~]+$/.test(password)) {
  throw new Error('Set ADMIN_PASSWORD to at least 20 printable ASCII characters without spaces.');
}
const port = Number(process.env.PORT || 8080);
const origin = process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN) : null;
if (origin && (!['http:', 'https:'].includes(origin.protocol) || origin.href !== origin.origin + '/')) {
  throw new Error('PUBLIC_ORIGIN must contain only the scheme, hostname and optional port.');
}
const secure = origin?.protocol === 'https:';
const voteUrl = origin ? new URL('/vote', origin).href : null;
const qr = voteUrl && await QRCode.toBuffer(voteUrl, { width: 440, margin: 4, errorCorrectionLevel: 'M' });
const directory = process.env.DATA_DIR || './data';
mkdirSync(directory, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(join(directory, 'summit.sqlite'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id = 1), round TEXT, open INTEGER, revealed INTEGER);
  INSERT OR IGNORE INTO settings VALUES (1, lower(hex(randomblob(16))), 0, 0);
  CREATE TABLE IF NOT EXISTS ballots (
    id INTEGER PRIMARY KEY, token TEXT UNIQUE NOT NULL, scores TEXT NOT NULL,
    feedback TEXT NOT NULL, approved INTEGER NOT NULL DEFAULT 0
  );
`);
const query = sql => db.prepare(sql);
const settings = query('SELECT round, open, revealed FROM settings WHERE id = 1');
const totals = query(`SELECT count(*) AS count, ${Array.from({length: 10}, (_, i) =>
  `avg(json_extract(scores, '$[${i}]')) AS k${i}`).join(',')} FROM ballots`);
const messages = query('SELECT id, feedback, approved FROM ballots WHERE feedback != ? ORDER BY id');
const submitted = query('SELECT 1 FROM ballots WHERE token = ?');
const insert = query('INSERT INTO ballots (token, scores, feedback) VALUES (?, ?, ?)');
const files = new Map([
  ['/app.js', ['text/javascript; charset=utf-8', readFileSync(new URL('./public/app.js', import.meta.url))]],
  ['/style.css', ['text/css; charset=utf-8', readFileSync(new URL('./public/style.css', import.meta.url))]],
]);
const html = readFileSync(new URL('./public/index.html', import.meta.url));
const clients = new Set();
const hash = value => createHash('sha256').update(value).digest();
const adminDigest = hash(password);
const cookieName = secure ? '__Host-summit' : 'summit';

function publicState() {
  const { round, open, revealed } = settings.get();
  const row = totals.get();
  const averages = Array.from({length: 10}, (_, i) => row['k' + i]);
  return {
    round, open: Boolean(open), revealed, count: row.count, voteUrl,
    averages: averages.slice(0, Math.min(revealed, 10)),
    overall: revealed === 11 && row.count ? averages.reduce((a, b) => a + b, 0) / 10 : null,
    feedback: revealed === 11 ? messages.all('').filter(row => row.approved).map(row => row.feedback) : [],
  };
}

function publish() {
  const event = 'data: ' + JSON.stringify(publicState()) + '\n\n';
  for (const client of clients) if (!client.write(event)) client.destroy();
}

function cookie(req, res, create = false) {
  const token = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='))?.split('=')[1];
  if (token && /^[a-f0-9]{64}$/.test(token)) return hash(token).toString('hex');
  if (!create) return null;
  const value = randomBytes(32).toString('hex');
  res.setHeader('Set-Cookie', `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${secure ? '; Secure' : ''}`);
  return hash(value).toString('hex');
}

function reply(res, status, data, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}

async function body(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw Object.assign(new Error(), {status: 415});
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({destroyOnReturn: false})) {
    size += chunk.length;
    if (size > 8192) throw Object.assign(new Error(), {status: 413});
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw Object.assign(new Error(), {status: 400}); }
}

function adminState() {
  return { ...publicState(), moderation: messages.all('') };
}

const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  const path = (req.url || '').split('?')[0];
  const method = req.method;
  try {
    if (method === 'GET' && path === '/') {
      res.writeHead(302, {Location: '/vote'}).end();
      return;
    }
    if (method === 'GET' && ['/vote', '/projector', '/admin'].includes(path)) return reply(res, 200, html, 'text/html; charset=utf-8');
    if (method === 'GET' && files.has(path)) {
      const [mime, content] = files.get(path);
      return reply(res, 200, content, mime);
    }
    if (method === 'GET' && path === '/qr.png' && qr) return reply(res, 200, qr, 'image/png');
    if (method === 'GET' && path === '/api/events') {
      if (clients.size >= 250) return reply(res, 503, {error: 'too_many_connections'});
      res.writeHead(200, {'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no'});
      res.write('data: ' + JSON.stringify(publicState()) + '\n\n');
      clients.add(res);
      res.on('close', () => clients.delete(res));
      return;
    }
    if (method === 'GET' && path === '/api/participant') {
      const token = cookie(req, res, true);
      return reply(res, 200, {round: settings.get().round, submitted: Boolean(submitted.get(token))});
    }
    if (method === 'POST' && req.headers.origin &&
      req.headers.origin !== (origin?.origin || `http://${req.headers.host}`)) return reply(res, 403, {error: 'origin'});
    if (method === 'POST' && path === '/api/vote') {
      const token = cookie(req, res);
      if (!token) return reply(res, 403, {error: 'token'});
      const {scores, feedback, round} = (await body(req)) ?? {};
      if (!Array.isArray(scores) || scores.length !== 10 || !scores.every(n => Number.isInteger(n) && n >= 1 && n <= 5)
        || typeof feedback !== 'string' || feedback.length > 500) return reply(res, 400, {error: 'invalid_vote'});
      const current = settings.get();
      if (round !== current.round) return reply(res, 409, {error: 'round_changed'});
      if (submitted.get(token)) return reply(res, 409, {error: 'already_submitted'});
      if (!current.open) return reply(res, 409, {error: 'closed'});
      insert.run(token, JSON.stringify(scores), feedback.trim());
      publish();
      return reply(res, 201, {ok: true});
    }
    if (path === '/api/admin' && ['GET', 'POST'].includes(method)) {
      const candidate = req.headers.authorization || '';
      if (!candidate.startsWith('Bearer ') || !timingSafeEqual(adminDigest, hash(candidate.slice(7)))) {
        return reply(res, 401, {error: 'admin_auth'});
      }
      if (method === 'GET') return reply(res, 200, adminState());
      const {action, round, id, approved, stage} = (await body(req)) ?? {};
      const current = settings.get();
      if (current.round !== round) return reply(res, 409, {error: 'round_changed'});
      switch (action) {
        case 'open':
          if (current.revealed) return reply(res, 409, {error: 'reveal_started'});
          db.exec('UPDATE settings SET open = 1');
          break;
        case 'close':
          db.exec('UPDATE settings SET open = 0');
          break;
        case 'reveal':
          if (current.open || current.revealed >= 11 || stage !== current.revealed || !totals.get().count)
            return reply(res, 409, {error: 'reveal_unavailable'});
          db.exec('UPDATE settings SET revealed = revealed + 1');
          break;
        case 'moderate':
          if (!Number.isSafeInteger(id) || typeof approved !== 'boolean') return reply(res, 400, {error: 'invalid_feedback'});
          query("UPDATE ballots SET approved = ? WHERE id = ? AND feedback != ''").run(Number(approved), id);
          break;
        case 'reset':
          db.exec('BEGIN');
          try {
            db.exec("DELETE FROM ballots; UPDATE settings SET round = lower(hex(randomblob(16))), open = 0, revealed = 0;");
            db.exec('COMMIT');
          } catch (error) {
            db.exec('ROLLBACK');
            throw error;
          }
          break;
        default:
          return reply(res, 400, {error: 'invalid_action'});
      }
      publish();
      return reply(res, 200, adminState());
    }
    return reply(res, 404, {error: 'not_found'});
  } catch (error) {
    if (!error.status) console.error(error.message);
    if (!res.headersSent) reply(res, error.status || 500, {error: 'request_failed'});
    else res.end();
  }
});

setInterval(() => {
  for (const client of clients) if (!client.write(': heartbeat\n\n')) client.destroy();
}, 15000).unref();
server.listen(port, process.env.HOST || '0.0.0.0', () => console.log('Summit listening on port ' + server.address().port));
