const express = require('express');
const multer = require('multer');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Multer: store image in memory (we'll handle upload separately, or skip for now)
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// Helper: format date fields as YYYY-MM-DD so the frontend can parse them correctly
function formatEventDates(row) {
  const fmt = (d) => d instanceof Date ? d.toISOString().split('T')[0] : (d ? String(d).split('T')[0] : null);
  return { ...row, fecha: fmt(row.fecha), fechaFin: fmt(row.fechaFin) };
}

// Helper: parse FormData fields into event object
function parseEventFields(body) {
  const boolField = (val) => val === 'true' || val === true;
  const jsonField = (val) => {
    if (!val || val === 'undefined') return [];
    try { return JSON.parse(val); } catch { return []; }
  };

  return {
    titulo: body.titulo || '',
    fecha: body.fecha || null,
    fechaFin: body.fechaFin || null,
    hora: body.hora || '',
    horaFin: body.horaFin || '',
    lugar: body.lugar || '',
    lugarId: body.lugarId || null,
    recurrente: body.recurrente || '',
    costo: body.costo || '',
    costoGratuito: boolField(body.costoGratuito),
    descripcion: body.descripcion || '',
    boletos: body.boletos || '',
    organizador: body.organizador || '',
    publicacion: body.publicacion || null,
    contacto: body.contacto || '',
    contactoTipo: body.contactoTipo || '',
    estado: body.estado || 'Colima',
    ciudad: body.ciudad || 'Colima',
    destacado: boolField(body.destacado),
    categorias: jsonField(body.categorias),
    artistas: jsonField(body.artistas),
    cuentas: jsonField(body.cuentas),
    clasificacion: body.clasificacion || 'toda la familia',
    tipo: body.tipo || 'evento',
  };
}

// GET /api/events — public or auth (both allowed)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM events ORDER BY fecha ASC, created_at DESC'
    );
    return res.json(result.rows.map(formatEventDates));
  } catch (err) {
    console.error('GET events error:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/events/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM events WHERE id = $1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Evento no encontrado' });
    return res.json(formatEventDates(result.rows[0]));
  } catch (err) {
    console.error('GET event error:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// POST /api/events — requires auth
router.post('/', requireAuth, upload.single('imagen'), async (req, res) => {
  try {
    const fields = parseEventFields(req.body);

    // Handle image: if a file was uploaded, store it as base64 or skip
    // For now, use existing imagen URL from body if no file
    let imagen = req.body.imagen || '';
    if (req.file) {
      // Encode as base64 data URL (simple approach, no external storage needed)
      imagen = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    }

    const result = await pool.query(
      `INSERT INTO events (
        titulo, fecha, "fechaFin", hora, "horaFin", lugar, "lugarId",
        recurrente, costo, "costoGratuito", descripcion, boletos, organizador,
        publicacion, contacto, "contactoTipo", estado, ciudad, destacado,
        categorias, artistas, cuentas, clasificacion, tipo, imagen
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
        $20::jsonb,$21::jsonb,$22::jsonb,$23,$24,$25
      ) RETURNING *`,
      [
        fields.titulo, fields.fecha || null, fields.fechaFin || null,
        fields.hora, fields.horaFin, fields.lugar, fields.lugarId || null,
        fields.recurrente, fields.costo, fields.costoGratuito,
        fields.descripcion, fields.boletos, fields.organizador,
        fields.publicacion || null, fields.contacto, fields.contactoTipo,
        fields.estado, fields.ciudad, fields.destacado,
        JSON.stringify(fields.categorias), JSON.stringify(fields.artistas),
        JSON.stringify(fields.cuentas), fields.clasificacion, fields.tipo, imagen
      ]
    );

    return res.status(201).json(formatEventDates(result.rows[0]));
  } catch (err) {
    console.error('POST event error:', err);
    return res.status(500).json({ error: 'Error interno', detail: err.message });
  }
});

// PUT /api/events/:id — requires auth
router.put('/:id', requireAuth, upload.single('imagen'), async (req, res) => {
  try {
    const { id } = req.params;
    const fields = parseEventFields(req.body);

    // Get current event to preserve existing image if no new one
    const current = await pool.query('SELECT imagen FROM events WHERE id = $1', [id]);
    if (!current.rows[0]) return res.status(404).json({ error: 'Evento no encontrado' });

    let imagen = req.body.imagen || current.rows[0].imagen || '';
    if (req.file) {
      imagen = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    }

    const result = await pool.query(
      `UPDATE events SET
        titulo=$1, fecha=$2, "fechaFin"=$3, hora=$4, "horaFin"=$5, lugar=$6, "lugarId"=$7,
        recurrente=$8, costo=$9, "costoGratuito"=$10, descripcion=$11, boletos=$12,
        organizador=$13, publicacion=$14, contacto=$15, "contactoTipo"=$16,
        estado=$17, ciudad=$18, destacado=$19, categorias=$20::jsonb,
        artistas=$21::jsonb, cuentas=$22::jsonb, clasificacion=$23, tipo=$24, imagen=$25
      WHERE id=$26 RETURNING *`,
      [
        fields.titulo, fields.fecha || null, fields.fechaFin || null,
        fields.hora, fields.horaFin, fields.lugar, fields.lugarId || null,
        fields.recurrente, fields.costo, fields.costoGratuito,
        fields.descripcion, fields.boletos, fields.organizador,
        fields.publicacion || null, fields.contacto, fields.contactoTipo,
        fields.estado, fields.ciudad, fields.destacado,
        JSON.stringify(fields.categorias), JSON.stringify(fields.artistas),
        JSON.stringify(fields.cuentas), fields.clasificacion, fields.tipo, imagen,
        id
      ]
    );

    return res.json(formatEventDates(result.rows[0]));
  } catch (err) {
    console.error('PUT event error:', err);
    return res.status(500).json({ error: 'Error interno', detail: err.message });
  }
});

// DELETE /api/events/:id — requires auth
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM events WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Evento no encontrado' });
    return res.json({ ok: true, deleted: result.rows[0].id });
  } catch (err) {
    console.error('DELETE event error:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
