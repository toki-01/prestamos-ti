const { query } = require('./db');
const { notifyUser, notifyRoles } = require('./services/notify');

const TI = ['SOPORTE_TI', 'ADMIN'];

// Recordatorios automáticos: 15 min antes del límite y cuando vence el préstamo
async function revisarPrestamos() {
  try {
    const porVencer = await query(`
      UPDATE prestamos p SET recordatorio_enviado = TRUE
      FROM solicitudes s JOIN equipos e ON e.id = s.equipo_id
      WHERE s.id = p.solicitud_id AND p.fecha_devolucion IS NULL AND NOT p.recordatorio_enviado
        AND p.fecha_limite > now() AND p.fecha_limite <= now() + interval '15 minutes'
      RETURNING p.id, s.usuario_id, e.nombre AS equipo`);
    for (const r of porVencer.rows)
      notifyUser(r.usuario_id, {
        titulo: 'Tu préstamo está por terminar',
        cuerpo: `${r.equipo} debe devolverse en menos de 15 minutos.`,
        data: { tipo: 'POR_VENCER', prestamo_id: r.id },
      });

    const vencidos = await query(`
      UPDATE prestamos p SET vencido_notificado = TRUE
      FROM solicitudes s JOIN equipos e ON e.id = s.equipo_id
      WHERE s.id = p.solicitud_id AND p.fecha_devolucion IS NULL AND NOT p.vencido_notificado AND p.fecha_limite < now()
      RETURNING p.id, s.usuario_id, e.nombre AS equipo, (SELECT nombre FROM usuarios WHERE id = s.usuario_id) AS usuario`);
    for (const r of vencidos.rows) {
      notifyUser(r.usuario_id, {
        titulo: 'Préstamo vencido',
        cuerpo: `El tiempo de ${r.equipo} ya venció. Devuélvelo lo antes posible.`,
        data: { tipo: 'VENCIDO', prestamo_id: r.id },
      });
      notifyRoles(TI, {
        titulo: 'Préstamo vencido',
        cuerpo: `${r.usuario} no ha devuelto ${r.equipo} a tiempo.`,
        data: { tipo: 'VENCIDO_TI', prestamo_id: r.id },
      });
    }
  } catch (e) {
    console.error('[jobs] revisión falló:', e.message);
  }
}

function iniciarJobs() {
  revisarPrestamos();
  return setInterval(revisarPrestamos, 5 * 60 * 1000);
}

module.exports = { iniciarJobs };
