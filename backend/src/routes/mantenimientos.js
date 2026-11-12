const router = require('express').Router();
const { query, withTx } = require('../db');
const { auth, requireRol, TI } = require('../middleware/auth');
const { wrap, HttpError } = require('../utils');

router.use(auth, requireRol(...TI));

router.get(
  '/',
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT m.*, e.nombre AS equipo_nombre, e.numero_serie
       FROM mantenimientos m JOIN equipos e ON e.id = m.equipo_id
       ORDER BY m.resuelto ASC, m.fecha_reporte DESC LIMIT 100`
    );
    res.json(rows);
  })
);

// Marcar la falla como resuelta; el equipo vuelve a DISPONIBLE si no quedan fallas abiertas
router.post(
  '/:id/resolver',
  wrap(async (req, res) => {
    await withTx(async (c) => {
      const { rows } = await c.query(
        `UPDATE mantenimientos SET resuelto=TRUE, fecha_resolucion=now() WHERE id=$1 AND NOT resuelto RETURNING equipo_id`,
        [req.params.id]
      );
      if (!rows[0]) throw new HttpError(409, 'Reporte inexistente o ya resuelto');
      const abiertos = await c.query('SELECT 1 FROM mantenimientos WHERE equipo_id=$1 AND NOT resuelto', [rows[0].equipo_id]);
      if (!abiertos.rowCount) await c.query(`UPDATE equipos SET estado='DISPONIBLE' WHERE id=$1`, [rows[0].equipo_id]);
    });
    res.json({ ok: true });
  })
);

module.exports = router;
