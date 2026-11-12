const router = require('express').Router();
const { query, withTx } = require('../db');
const { auth, requireRol, TI } = require('../middleware/auth');
const { wrap, HttpError, UUID_RE } = require('../utils');
const { notifyUser, notifyRoles } = require('../services/notify');

router.use(auth);

// Escaneo desde TI: ¿toca ENTREGA (solicitud aprobada) o DEVOLUCIÓN (préstamo activo)?
router.get(
  '/por-qr/:uuid',
  requireRol(...TI),
  wrap(async (req, res) => {
    if (!UUID_RE.test(req.params.uuid)) throw new HttpError(400, 'Código QR no válido');
    const eq = await query(
      `SELECT e.id, e.nombre, e.numero_serie, e.estado, c.nombre AS categoria
       FROM equipos e LEFT JOIN categorias c ON c.id = e.categoria_id WHERE e.codigo_qr = $1`,
      [req.params.uuid]
    );
    const equipo = eq.rows[0];
    if (!equipo) throw new HttpError(404, 'Este código QR no corresponde a ningún equipo');
    const acc = await query('SELECT nombre_accesorio FROM accesorios WHERE equipo_id = $1 ORDER BY id', [equipo.id]);
    const accesorios = acc.rows.map((a) => a.nombre_accesorio);

    const sol = await query(
      `SELECT s.*, u.nombre AS usuario_nombre FROM solicitudes s JOIN usuarios u ON u.id = s.usuario_id
       WHERE s.equipo_id = $1 AND s.estado IN ('APROBADA','ENTREGADA') LIMIT 1`,
      [equipo.id]
    );
    const solicitud = sol.rows[0] || null;
    let prestamo = null;
    let fase = 'NINGUNA';
    if (solicitud && solicitud.estado === 'APROBADA') fase = 'ENTREGA';
    if (solicitud && solicitud.estado === 'ENTREGADA') {
      fase = 'DEVOLUCION';
      prestamo = (await query('SELECT * FROM prestamos WHERE solicitud_id = $1', [solicitud.id])).rows[0] || null;
    }
    res.json({ fase, equipo, accesorios, solicitud, prestamo });
  })
);

// RF-07: registrar entrega con checklist de accesorios
router.post(
  '/entrega',
  requireRol(...TI),
  wrap(async (req, res) => {
    const { solicitud_id, accesorios_entregados, condicion_entrega } = req.body || {};
    const lista = Array.isArray(accesorios_entregados) ? accesorios_entregados.map(String) : [];
    const s = await withTx(async (c) => {
      const { rows } = await c.query(
        `SELECT s.*, e.estado AS equipo_estado, e.nombre AS equipo_nombre
         FROM solicitudes s JOIN equipos e ON e.id = s.equipo_id WHERE s.id = $1 FOR UPDATE OF s, e`,
        [solicitud_id]
      );
      const sol = rows[0];
      if (!sol) throw new HttpError(404, 'Solicitud no encontrada');
      if (sol.estado !== 'APROBADA') throw new HttpError(409, 'La solicitud no está aprobada para entrega');
      if (sol.equipo_estado !== 'DISPONIBLE') throw new HttpError(409, 'El equipo no está disponible');
      await c.query(`UPDATE equipos SET estado='PRESTADO' WHERE id=$1`, [sol.equipo_id]);
      await c.query(`UPDATE solicitudes SET estado='ENTREGADA' WHERE id=$1`, [sol.id]);
      const ins = await c.query(
        `INSERT INTO prestamos (solicitud_id, fecha_limite, condicion_entrega, accesorios_entregados)
         VALUES ($1, now() + make_interval(hours => $2), $3, $4::jsonb) RETURNING *`,
        [sol.id, sol.horas_estimadas, condicion_entrega || 'BUENO', JSON.stringify(lista)]
      );
      return { sol, prestamo: ins.rows[0] };
    });
    const limite = new Date(s.prestamo.fecha_limite).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
    notifyUser(s.sol.usuario_id, {
      titulo: 'Equipo entregado',
      cuerpo: `Recibiste ${s.sol.equipo_nombre}. Devuélvelo antes de: ${limite}.`,
      data: { tipo: 'ENTREGADO', prestamo_id: s.prestamo.id },
    });
    res.status(201).json(s.prestamo);
  })
);

// RF-08 / RF-09: registrar devolución. Si llega DAÑADO → equipo a MANTENIMIENTO + reporte automático.
router.patch(
  '/devolucion',
  requireRol(...TI),
  wrap(async (req, res) => {
    const { prestamo_id, accesorios_devueltos, condicion_devolucion, observaciones } = req.body || {};
    if (!['BUENO', 'DANADO'].includes(condicion_devolucion))
      throw new HttpError(400, 'La condición debe ser BUENO o DANADO');
    const obs = String(observaciones || '').trim();
    if (condicion_devolucion === 'DANADO' && !obs) throw new HttpError(400, 'Describe la falla del equipo dañado');
    const devueltos = Array.isArray(accesorios_devueltos) ? accesorios_devueltos.map(String) : [];

    const r = await withTx(async (c) => {
      const { rows } = await c.query(
        `SELECT p.*, s.usuario_id, s.equipo_id, e.nombre AS equipo_nombre
         FROM prestamos p JOIN solicitudes s ON s.id = p.solicitud_id JOIN equipos e ON e.id = s.equipo_id
         WHERE p.id = $1 FOR UPDATE OF p, s, e`,
        [prestamo_id]
      );
      const p = rows[0];
      if (!p) throw new HttpError(404, 'Préstamo no encontrado');
      if (p.fecha_devolucion) throw new HttpError(409, 'Este préstamo ya fue devuelto');

      const faltantes = p.accesorios_entregados.filter((a) => !devueltos.includes(a));
      const partes = [];
      if (faltantes.length) partes.push('Accesorios faltantes: ' + faltantes.join(', '));
      if (obs) partes.push(obs);

      await c.query(
        `UPDATE prestamos SET fecha_devolucion=now(), condicion_devolucion=$2, observaciones_accesorios=$3, accesorios_devueltos=$4::jsonb WHERE id=$1`,
        [p.id, condicion_devolucion, partes.join(' | ') || null, JSON.stringify(devueltos)]
      );
      await c.query(`UPDATE solicitudes SET estado='DEVUELTA' WHERE id=$1`, [p.solicitud_id]);
      if (condicion_devolucion === 'DANADO') {
        await c.query(`UPDATE equipos SET estado='MANTENIMIENTO' WHERE id=$1`, [p.equipo_id]);
        await c.query(`INSERT INTO mantenimientos (equipo_id, prestamo_id, descripcion_falla) VALUES ($1,$2,$3)`, [
          p.equipo_id,
          p.id,
          obs,
        ]);
      } else {
        await c.query(`UPDATE equipos SET estado='DISPONIBLE' WHERE id=$1`, [p.equipo_id]);
      }
      return { p, faltantes };
    });

    const { p, faltantes } = r;
    notifyUser(p.usuario_id, {
      titulo: 'Devolución registrada',
      cuerpo:
        `Registramos la devolución de ${p.equipo_nombre}.` +
        (faltantes.length ? ` Faltan accesorios: ${faltantes.join(', ')}.` : ' ¡Gracias!'),
      data: { tipo: 'DEVUELTO', prestamo_id: p.id },
    });
    if (condicion_devolucion === 'DANADO') {
      notifyRoles(TI, {
        titulo: 'Equipo enviado a mantenimiento',
        cuerpo: `${p.equipo_nombre} regresó dañado: ${obs}`,
        data: { tipo: 'MANTENIMIENTO', equipo_id: p.equipo_id },
      });
    }
    res.json({ ok: true, faltantes, mantenimiento: condicion_devolucion === 'DANADO' });
  })
);

const SELECT_PRESTAMO = `
  SELECT p.*, s.motivo, s.horas_estimadas, e.id AS equipo_id, e.nombre AS equipo_nombre, e.numero_serie, e.codigo_qr,
         c.icono, u.nombre AS usuario_nombre
  FROM prestamos p JOIN solicitudes s ON s.id = p.solicitud_id JOIN equipos e ON e.id = s.equipo_id
  LEFT JOIN categorias c ON c.id = e.categoria_id JOIN usuarios u ON u.id = s.usuario_id`;

// Mis préstamos activos
router.get(
  '/activos',
  wrap(async (req, res) => {
    const { rows } = await query(
      `${SELECT_PRESTAMO} WHERE s.usuario_id = $1 AND p.fecha_devolucion IS NULL ORDER BY p.fecha_limite`,
      [req.user.id]
    );
    res.json(rows);
  })
);

// Mi historial
router.get(
  '/historial',
  wrap(async (req, res) => {
    const { rows } = await query(
      `${SELECT_PRESTAMO} WHERE s.usuario_id = $1 ORDER BY p.fecha_entrega DESC LIMIT 100`,
      [req.user.id]
    );
    res.json(rows);
  })
);

// Mis estadísticas (Perfil)
router.get(
  '/resumen',
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS prestamos,
              COUNT(*) FILTER (WHERE (p.fecha_devolucion IS NOT NULL AND p.fecha_devolucion > p.fecha_limite)
                                  OR (p.fecha_devolucion IS NULL AND now() > p.fecha_limite))::int AS atrasos
       FROM prestamos p JOIN solicitudes s ON s.id = p.solicitud_id WHERE s.usuario_id = $1`,
      [req.user.id]
    );
    res.json(rows[0]);
  })
);

// TI: todos los préstamos vigentes
router.get(
  '/vigentes',
  requireRol(...TI),
  wrap(async (req, res) => {
    const { rows } = await query(`${SELECT_PRESTAMO} WHERE p.fecha_devolucion IS NULL ORDER BY p.fecha_limite`);
    res.json(rows);
  })
);

module.exports = router;
