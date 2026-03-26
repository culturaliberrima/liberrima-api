require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const pool = require('./db');

const authRoutes = require('./routes/auth');
const eventsRoutes = require('./routes/events');
const settingsRoutes = require('./routes/settings');

const app = express();
const PORT = process.env.PORT || 3000;

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
app.use(session({
  store: new pgSession({
    pool,
    tableName: 'session',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || 'liberrima-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

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

app.get('/', async (req, res) => {
  try {
    const { text, ct } = await fetchVercel('/');
    res.setHeader('Content-Type', ct || 'text/html');
    res.send(text);
  } catch (e) {
    res.status(502).send('Admin panel unavailable');
  }
});

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
