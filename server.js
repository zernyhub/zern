/**
 * adbwifi.dev — personal profile server
 * ---------------------------------------------------------------
 * Zero-dependency Node.js server (only built-in modules).
 * Runs anywhere `node` runs, no `npm install` required, $0 hosting
 * on any host that can run a persistent Node process (Render,
 * Railway, Fly.io, a VPS, or your own machine) since it needs a
 * writable disk for uploads + JSON data (not a serverless/static host).
 *
 * Routes:
 *   GET  /                      -> public profile
 *   GET  /customize             -> private editor (auth required, redirects to /customize/login)
 *   GET  /uploads/*             -> uploaded media (public read, needed so visitors can see your stuff)
 *   /api/*                      -> JSON API, see below
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

// Minimal .env loader (no dependency on the `dotenv` package). Safe no-op if
// the file doesn't exist — on most hosts you'll set real env vars instead.
(function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if (/^".*"$/.test(val) || /^'.*'$/.test(val)) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  });
})();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const SESSION_COOKIE = 'adb_sid';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

const DATA_DIR = path.join(ROOT, 'data');
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const PUBLIC_DIR = path.join(ROOT, 'public');
const ADMIN_DIR = path.join(ROOT, 'admin');
const PROFILE_FILE = path.join(DATA_DIR, 'profile.json');
const MEDIA_FILE = path.join(DATA_DIR, 'media.json');
const DEFAULT_PROFILE_FILE = path.join(DATA_DIR, 'profile.default.json');

for (const dir of [DATA_DIR, UPLOADS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(PROFILE_FILE)) {
  fs.copyFileSync(DEFAULT_PROFILE_FILE, PROFILE_FILE);
}
if (!fs.existsSync(MEDIA_FILE)) {
  fs.writeFileSync(MEDIA_FILE, '[]');
}

// Allowed upload types -> { ext set, max bytes, category }
const UPLOAD_RULES = {
  image: { exts: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'ico'], max: 15 * 1024 * 1024 },
  audio: { exts: ['mp3', 'wav', 'ogg'], max: 40 * 1024 * 1024 },
  video: { exts: ['mp4', 'webm'], max: 150 * 1024 * 1024 },
  font: { exts: ['ttf', 'otf', 'woff', 'woff2'], max: 10 * 1024 * 1024 },
};
const EXT_TO_CATEGORY = {};
for (const [cat, rule] of Object.entries(UPLOAD_RULES)) {
  for (const ext of rule.exts) EXT_TO_CATEGORY[ext] = cat;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// ---------------------------------------------------------------------------
// In-memory session store (fine for a single-user personal site — a restart
// just means you log in again at /customize)
// ---------------------------------------------------------------------------

const sessions = new Map(); // sid -> expiresAt
const loginAttempts = new Map(); // ip -> { count, resetAt }

function newSession() {
  const sid = crypto.randomBytes(32).toString('hex');
  sessions.set(sid, Date.now() + SESSION_TTL_MS);
  return sid;
}

function isValidSession(sid) {
  if (!sid) return false;
  const exp = sessions.get(sid);
  if (!exp) return false;
  if (Date.now() > exp) {
    sessions.delete(sid);
    return false;
  }
  return true;
}

function safeCompare(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // still run timingSafeEqual against a same-length dummy to avoid leaking length via timing
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function rateLimited(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 5 * 60 * 1000 });
    return false;
  }
  entry.count++;
  return entry.count > 10; // 10 attempts / 5 min per IP
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('Payload too large'), { code: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req, maxBytes = 5 * 1024 * 1024) {
  const buf = await readBody(req, maxBytes);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch (e) {
    throw Object.assign(new Error('Invalid JSON'), { code: 400 });
  }
}

function sanitizeFilename(name) {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.slice(-100) || 'file';
}

function atomicWriteJson(file, data) {
  const tmp = file + '.tmp' + crypto.randomBytes(4).toString('hex');
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

// Very small multipart/form-data parser (built for this app's needs only:
// one or more file parts + optional plain fields). Works on the raw Buffer
// so binary uploads (images/audio/video/fonts) are never corrupted.
function parseMultipart(buffer, boundary) {
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buffer.indexOf(boundaryBuf);
  while (start !== -1) {
    const next = buffer.indexOf(boundaryBuf, start + boundaryBuf.length);
    if (next === -1) break;
    let chunk = buffer.slice(start + boundaryBuf.length, next);
    // strip leading CRLF and trailing CRLF/--
    if (chunk.slice(0, 2).toString() === '\r\n') chunk = chunk.slice(2);
    if (chunk.slice(-2).toString() === '\r\n') chunk = chunk.slice(0, -2);
    if (chunk.length && chunk.toString('latin1') !== '--') {
      const headerEnd = chunk.indexOf('\r\n\r\n');
      if (headerEnd !== -1) {
        const rawHeaders = chunk.slice(0, headerEnd).toString('utf8');
        const body = chunk.slice(headerEnd + 4);
        const headers = {};
        rawHeaders.split('\r\n').forEach((line) => {
          const idx = line.indexOf(':');
          if (idx === -1) return;
          headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
        });
        const disposition = headers['content-disposition'] || '';
        const nameMatch = disposition.match(/name="([^"]*)"/);
        const filenameMatch = disposition.match(/filename="([^"]*)"/);
        parts.push({
          name: nameMatch ? nameMatch[1] : null,
          filename: filenameMatch ? filenameMatch[1] : null,
          contentType: headers['content-type'] || null,
          data: body,
        });
      }
    }
    start = next;
  }
  return parts;
}

function serveStaticFile(res, absPath, extraHeaders) {
  fs.readFile(absPath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    const ext = path.extname(absPath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      ...extraHeaders,
    });
    res.end(data);
  });
}

// Resolve a requested path safely under a root dir (prevents path traversal)
function resolveSafe(root, requestPath) {
  const decoded = decodeURIComponent(requestPath);
  const resolved = path.normalize(path.join(root, decoded));
  if (!resolved.startsWith(path.normalize(root))) return null;
  return resolved;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleLogin(req, res) {
  const ip = req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip)) {
    return sendJson(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
  }
  let body;
  try {
    body = await readJsonBody(req, 10 * 1024);
  } catch (e) {
    return sendJson(res, e.code || 400, { error: e.message });
  }
  if (!body.password || !safeCompare(body.password, ADMIN_PASSWORD)) {
    return sendJson(res, 401, { error: 'Incorrect password' });
  }
  const sid = newSession();
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${sid}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Lax`
  );
  sendJson(res, 200, { ok: true });
}

function handleLogout(req, res) {
  const cookies = parseCookies(req);
  if (cookies[SESSION_COOKIE]) sessions.delete(cookies[SESSION_COOKIE]);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
  sendJson(res, 200, { ok: true });
}

function handleSession(req, res) {
  const cookies = parseCookies(req);
  sendJson(res, 200, { authed: isValidSession(cookies[SESSION_COOKIE]) });
}

function handleGetProfile(req, res) {
  const profile = readJsonFile(PROFILE_FILE, {});
  sendJson(res, 200, profile);
}

async function handlePutProfile(req, res) {
  let body;
  try {
    body = await readJsonBody(req, 5 * 1024 * 1024);
  } catch (e) {
    return sendJson(res, e.code || 400, { error: e.message });
  }
  if (typeof body !== 'object' || Array.isArray(body) || body === null) {
    return sendJson(res, 400, { error: 'Profile must be a JSON object' });
  }
  atomicWriteJson(PROFILE_FILE, body);
  sendJson(res, 200, { ok: true, savedAt: new Date().toISOString() });
}

function handleGetMedia(req, res) {
  const media = readJsonFile(MEDIA_FILE, []);
  sendJson(res, 200, media);
}

async function handleUpload(req, res) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!boundaryMatch) return sendJson(res, 400, { error: 'Expected multipart/form-data' });
  const boundary = boundaryMatch[1] || boundaryMatch[2];

  let buffer;
  try {
    buffer = await readBody(req, 160 * 1024 * 1024); // hard ceiling, per-type limit enforced below
  } catch (e) {
    return sendJson(res, e.code || 400, { error: e.message });
  }

  const parts = parseMultipart(buffer, boundary);
  const fileParts = parts.filter((p) => p.filename);
  if (!fileParts.length) return sendJson(res, 400, { error: 'No file in upload' });

  const media = readJsonFile(MEDIA_FILE, []);
  const saved = [];
  const errors = [];

  for (const part of fileParts) {
    const ext = path.extname(part.filename).slice(1).toLowerCase();
    const category = EXT_TO_CATEGORY[ext];
    if (!category) {
      errors.push({ filename: part.filename, error: `Unsupported file type .${ext}` });
      continue;
    }
    const rule = UPLOAD_RULES[category];
    if (part.data.length > rule.max) {
      errors.push({
        filename: part.filename,
        error: `File too large (max ${(rule.max / (1024 * 1024)).toFixed(0)}MB for ${category})`,
      });
      continue;
    }
    const id = crypto.randomBytes(12).toString('hex');
    const safeName = sanitizeFilename(part.filename);
    const storedName = `${id}-${safeName}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, storedName), part.data);
    const record = {
      id,
      filename: safeName,
      storedName,
      url: `/uploads/${storedName}`,
      type: category,
      ext,
      size: part.data.length,
      uploadedAt: new Date().toISOString(),
    };
    media.unshift(record);
    saved.push(record);
  }

  atomicWriteJson(MEDIA_FILE, media);
  sendJson(res, saved.length ? 200 : 400, { saved, errors });
}

async function handleRenameMedia(req, res, id) {
  let body;
  try {
    body = await readJsonBody(req, 10 * 1024);
  } catch (e) {
    return sendJson(res, e.code || 400, { error: e.message });
  }
  if (!body.filename || typeof body.filename !== 'string') {
    return sendJson(res, 400, { error: 'filename required' });
  }
  const media = readJsonFile(MEDIA_FILE, []);
  const item = media.find((m) => m.id === id);
  if (!item) return sendJson(res, 404, { error: 'Not found' });
  item.filename = sanitizeFilename(body.filename);
  atomicWriteJson(MEDIA_FILE, media);
  sendJson(res, 200, item);
}

function handleDeleteMedia(req, res, id) {
  const media = readJsonFile(MEDIA_FILE, []);
  const idx = media.findIndex((m) => m.id === id);
  if (idx === -1) return sendJson(res, 404, { error: 'Not found' });
  const [item] = media.splice(idx, 1);
  const filePath = path.join(UPLOADS_DIR, item.storedName);
  fs.unlink(filePath, () => {});
  atomicWriteJson(MEDIA_FILE, media);
  sendJson(res, 200, { ok: true });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const AUTH_REQUIRED_PREFIXES = ['/api/profile', '/api/media', '/api/upload'];
const AUTH_REQUIRED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const cookies = parseCookies(req);
    const authed = isValidSession(cookies[SESSION_COOKIE]);

    // --- Auth gate for mutating API routes ---
    const needsAuth =
      AUTH_REQUIRED_METHODS.has(req.method) &&
      AUTH_REQUIRED_PREFIXES.some((p) => pathname.startsWith(p));
    if (needsAuth && !authed) {
      return sendJson(res, 401, { error: 'Not authenticated' });
    }
    // GET /api/media is also private (it's your personal library)
    if (pathname.startsWith('/api/media') && req.method === 'GET' && !authed) {
      return sendJson(res, 401, { error: 'Not authenticated' });
    }

    // --- API routes ---
    if (pathname === '/api/login' && req.method === 'POST') return handleLogin(req, res);
    if (pathname === '/api/logout' && req.method === 'POST') return handleLogout(req, res);
    if (pathname === '/api/session' && req.method === 'GET') return handleSession(req, res);
    if (pathname === '/api/profile' && req.method === 'GET') return handleGetProfile(req, res);
    if (pathname === '/api/profile' && req.method === 'PUT') return handlePutProfile(req, res);
    if (pathname === '/api/media' && req.method === 'GET') return handleGetMedia(req, res);
    if (pathname === '/api/upload' && req.method === 'POST') return handleUpload(req, res);
    const mediaIdMatch = pathname.match(/^\/api\/media\/([a-f0-9]+)$/);
    if (mediaIdMatch && req.method === 'PATCH') return handleRenameMedia(req, res, mediaIdMatch[1]);
    if (mediaIdMatch && req.method === 'DELETE') return handleDeleteMedia(req, res, mediaIdMatch[1]);

    // --- Uploaded media (public read — visitors need to load your avatar etc.) ---
    if (pathname.startsWith('/uploads/')) {
      const abs = resolveSafe(UPLOADS_DIR, pathname.replace('/uploads', ''));
      if (!abs) return sendJson(res, 400, { error: 'Bad path' });
      return serveStaticFile(res, abs, { 'Cache-Control': 'public, max-age=31536000, immutable' });
    }

    // --- /customize (private editor) ---
    if (pathname === '/customize' || pathname === '/customize/') {
      return serveStaticFile(res, path.join(ADMIN_DIR, 'index.html'), { 'Cache-Control': 'no-store' });
    }
    if (pathname.startsWith('/customize/')) {
      const abs = resolveSafe(ADMIN_DIR, pathname.replace('/customize', ''));
      if (!abs) return sendJson(res, 400, { error: 'Bad path' });
      return serveStaticFile(res, abs);
    }

    // --- public profile (static) ---
    if (pathname === '/' ) {
      return serveStaticFile(res, path.join(PUBLIC_DIR, 'index.html'), { 'Cache-Control': 'no-store' });
    }
    const abs = resolveSafe(PUBLIC_DIR, pathname);
    if (abs && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      return serveStaticFile(res, abs);
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`adbwifi.dev profile server running on http://localhost:${PORT}`);
  console.log(`  Public profile: http://localhost:${PORT}/`);
  console.log(`  Customize GUI:  http://localhost:${PORT}/customize`);
  if (ADMIN_PASSWORD === 'changeme') {
    console.log('  ⚠ Using default password "changeme" — set ADMIN_PASSWORD env var before deploying.');
  }
});
