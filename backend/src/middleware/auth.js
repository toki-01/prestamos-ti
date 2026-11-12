const jwt = require('jsonwebtoken');
const { query } = require('../db');

// RF-01: autenticación JWT. Para GET también acepta ?token= (abrir el PDF de QR en el navegador).
async function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : req.method === 'GET' ? req.query.token : null;
    if (!token) return res.status(401).json({ error: 'No autenticado' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await query(
      'SELECT id, nombre, correo, rol, tipo, activo FROM usuarios WHERE id = $1',
      [payload.id]
    );
    const u = rows[0];
    if (!u || !u.activo) return res.status(401).json({ error: 'Usuario inactivo o inexistente' });
    req.user = u;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
}

// RF-01: restricción basada en roles
const requireRol =
  (...roles) =>
  (req, res, next) =>
    roles.includes(req.user.rol) ? next() : res.status(403).json({ error: 'No tienes permiso para esta acción' });

const TI = ['SOPORTE_TI', 'ADMIN'];

module.exports = { auth, requireRol, TI };
