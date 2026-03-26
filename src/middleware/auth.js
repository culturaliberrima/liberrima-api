function requireAuth(req, res, next) {
  const sid = req.session ? req.session.id : 'NO_SESSION';
  const userId = req.session ? req.session.userId : undefined;
  console.log(`[AUTH] ${req.method} ${req.path} | SID: ${sid} | userId: ${userId} | cookie: ${req.headers.cookie ? 'present' : 'MISSING'}`);
  if (req.session && req.session.userId) {
    return next();
  }
  console.log(`[AUTH] 401 — session keys: ${req.session ? JSON.stringify(Object.keys(req.session)) : 'null'}`);
  return res.status(401).json({ error: 'No autorizado' });
}

module.exports = { requireAuth };
