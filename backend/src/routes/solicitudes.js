const router = require('express').Router();
const { query, withTx } = require('../db');
const { auth, requireRol, TI } = require('../middleware/auth');
const { wrap, HttpError } = require('../utils');
const { notifyUser, notifyRoles } = require('../services/notify');

router.use(auth);

// RF-05: crear solicitud con motivo y tiempo de uso
router.post(
  '/',
  wrap(async (req, res) => {
    const { equipo_id, motivo, horas_estimadas } = req.body || {};
    const horas = Number(horas_estimadas);
    if (!equipo_id || !motivo || !Number.isInteger(horas) || horas < 1 || horas > 8)
      throw new HttpError(400, 'Indica el equipo, el motivo y un tiempo de uso entre 1 y 8 horas');

    const { rows } = await query('SELECT id, nombre, estado FROM equipos WHERE id = $1', [equipo_id]);
    const equipo = rows[0];
    if (!equipo) throw new HttpError(404, 'Equipo no encontrado');
    if (equipo.estado !== 'DISPONIBLE') throw new HttpError(409, `El equipo no está disponible (${equipo.estado})`);

    const dup = await query(
      `SELECT 1 FROM solicitudes WHERE equipo_id = $1 AND usuario_id = $2 AND estado IN ('PENDIENTE','APROBADA')`,
      [equipo_id, req.user.id]
    );
    if (dup.rowCount) throw new HttpError(409, 'Ya tienes una solicitud activa para este equipo');

    const ins = await query(
      `INSERT INTO solicitudes (equipo_id, usuario_id, motivo, horas_estimadas) VALUES ($1,$2,$3,$4) RETURNING *`,
      [equipo_id, req.user.id, String(motivo).trim(), horas]
    );
    notifyRoles(TI, {
      titulo: 'Nueva solicitud de préstamo',
      cuerpo: `${req.user.nombre} solicitó ${equipo.nombre} por ${horas} h (${motivo}).`,
      data: { tipo: 'SOLICITUD_NUEVA', solicitud_id: ins.rows[0].id },
    });
    res.status(201).json(ins.rows[0]);
  })
);

// Mis solicitudes
router.get(
  '/mias',
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT s.*, e.nombre AS equipo_nombre, e.numero_serie, p.id AS prestamo_id, p.fecha_limite
       FROM solicitudes s JOIN equipos e ON e.id = s.equipo_id LEFT JOIN prestamos p ON p.solicitud_id = s.id
       WHERE s.usuario_id = $1 ORDER BY s.fecha_solicitud DESC LIMIT 100`,
      [req.user.id]
    );
    res.json(rows);
  })
);

// Bandeja de TI (por defecto pendientes)
router.get(
  '/',
  requireRol(...TI),
  wrap(async (req, res) => {
    const estado = req.query.estado || 'PENDIENTE';
    const { rows } = await query(
      `SELECT s.*, e.nombre AS equipo_nombre, e.numero_serie, e.codigo_qr, u.nombre AS usuario_nombre, u.correo AS usuario_correo
       FROM solicitudes s JOIN equipos e ON e.id = s.equipo_id JOIN usuarios u ON u.id = s.usuario_id
       WHERE s.estado = $1::estado_solicitud ORDER BY s.fecha_solicitud ASC`,
      [estado]
    );
    res.json(rows);
  })
);

// RF-06: aprobar (con bloqueo de fila para evitar doble préstamo, RNF-02)
router.post(
  '/:id/aprobar',
  requireRol(...TI),
  wrap(async (req, res) => {
    const s = await withTx(async (c) => {
      const { rows } = await c.query(
        `SELECT s.*, e.estado AS equipo_estado, e.nombre AS equipo_nombre
         FROM solicitudes s JOIN equipos e ON e.id = s.equipo_id WHERE s.id = $1 FOR UPDATE OF s, e`,
        [req.params.id]
      );
      const sol = rows[0];
      if (!sol) throw new HttpError(404, 'Solicitud no encontrada');
      if (sol.estado !== 'PENDIENTE') throw new HttpError(409, 'La solicitud ya fue procesada');
      if (sol.equipo_estado !== 'DISPONIBLE') throw new HttpError(409, 'El equipo ya no está disponible');
      await c.query(
        `UPDATE solicitudes SET estado='APROBADA', responsable_id=$2, fecha_resolucion=now() WHERE id=$1`,
        [sol.id, req.user.id]
      );
      return sol;
    });
    notifyUser(s.usuario_id, {
      titulo: '¡Solicitud aprobada!',
      cuerpo: `Tu solicitud de ${s.equipo_nombre} fue aprobada. Pasa al laboratorio para recogerla.`,
      data: { tipo: 'SOLICITUD_APROBADA', solicitud_id: s.id },
    });
    res.json({ ok: true });
  })
);

router.post(
  '/:id/rechazar',
  requireRol(...TI),
  wrap(async (req, res) => {
    const motivo = String((req.body && req.body.motivo_rechazo) || '').trim() || 'Sin motivo especificado';
    const { rows } = await query(
      `UPDATE solicitudes s SET estado='RECHAZADA', motivo_rechazo=$2, responsable_id=$3, fecha_resolucion=now()
       FROM equipos e WHERE s.id=$1 AND s.estado='PENDIENTE' AND e.id=s.equipo_id
       RETURNING s.id, s.usuario_id, e.nombre AS equipo_nombre`,
      [req.params.id, motivo, req.user.id]
    );
    if (!rows[0]) throw new HttpError(409, 'La solicitud no existe o ya fue procesada');
    notifyUser(rows[0].usuario_id, {
      titulo: 'Solicitud rechazada',
      cuerpo: `Tu solicitud de ${rows[0].equipo_nombre} fue rechazada. Motivo: ${motivo}`,
      data: { tipo: 'SOLICITUD_RECHAZADA', solicitud_id: rows[0].id },
    });
    res.json({ ok: true });
  })
);

// El solicitante cancela su propia solicitud (pendiente o aprobada sin entregar)
router.post(
  '/:id/cancelar',
  wrap(async (req, res) => {
    const { rowCount } = await query(
      `UPDATE solicitudes SET estado='RECHAZADA', motivo_rechazo='Cancelada por el solicitante', fecha_resolucion=now()
       WHERE id=$1 AND usuario_id=$2 AND estado IN ('PENDIENTE','APROBADA')`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) throw new HttpError(409, 'No se puede cancelar esta solicitud');
    res.json({ ok: true });
  })
);

module.exports = router;
