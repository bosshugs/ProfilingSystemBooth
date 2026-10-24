const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'stallcheck.sqlite3');
const PORT = Number(process.env.PORT || 3000);
const sessions = new Map();

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'renter')),
    stall TEXT,
    daily_rate REAL NOT NULL DEFAULT 5 CHECK(daily_rate >= 0),
    status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active', 'Pending')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS checkins (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    business_date TEXT NOT NULL,
    method TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, business_date)
  );
  CREATE TABLE IF NOT EXISTS disputes (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    business_date TEXT NOT NULL,
    reason TEXT NOT NULL,
    details TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Open' CHECK(status IN ('Open', 'Resolved')),
    review_note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS active_stall_assignment
    ON users(stall COLLATE NOCASE) WHERE role = 'renter' AND status = 'Active' AND stall IS NOT NULL;
`);

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return {
    salt,
    hash: crypto.scryptSync(password, salt, 64).toString('hex')
  };
}

function seedAdmin() {
  const existing = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  if (existing) return;
  const password = process.env.STALLCHECK_ADMIN_PASSWORD || 'admin123';
  const credentials = hashPassword(password);
  db.prepare(`INSERT INTO users (username, name, email, password_salt, password_hash, role, status)
    VALUES (?, ?, ?, ?, ?, 'admin', 'Active')`).run(
    'admin', 'Market Administrator', 'admin@stallcheck.local', credentials.salt, credentials.hash
  );
}
seedAdmin();

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Request is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON request.')); }
    });
    req.on('error', reject);
  });
}

function currentUser(req) {
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) return null;
  return sessions.get(authorization.slice(7)) || null;
}

function requireRole(req, res, role) {
  const user = currentUser(req);
  if (!user) {
    json(res, 401, { error: 'Please sign in again.' });
    return null;
  }
  if (role && user.role !== role) {
    json(res, 403, { error: 'You do not have permission to do that.' });
    return null;
  }
  return user;
}

function marketDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.MARKET_TIME_ZONE || 'Asia/Singapore',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

function weekStart(date = new Date()) {
  const marketDay = new Date(`${marketDate(date)}T12:00:00+08:00`);
  const daysSinceMonday = (marketDay.getUTCDay() + 6) % 7;
  marketDay.setUTCDate(marketDay.getUTCDate() - daysSinceMonday);
  return marketDay.toISOString().slice(0, 10);
}

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function createRenter(body, status) {
  const name = cleanText(body.name, 80);
  const username = cleanText(body.username, 40);
  const email = cleanText(body.email, 160).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const stall = cleanText(body.stall, 30);
  const dailyRate = Number(body.daily_rate ?? 5);
  if (name.length < 2) throw new Error('Enter the renter’s full name.');
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) throw new Error('Username must be 3–40 characters and use letters, numbers, dot, dash, or underscore.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
  if (password.length < 8 || password.length > 128) throw new Error('Password must be at least 8 characters.');
  if (!stall) throw new Error('Enter a stall or booth ID.');
  if (!Number.isFinite(dailyRate) || dailyRate < 0 || dailyRate > 100000) throw new Error('Enter a valid daily rate.');
  const credentials = hashPassword(password);
  const result = db.prepare(`INSERT INTO users
    (username, name, email, password_salt, password_hash, role, stall, daily_rate, status)
    VALUES (?, ?, ?, ?, ?, 'renter', ?, ?, ?)`)
    .run(username, name, email, credentials.salt, credentials.hash, stall || null, dailyRate, status);
  return db.prepare('SELECT id, username, name, email, role, stall, daily_rate, status FROM users WHERE id = ?').get(result.lastInsertRowid);
}

function renterList() {
  const date = marketDate();
  return db.prepare(`SELECT u.id, u.name, u.username, u.email, u.stall, u.daily_rate, u.status,
    EXISTS(SELECT 1 FROM checkins c WHERE c.user_id = u.id AND c.business_date = ?) AS checked_in_today
    FROM users u WHERE u.role = 'renter' ORDER BY u.created_at DESC, u.name`)
    .all(date).map(row => ({ ...row, checked_in_today: Boolean(row.checked_in_today) }));
}

function attendanceFor(user) {
  const base = `SELECT c.id, c.business_date, c.method, c.created_at,
    u.name, u.stall, u.daily_rate FROM checkins c JOIN users u ON u.id = c.user_id`;
  if (user.role === 'admin') return db.prepare(`${base} ORDER BY c.business_date DESC, c.created_at DESC`).all();
  return db.prepare(`${base} WHERE c.user_id = ? ORDER BY c.business_date DESC, c.created_at DESC`).all(user.id);
}

function disputesFor(user) {
  const base = `SELECT d.id, d.business_date, d.reason, d.details, d.status, d.review_note,
    d.created_at, u.name, u.stall FROM disputes d JOIN users u ON u.id = d.user_id`;
  if (user.role === 'admin') return db.prepare(`${base} ORDER BY d.created_at DESC`).all();
  return db.prepare(`${base} WHERE d.user_id = ? ORDER BY d.created_at DESC`).all(user.id);
}

function adminReport() {
  const today = marketDate();
  const monday = weekStart();
  const activeRenters = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'renter' AND status = 'Active'").get().count;
  const pendingRenters = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'renter' AND status = 'Pending'").get().count;
  const checkinsToday = db.prepare('SELECT COUNT(*) AS count FROM checkins WHERE business_date = ?').get(today).count;
  const totalCheckins = db.prepare('SELECT COUNT(*) AS count FROM checkins').get().count;
  const openDisputes = db.prepare("SELECT COUNT(*) AS count FROM disputes WHERE status = 'Open'").get().count;
  const estimatedToday = db.prepare(`SELECT COALESCE(SUM(u.daily_rate), 0) AS amount FROM checkins c
    JOIN users u ON u.id = c.user_id WHERE c.business_date = ?`).get(today).amount;
  const weekly = db.prepare(`SELECT u.id, u.name, u.stall, u.daily_rate, COUNT(c.id) AS checkins
    FROM users u LEFT JOIN checkins c ON c.user_id = u.id AND c.business_date >= ?
    WHERE u.role = 'renter' AND u.status = 'Active'
    GROUP BY u.id ORDER BY checkins DESC, u.name`).all(monday);
  const weekEstimate = weekly.reduce((sum, renter) => sum + renter.checkins * renter.daily_rate, 0);
  return {
    activeRenters, pendingRenters, checkinsToday, totalCheckins, openDisputes,
    estimatedToday, weekEstimate, weekStart: monday, today,
    topRenters: weekly.map(({ id, name, stall, checkins, daily_rate }) => ({
      id, name, stall, checkins, estimate: checkins * daily_rate
    }))
  };
}

async function handleApi(req, res, url) {
  const method = req.method;
  const route = url.pathname;

  if (route === '/api/health' && method === 'GET') return json(res, 200, { ok: true });

  if (route === '/api/login' && method === 'POST') {
    const body = await readJson(req);
    const username = cleanText(body.username, 80);
    const password = typeof body.password === 'string' ? body.password : '';
    const role = body.role === 'admin' ? 'admin' : 'renter';
    const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
    if (!user || user.role !== role) return json(res, 401, { error: 'Username, password, or account type is incorrect.' });
    const candidate = Buffer.from(hashPassword(password, user.password_salt).hash, 'hex');
    const expected = Buffer.from(user.password_hash, 'hex');
    if (candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected)) {
      return json(res, 401, { error: 'Username, password, or account type is incorrect.' });
    }
    if (user.status !== 'Active') return json(res, 403, { error: 'Your account is awaiting administrator approval.' });
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { id: user.id, username: user.username, name: user.name, email: user.email,
      role: user.role, stall: user.stall, daily_rate: user.daily_rate });
    return json(res, 200, { token, user: sessions.get(token) });
  }

  if (route === '/api/register' && method === 'POST') {
    const body = await readJson(req);
    try {
      const renter = createRenter(body, 'Pending');
      return json(res, 201, { renter, message: 'Account request saved for administrator approval.' });
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) return json(res, 409, { error: 'That username, email, or active stall assignment is already in use.' });
      return json(res, 400, { error: error.message });
    }
  }

  if (route === '/api/logout' && method === 'POST') {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
    sessions.delete(token);
    return json(res, 200, { ok: true });
  }

  if (route === '/api/admin/report' && method === 'GET') {
    if (!requireRole(req, res, 'admin')) return;
    return json(res, 200, adminReport());
  }

  if (route === '/api/admin/renters' && method === 'GET') {
    if (!requireRole(req, res, 'admin')) return;
    return json(res, 200, { renters: renterList() });
  }

  if (route === '/api/admin/renters' && method === 'POST') {
    if (!requireRole(req, res, 'admin')) return;
    try { return json(res, 201, { renter: createRenter(await readJson(req), 'Active') }); }
    catch (error) {
      if (String(error.message).includes('UNIQUE')) return json(res, 409, { error: 'That username, email, or active stall assignment is already in use.' });
      return json(res, 400, { error: error.message });
    }
  }

  const renterMatch = route.match(/^\/api\/admin\/renters\/(\d+)$/);
  if (renterMatch && method === 'PATCH') {
    if (!requireRole(req, res, 'admin')) return;
    const body = await readJson(req);
    const stall = cleanText(body.stall, 30);
    const dailyRate = Number(body.daily_rate);
    if (!stall) return json(res, 400, { error: 'Enter a stall or booth ID.' });
    if (!Number.isFinite(dailyRate) || dailyRate < 0 || dailyRate > 100000) return json(res, 400, { error: 'Enter a valid daily rate.' });
    try {
      const result = db.prepare("UPDATE users SET stall = ?, daily_rate = ? WHERE id = ? AND role = 'renter' AND status = 'Active'")
        .run(stall, dailyRate, Number(renterMatch[1]));
      if (!result.changes) return json(res, 404, { error: 'Active renter account not found.' });
      return json(res, 200, { ok: true });
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) return json(res, 409, { error: 'That stall is already assigned to another active renter.' });
      throw error;
    }
  }

  const approvalMatch = route.match(/^\/api\/admin\/renters\/(\d+)\/approve$/);
  if (approvalMatch && method === 'POST') {
    if (!requireRole(req, res, 'admin')) return;
    try {
      const result = db.prepare("UPDATE users SET status = 'Active' WHERE id = ? AND role = 'renter' AND status = 'Pending' AND stall IS NOT NULL AND stall != ''")
        .run(Number(approvalMatch[1]));
      if (!result.changes) return json(res, 404, { error: 'Pending renter account not found or stall assignment is missing.' });
      return json(res, 200, { ok: true });
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) return json(res, 409, { error: 'That stall is already assigned to an active renter.' });
      throw error;
    }
  }

  if (route === '/api/attendance' && method === 'GET') {
    const user = requireRole(req, res);
    if (!user) return;
    return json(res, 200, { attendance: attendanceFor(user) });
  }

  if (route === '/api/checkins' && method === 'POST') {
    const user = requireRole(req, res, 'renter');
    if (!user) return;
    if (!user.stall) return json(res, 403, { error: 'Your stall assignment is not active yet. Contact the administrator.' });
    const body = await readJson(req);
    const methodName = cleanText(body.method, 40);
    if (!['Face scan', 'Fingerprint', 'Face + fingerprint'].includes(methodName)) {
      return json(res, 400, { error: 'Choose a supported demo method.' });
    }
    const date = marketDate();
    try {
      db.prepare('INSERT INTO checkins (user_id, business_date, method) VALUES (?, ?, ?)').run(user.id, date, methodName);
      return json(res, 201, { ok: true, message: `Demo attendance saved for ${date} (${methodName}).` });
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) return json(res, 409, { error: 'Your attendance is already recorded for today.' });
      throw error;
    }
  }

  if (route === '/api/disputes' && method === 'GET') {
    const user = requireRole(req, res);
    if (!user) return;
    return json(res, 200, { disputes: disputesFor(user) });
  }

  if (route === '/api/disputes' && method === 'POST') {
    const user = requireRole(req, res, 'renter');
    if (!user) return;
    const body = await readJson(req);
    const date = cleanText(body.business_date, 10);
    const reason = cleanText(body.reason, 100);
    const details = cleanText(body.details, 1000);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !reason || details.length < 4) {
      return json(res, 400, { error: 'Enter the date, reason, and details for your dispute.' });
    }
    db.prepare('INSERT INTO disputes (user_id, business_date, reason, details) VALUES (?, ?, ?, ?)')
      .run(user.id, date, reason, details);
    return json(res, 201, { ok: true });
  }

  const disputeMatch = route.match(/^\/api\/admin\/disputes\/(\d+)$/);
  if (disputeMatch && method === 'PATCH') {
    if (!requireRole(req, res, 'admin')) return;
    const body = await readJson(req);
    const note = cleanText(body.review_note, 500);
    if (note.length < 3) return json(res, 400, { error: 'Add a short resolution note.' });
    const result = db.prepare("UPDATE disputes SET status = 'Resolved', review_note = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'Open'")
      .run(note, Number(disputeMatch[1]));
    if (!result.changes) return json(res, 404, { error: 'Open dispute not found.' });
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'API route not found.' });
}

const publicFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']]
]);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    const file = publicFiles.get(url.pathname);
    if (!file || req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const content = fs.readFileSync(path.join(ROOT, file[0]));
    res.writeHead(200, {
      'Content-Type': file[1], 'Content-Length': content.length,
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin'
    });
    return res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) json(res, 500, { error: 'The server could not complete that request.' });
    else res.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`StallCheck running at http://localhost:${PORT}`);
  console.log(`SQLite database: ${DB_PATH}`);
  if (!process.env.STALLCHECK_ADMIN_PASSWORD) {
    console.log('Development administrator: admin / admin123 (change before any shared or production deployment)');
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
}
