const router = require('express').Router();
const { query } = require('../db');
const { auth, requireRol } = require('../middleware/auth');
const { wrap, HttpError } = require('../utils');

router.use(auth, requireRol('ADMIN'));

// Estadísticas globales de uso y fallas
router.get(
  '/stats',
  wrap(async (req, res) => {
    const [estados, totales, top] = await Promise.all([
      query(`SELECT estado, COUNT(*)::int AS n FROM equipos GROUP BY estado`),
      query(`SELECT (SELECT COUNT(*)::int FROM prestamos) AS prestamos,
                    (SELECT COUNT(*)::int FROM mantenimientos) AS fallas,
                    (SELECT COUNT(*)::int FROM usuarios WHERE activo) AS usuarios`),
      query(`SELECT e.nombre, COUNT(*)::int AS usos FROM prestamos p JOIN solicitudes s ON s.id=p.solicitud_id
             JOIN equipos e ON e.id=s.equipo_id GROUP BY e.nombre ORDER BY usos DESC LIMIT 5`),
    ]);
    res.json({ equipos_por_estado: estados.rows, ...totales.rows[0], mas_usados: top.rows });
  })
);

router.get(
  '/usuarios',
  wrap(async (req, res) => {
    const { rows } = await query('SELECT id, nombre, correo, rol, tipo, activo FROM usuarios ORDER BY nombre');
    res.json(rows);
  })
);

router.patch(
  '/usuarios/:id',
  wrap(async (req, res) => {
    const { rol, activo } = req.body || {};
    if (rol && !['SOLICITANTE', 'SOPORTE_TI', 'ADMIN'].includes(rol)) throw new HttpError(400, 'Rol inválido');
    if (Number(req.params.id) === req.user.id && (rol || activo === false))
      throw new HttpError(400, 'No puedes cambiar tu propio rol ni desactivarte');
    const { rows } = await query(
      `UPDATE usuarios SET rol = COALESCE($2::rol_usuario, rol), activo = COALESCE($3, activo)
       WHERE id = $1 RETURNING id, nombre, correo, rol, tipo, activo`,
      [req.params.id, rol || null, typeof activo === 'boolean' ? activo : null]
    );
    if (!rows[0]) throw new HttpError(404, 'Usuario no encontrado');
    res.json(rows[0]);
  })
);

module.exports = router;
