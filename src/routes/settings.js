const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/settings/category-emojis
router.get('/category-emojis', async (req, res) => {
  try {
    const result = await pool.query("SELECT value FROM settings WHERE key = 'category-emojis'");
    return res.json(result.rows[0]?.value || {});
  } catch (err) {
    console.error('GET category-emojis error:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// PUT /api/settings/category-emojis — requires auth
router.put('/category-emojis', requireAuth, async (req, res) => {
  try {
    const value = req.body;
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('category-emojis', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = NOW()`,
      [JSON.stringify(value)]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('PUT category-emojis error:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
