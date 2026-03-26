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
app.get('/', (req, res) => res.json({ status: 'ok', service: 'liberrima-api' }));
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

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
