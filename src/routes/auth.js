const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// POST /api/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    req.session.userId = user.id;
    req.session.userEmail = user.email;

    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ error: 'Error al guardar sesión' });
      }
      return res.json({ ok: true, email: user.email });
    });
    return;
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// POST /api/logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Error al cerrar sesión' });
    }
    res.clearCookie('connect.sid');
    return res.json({ ok: true });
  });
});

// GET /api/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, email FROM users WHERE id = $1', [req.session.userId]);
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }
    return res.json({ id: user.id, email: user.email });
  } catch (err) {
    console.error('Me error:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
