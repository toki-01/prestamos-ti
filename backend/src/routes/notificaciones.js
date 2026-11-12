const router = require('express').Router();
const { query } = require('../db');
const { auth } = require('../middleware/auth');
const { wrap } = require('../utils');

router.use(auth);

router.get(
  '/',
  wrap(async (req, res) => {
    const { rows } = await query(
      'SELECT id, titulo, cuerpo, leida, creado_en FROM notificaciones WHERE usuario_id = $1 ORDER BY creado_en DESC LIMIT 50',
      [req.user.id]
    );
    res.json({ items: rows, no_leidas: rows.filter((n) => !n.leida).length });
  })
);

router.post(
  '/leer',
  wrap(async (req, res) => {
    await query('UPDATE notificaciones SET leida = TRUE WHERE usuario_id = $1 AND NOT leida', [req.user.id]);
    res.json({ ok: true });
  })
);

module.exports = router;
