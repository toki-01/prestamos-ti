const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { auth } = require('../middleware/auth');
const { wrap, HttpError } = require('../utils');

const firmar = (u) => jwt.sign({ id: u.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
const publico = (u) => ({ id: u.id, nombre: u.nombre, correo: u.correo, rol: u.rol, tipo: u.tipo });

router.post(
  '/register',
  wrap(async (req, res) => {
    const { nombre, correo, password, tipo } = req.body || {};
    if (!nombre || !correo || !password) throw new HttpError(400, 'Nombre, correo y contraseña son obligatorios');
    if (password.length < 6) throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres');
    const mail = String(correo).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) throw new HttpError(400, 'Correo inválido');
    const dominio = (process.env.ALLOWED_EMAIL_DOMAIN || '').trim().toLowerCase();
    if (dominio && !mail.endsWith('@' + dominio.replace(/^@/, '')))
      throw new HttpError(400, `Usa tu correo institucional (@${dominio.replace(/^@/, '')})`);
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      `INSERT INTO usuarios (nombre, correo, password_hash, tipo) VALUES ($1,$2,$3,$4) RETURNING *`,
      [nombre.trim(), mail, hash, tipo === 'Alumno' ? 'Alumno' : 'Docente']
    );
    res.status(201).json({ token: firmar(rows[0]), usuario: publico(rows[0]) });
  })
);

router.post(
  '/login',
  wrap(async (req, res) => {
    const { correo, password } = req.body || {};
    const { rows } = await query('SELECT * FROM usuarios WHERE correo = $1', [String(correo || '').trim().toLowerCase()]);
    const u = rows[0];
    if (!u || !u.activo || !(await bcrypt.compare(password || '', u.password_hash)))
      throw new HttpError(401, 'Correo o contraseña incorrectos');
    res.json({ token: firmar(u), usuario: publico(u) });
  })
);

router.get('/me', auth, (req, res) => res.json({ usuario: publico(req.user) }));

// Registro del token de notificaciones push del dispositivo
router.put(
  '/push-token',
  auth,
  wrap(async (req, res) => {
    const token = req.body && req.body.token ? String(req.body.token) : null;
    // un mismo dispositivo no debe recibir pushes de otro usuario
    if (token) await query('UPDATE usuarios SET push_token = NULL WHERE push_token = $1 AND id <> $2', [token, req.user.id]);
    await query('UPDATE usuarios SET push_token = $1 WHERE id = $2', [token, req.user.id]);
    res.json({ ok: true });
  })
);

module.exports = router;
