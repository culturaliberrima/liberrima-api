const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ─── Generic helpers ────────────────────────────────────────────────────────

async function getSetting(key, defaultValue) {
  const result = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return result.rows[0]?.value ?? defaultValue;
}

async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
    [key, JSON.stringify(value)]
  );
}

// ─── category-emojis ────────────────────────────────────────────────────────

router.get('/category-emojis', async (req, res) => {
  try {
    return res.json(await getSetting('category-emojis', {}));
  } catch (err) {
    console.error('GET category-emojis error:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
});

router.put('/category-emojis', requireAuth, async (req, res) => {
  try {
    await setSetting('category-emojis', req.body);
    return res.json({ ok: true });
  } catch (err) {
    console.error('PUT category-emojis error:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// ─── classification-emojis ──────────────────────────────────────────────────
// Maps clasificacion values → emoji shown in the cartelera public view.

const DEFAULT_CLASSIFICATION_EMOJIS = {
  'toda la familia': '👨‍👩‍👧‍👦',
  'familiar': '👨‍👩‍👧‍👦',
  'infantil': '🧒',
  'niños': '🧒',
  'adultos': '🔞',
  'mayores de 12': '🔞',
  'todas las edades': '👨‍👩‍👧‍👦',
};

router.get('/classification-emojis', async (req, res) => {
  try {
    return res.json(await getSetting('classification-emojis', DEFAULT_CLASSIFICATION_EMOJIS));
  } catch (err) {
    console.error('GET classification-emojis error:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
});

router.put('/classification-emojis', requireAuth, async (req, res) => {
  try {
    await setSetting('classification-emojis', req.body);
    return res.json({ ok: true });
  } catch (err) {
    console.error('PUT classification-emojis error:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// ─── event-types ────────────────────────────────────────────────────────────
// List of valid event types shown as filter options in the cartelera.

const DEFAULT_EVENT_TYPES = [
  { value: 'evento', label: 'Evento' },
  { value: 'taller', label: 'Taller' },
  { value: 'clase', label: 'Clase' },
];

router.get('/event-types', async (req, res) => {
  try {
    return res.json(await getSetting('event-types', DEFAULT_EVENT_TYPES));
  } catch (err) {
    console.error('GET event-types error:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
});

router.put('/event-types', requireAuth, async (req, res) => {
  try {
    await setSetting('event-types', req.body);
    return res.json({ ok: true });
  } catch (err) {
    console.error('PUT event-types error:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
