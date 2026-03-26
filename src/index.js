require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const pool = require('./db');
const { Pool } = require('pg');

const authRoutes = require('./routes/auth');
const eventsRoutes = require('./routes/events');
const settingsRoutes = require('./routes/settings');

const app = express();
const PORT = process.env.PORT || 3000;

// Dedicated session pool — avoids contention with app queries
const sessionPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 5,
});

sessionPool.on('error', (err) => {
  console.error('[SESSION POOL ERROR]', err.message);
});

// Allowed origins
const ALLOWED_ORIGINS = [
  'https://liberrima-admin.vercel.app',
  'https://liberrima-list-admin.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
];

// CORS — must come before session/routes
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    // Allow any vercel.app subdomain for Libérrima
    if (/liberrima.*\.vercel\.app$/.test(origin)) return callback(null, true);
    // Allow any onrender.com subdomain (for our own Render-hosted proxy frontend)
    if (/\.onrender\.com$/.test(origin)) return callback(null, true);
    return callback(new Error('CORS not allowed: ' + origin));
  },
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session store in PostgreSQL
const sessionStore = new pgSession({
  pool: sessionPool,
  tableName: 'session',
  createTableIfMissing: true,
  errorLog: (...args) => console.error('[connect-pg-simple ERROR]', ...args),
});

// Verify session table on startup
sessionPool.query('SELECT count(*) FROM session')
  .then(r => console.log('[SESSION STORE] Table OK, rows:', r.rows[0].count))
  .catch(e => {
    console.error('[SESSION STORE] Table check failed:', e.message);
    // Attempt manual table creation
    return sessionPool.query(`
      CREATE TABLE IF NOT EXISTS session (
        sid varchar NOT NULL COLLATE "default",
        sess json NOT NULL,
        expire timestamp(6) NOT NULL,
        CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE
      ) WITH (OIDS=FALSE);
      CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);
    `).then(() => console.log('[SESSION STORE] Table created manually'))
      .catch(e2 => console.error('[SESSION STORE] Manual creation failed:', e2.message));
  });

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'liberrima-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// Request logger — logs all /api/* requests with session info
app.use('/api', (req, res, next) => {
  const hasCookie = req.headers.cookie ? 'yes' : 'NO';
  const sid = req.session ? req.session.id : 'none';
  console.log(`[REQ] ${req.method} ${req.path} | cookie:${hasCookie} | sid:${sid ? sid.substring(0,12) : 'none'}`);
  next();
});

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ──────────────────────────────────────────────────────────────
// Admin panel proxy — serves the Vercel frontend with the API
// URL patched to point at this Render service.
// ──────────────────────────────────────────────────────────────
const https = require('https');
const VERCEL_FRONTEND = 'liberrima-list-admin.vercel.app';
const OLD_API = 'https://liberrima-api.onrender.com/api';
const NEW_API = process.env.RENDER_EXTERNAL_URL
  ? `${process.env.RENDER_EXTERNAL_URL}/api`
  : 'https://liberrima-api-qhle.onrender.com/api';

const _proxyCache = {};

function fetchVercel(path) {
  return new Promise((resolve, reject) => {
    if (_proxyCache[path]) return resolve(_proxyCache[path]);
    const opts = {
      hostname: VERCEL_FRONTEND,
      path,
      headers: { 'User-Agent': 'liberrima-proxy', 'Accept-Encoding': 'identity' },
    };
    https.get(opts, (res) => {
      // Follow redirects (Vercel may redirect)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchVercel(res.headers.location.replace(`https://${VERCEL_FRONTEND}`, '')).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const result = { text, ct: res.headers['content-type'] || '' };
        _proxyCache[path] = result;
        resolve(result);
      });
    }).on('error', reject);
  });
}

// Serve the SPA root (index.html) for any non-API, non-asset path
// React Router handles /login, /dashboard, etc. on the client side
async function serveSPA(req, res) {
  try {
    const { text, ct } = await fetchVercel('/');
    res.setHeader('Content-Type', ct || 'text/html');
    res.send(text);
  } catch (e) {
    res.status(502).send('Admin panel unavailable');
  }
}

app.get('/', serveSPA);

app.get('/assets/:file', async (req, res) => {
  try {
    const { text, ct } = await fetchVercel(`/assets/${req.params.file}`);
    let content = text;
    if (req.params.file.endsWith('.js')) content = content.split(OLD_API).join(NEW_API);
    res.setHeader('Content-Type', ct || 'application/javascript');
    res.send(content);
  } catch (e) {
    res.status(502).send('Asset unavailable');
  }
});

// Catch-all: any path that isn't /api/* gets the SPA index.html
// This lets React Router handle /login, /dashboard, /events, etc.
app.get(/^\/(?!api).*/, serveSPA);

// Session store diagnostic endpoint
app.get('/api/debug/session-test', async (req, res) => {
  const results = {};
  try {
    // 1. Check session table exists and count rows
    const countResult = await sessionPool.query('SELECT count(*) FROM session');
    results.sessionCount = countResult.rows[0].count;
  } catch (e) {
    results.sessionTableError = e.message;
  }
  try {
    // 2. Test direct store set()
    await new Promise((resolve, reject) => {
      const testSid = 'debug-test-' + Date.now();
      const testSession = {
        cookie: { expires: new Date(Date.now() + 60000), httpOnly: true },
        userId: 0,
        debugTest: true,
      };
      sessionStore.set(testSid, testSession, (err) => {
        if (err) return reject(err);
        // Clean up test session
        sessionStore.destroy(testSid, () => {});
        resolve();
      });
    });
    results.storeSetTest = 'OK';
  } catch (e) {
    results.storeSetError = e.message;
  }
  results.currentSession = req.session ? { id: req.session.id, userId: req.session.userId } : null;
  results.nodeEnv = process.env.NODE_ENV;
  results.dbUrl = process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:([^:@]+)@/, ':***@') : 'not set';
  return res.json(results);
});

// Routes
app.use('/api', authRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/settings', settingsRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`🚀 Libérrima API running on port ${PORT}`);
});
