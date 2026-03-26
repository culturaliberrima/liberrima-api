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

// Trust Render/Cloudflare proxy so req.secure = true for HTTPS requests.
// Without this, express-session silently omits Set-Cookie when cookie.secure=true.
app.set('trust proxy', 1);

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

// Temporary: return auth context snippet from bundle for patching
app.get('/api/debug/bundle-auth', async (req, res) => {
  try {
    const { text } = await fetchVercel('/assets/index-Bht0jmQ4.js');
    // Find the auth provider pattern — look for isLoading useState
    const idx = text.indexOf('isLoading');
    const ctx = idx >= 0 ? text.substring(Math.max(0, idx - 200), idx + 400) : 'NOT FOUND';
    // Strip any sensitive strings
    const safe = ctx.replace(/password/gi,'[PW]').replace(/token/gi,'[TK]');
    res.json({ idx, len: text.length, ctx: safe });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ──────────────────────────────────────────────────────────────
// Proxy helpers — serve both the Admin SPA and the public
// Cartelera from Vercel, with the API URL patched to point at
// this Render service.
// ──────────────────────────────────────────────────────────────
const https = require('https');

// Admin SPA (Vercel)
const VERCEL_FRONTEND = 'liberrima-list-admin.vercel.app';

// Public Cartelera (Vercel)
const CARTELERA_FRONTEND = 'liberrima-cartelera.vercel.app';

// Old API base the cartelera bundle was compiled against
const CARTELERA_OLD_API = 'https://liberrima-api.onrender.com';

// New API base (this very service)
const NEW_API_BASE = process.env.RENDER_EXTERNAL_URL
  ? process.env.RENDER_EXTERNAL_URL
  : 'https://liberrima-api-qhle.onrender.com';

// Admin OLD_API kept for backward-compat with asset patching below
const OLD_API = `${CARTELERA_OLD_API}/api`;
const NEW_API = `${NEW_API_BASE}/api`;

// ── Generic Vercel proxy fetcher ────────────────────────────────────────────
// Returns { text, ct, buf } — buf is the raw Buffer (for images/fonts).
function makeFetcher(hostname, cache) {
  return function fetchFrom(path) {
    return new Promise((resolve, reject) => {
      if (cache[path]) return resolve(cache[path]);
      const opts = {
        hostname,
        path,
        headers: { 'User-Agent': 'liberrima-proxy', 'Accept-Encoding': 'identity' },
      };
      https.get(opts, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const loc = res.headers.location.replace(`https://${hostname}`, '');
          return fetchFrom(loc).then(resolve).catch(reject);
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const ct = res.headers['content-type'] || '';
          const text = buf.toString('utf8');
          const result = { text, ct, buf };
          cache[path] = result;
          resolve(result);
        });
      }).on('error', reject);
    });
  };
}

const _adminCache = {};
const _carteleraCache = {};
const fetchVercel = makeFetcher(VERCEL_FRONTEND, _adminCache);
const fetchCartelera = makeFetcher(CARTELERA_FRONTEND, _carteleraCache);

// Serve the SPA root (index.html) for any non-API, non-asset path
// React Router handles /login, /dashboard, etc. on the client side
async function serveSPA(req, res) {
  try {
    const { text, ct } = await fetchVercel('/');
    let html = text;

    // If user has a valid session, inject two layers of protection against
    // the React PrivateRoute race condition:
    //
    // LAYER 1 — history intercept: React Router's <Navigate to="/login"> fires
    // via useEffect and calls history.replaceState BEFORE the auth context's
    // useEffect resolves. We catch any replaceState/pushState to /login and
    // hold it for up to 600 ms. If /api/me resolves with user data in that
    // window, we cancel the redirect entirely. Safety fallback: after 600 ms
    // without resolution, the redirect is allowed to proceed normally.
    //
    // LAYER 2 — fetch intercept: return /api/me data synchronously (as an
    // immediately-resolved Promise) so the auth context state update fires
    // as fast as possible, well within the 600 ms hold window.
    if (req.session && req.session.userId && req.session.userEmail) {
      const user = { id: req.session.userId, email: req.session.userEmail };
      const userJson = JSON.stringify(user);
      const injectScript = `<script>
(function(){
  var __u=${userJson};
  var __resolved=false;
  var __pendingNav=null;

  /* ── LAYER 1: history intercept ──────────────────────────────── */
  var _oReplace=history.replaceState.bind(history);
  var _oPush=history.pushState.bind(history);

  function _intercept(orig,args){
    var url=args[2];
    if(!__resolved && url && (url+'').replace(/^https?:\/\/[^/]*/,'').indexOf('/login')===0){
      /* Hold this redirect – give auth a chance to resolve */
      __pendingNav=function(){ orig.apply(history,args); };
      setTimeout(function(){
        if(!__resolved && __pendingNav){
          /* Auth didn't resolve in time – allow the redirect */
          var fn=__pendingNav; __pendingNav=null; fn();
        }
      },600);
      return;
    }
    return orig.apply(history,args);
  }

  history.replaceState=function(){ return _intercept(_oReplace,arguments); };
  history.pushState=function(){ return _intercept(_oPush,arguments); };

  /* ── LAYER 2: fetch intercept ────────────────────────────────── */
  var __orig=window.fetch?window.fetch.bind(window):null;
  function __patchedFetch(url,opts){
    if(typeof url==='string'&&url.indexOf('/api/me')!==-1){
      if(__orig) window.fetch=__orig;
      /* Mark auth resolved & cancel any pending /login redirect */
      __resolved=true;
      __pendingNav=null;
      return Promise.resolve(new Response(JSON.stringify(__u),{
        status:200,
        headers:{'Content-Type':'application/json'}
      }));
    }
    return __orig?__orig(url,opts):fetch(url,opts);
  }
  if(window.fetch){ window.fetch=__patchedFetch; }
  else {
    Object.defineProperty(window,'fetch',{
      configurable:true,writable:true,
      set:function(fn){
        Object.defineProperty(window,'fetch',{configurable:true,writable:true,value:fn});
        window.fetch=__patchedFetch;
      },
      get:function(){ return __patchedFetch; }
    });
  }
})();
</script>`;
      html = html.replace('</head>', injectScript + '</head>');
      if (html === text) {
        // Fallback: inject before </body> if no </head>
        html = text.replace('</body>', injectScript + '</body>');
      }
    }

    res.setHeader('Content-Type', ct || 'text/html');
    res.send(html);
  } catch (e) {
    res.status(502).send('Admin panel unavailable');
  }
}

// ── Cartelera SPA (public) ──────────────────────────────────────────────────
// Served when:
//   • Host header is liberrima.com / www.liberrima.com  (production)
//   • OR request path starts with /cartelera            (testing via Render URL)
async function serveCarteleraSPA(req, res) {
  try {
    const { text, ct } = await fetchCartelera('/');
    // Rewrite absolute asset paths so they resolve under /cartelera/
    // (only needed when serving under a sub-path, harmless when at root)
    const basePath = isCarteleraHost(req) ? '' : '/cartelera';
    const html = text
      .split('src="/assets/').join(`src="${basePath}/assets/`)
      .split('href="/assets/').join(`href="${basePath}/assets/`)
      .split('crossorigin src="/').join(`crossorigin src="${basePath}/`)
      .split('crossorigin href="/').join(`crossorigin href="${basePath}/`);
    res.setHeader('Content-Type', ct || 'text/html');
    res.send(html);
  } catch (e) {
    console.error('serveCarteleraSPA error:', e.message);
    res.status(502).send('Cartelera no disponible');
  }
}

function isCarteleraHost(req) {
  const host = (req.headers.host || '').toLowerCase();
  return host.includes('liberrima.com');
}

// ── Root & assets: host-aware ───────────────────────────────────────────────
app.get('/', (req, res) => {
  if (isCarteleraHost(req)) return serveCarteleraSPA(req, res);
  return serveSPA(req, res);
});

app.get('/assets/:file', async (req, res) => {
  try {
    const file = req.params.file;
    const isBinary = /\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)$/i.test(file);

    if (isCarteleraHost(req)) {
      // Serve cartelera asset
      const { text, ct, buf } = await fetchCartelera(`/assets/${file}`);
      let content = file.endsWith('.js')
        ? Buffer.from(text.split(CARTELERA_OLD_API).join(NEW_API_BASE))
        : (isBinary ? buf : Buffer.from(text));
      res.setHeader('Content-Type', ct || 'application/octet-stream');
      return res.send(content);
    }

    // Serve admin panel asset
    const { text, ct } = await fetchVercel(`/assets/${file}`);
    let content = file.endsWith('.js') ? text.split(OLD_API).join(NEW_API) : text;
    res.setHeader('Content-Type', ct || 'application/javascript');
    return res.send(content);
  } catch (e) {
    res.status(502).send('Asset unavailable');
  }
});

// ── /cartelera/* sub-path — for testing before DNS cutover ─────────────────
app.get('/cartelera', serveCarteleraSPA);
app.get('/cartelera/', serveCarteleraSPA);

app.get('/cartelera/assets/:file', async (req, res) => {
  try {
    const file = req.params.file;
    const isBinary = /\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)$/i.test(file);
    const { text, ct, buf } = await fetchCartelera(`/assets/${file}`);
    let content = file.endsWith('.js')
      ? Buffer.from(text.split(CARTELERA_OLD_API).join(NEW_API_BASE))
      : (isBinary ? buf : Buffer.from(text));
    res.setHeader('Content-Type', ct || 'application/octet-stream');
    return res.send(content);
  } catch (e) {
    res.status(502).send('Asset unavailable');
  }
});

// Catch-all: any path that isn't /api/* or /cartelera/* gets the admin SPA
// This lets React Router handle /login, /dashboard, /events, etc.
app.get(/^\/(?!api|cartelera).*/, (req, res) => {
  if (isCarteleraHost(req)) return serveCarteleraSPA(req, res);
  return serveSPA(req, res);
});

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
