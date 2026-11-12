const router = require('express').Router();
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { query, withTx } = require('../db');
const { auth, requireRol, TI } = require('../middleware/auth');
const { wrap, HttpError, UUID_RE } = require('../utils');

router.use(auth);

// Categorías con conteo (Catálogo Rápido del Inicio)
router.get(
  '/categorias/resumen',
  wrap(async (req, res) => {
    const { rows } = await query(`
      SELECT c.id, c.nombre, c.icono,
             COUNT(e.id)::int AS total,
             COUNT(e.id) FILTER (WHERE e.estado = 'DISPONIBLE')::int AS disponibles
      FROM categorias c LEFT JOIN equipos e ON e.categoria_id = c.id
      GROUP BY c.id ORDER BY c.id`);
    res.json(rows);
  })
);

router.post(
  '/categorias',
  requireRol(...TI),
  wrap(async (req, res) => {
    const { nombre, icono } = req.body || {};
    if (!nombre) throw new HttpError(400, 'El nombre es obligatorio');
    const { rows } = await query('INSERT INTO categorias (nombre, icono) VALUES ($1, $2) RETURNING *', [
      nombre.trim(),
      icono || 'laptop',
    ]);
    res.status(201).json(rows[0]);
  })
);

// RF-04: resolver un QR (solo contiene un UUID, RNF-01) → detalles + disponibilidad
router.get(
  '/qr/:uuid',
  wrap(async (req, res) => {
    if (!UUID_RE.test(req.params.uuid)) throw new HttpError(400, 'Código QR no válido');
    const { rows } = await query(
      `SELECT e.id, e.nombre, e.numero_serie, e.codigo_qr, e.estado, e.ubicacion,
              c.nombre AS categoria, c.icono
       FROM equipos e LEFT JOIN categorias c ON c.id = e.categoria_id WHERE e.codigo_qr = $1`,
      [req.params.uuid]
    );
    const equipo = rows[0];
    if (!equipo) throw new HttpError(404, 'Este código QR no corresponde a ningún equipo');
    const acc = await query('SELECT id, nombre_accesorio FROM accesorios WHERE equipo_id = $1 ORDER BY id', [equipo.id]);
    equipo.accesorios = acc.rows;
    res.json(equipo);
  })
);

router.get(
  '/',
  wrap(async (req, res) => {
    const params = [];
    const where = [];
    if (req.query.categoria_id) {
      params.push(Number(req.query.categoria_id));
      where.push(`e.categoria_id = $${params.length}`);
    }
    if (req.query.estado) {
      params.push(req.query.estado);
      where.push(`e.estado = $${params.length}::estado_equipo`);
    }
    const { rows } = await query(
      `SELECT e.id, e.nombre, e.numero_serie, e.codigo_qr, e.estado, e.ubicacion, c.nombre AS categoria, c.icono,
              (SELECT COUNT(*)::int FROM accesorios a WHERE a.equipo_id = e.id) AS num_accesorios
       FROM equipos e LEFT JOIN categorias c ON c.id = e.categoria_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.nombre`,
      params
    );
    res.json(rows);
  })
);

// RF-02: registrar equipo con lista dinámica de accesorios. El UUID del QR se autogenera (único).
router.post(
  '/',
  requireRol(...TI),
  wrap(async (req, res) => {
    const { nombre, numero_serie, categoria_id, ubicacion, accesorios } = req.body || {};
    if (!nombre || !numero_serie) throw new HttpError(400, 'Nombre y número de serie son obligatorios');
    const lista = (Array.isArray(accesorios) ? accesorios : [])
      .map((a) => String(a).trim())
      .filter(Boolean);
    try {
      const equipo = await withTx(async (c) => {
        const { rows } = await c.query(
          `INSERT INTO equipos (nombre, numero_serie, categoria_id, ubicacion) VALUES ($1,$2,$3,$4) RETURNING *`,
          [nombre.trim(), numero_serie.trim(), categoria_id || null, ubicacion || null]
        );
        for (const a of lista)
          await c.query('INSERT INTO accesorios (equipo_id, nombre_accesorio) VALUES ($1,$2)', [rows[0].id, a]);
        return rows[0];
      });
      equipo.accesorios = lista;
      res.status(201).json(equipo);
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'Ya existe un equipo con ese número de serie');
      throw e;
    }
  })
);

// RF-03: etiqueta QR en PDF. Reimprimir siempre genera el MISMO UUID.
router.get(
  '/:id/qr.pdf',
  requireRol(...TI),
  wrap(async (req, res) => {
    const { rows } = await query('SELECT nombre, numero_serie, codigo_qr FROM equipos WHERE id = $1', [req.params.id]);
    const e = rows[0];
    if (!e) throw new HttpError(404, 'Equipo no encontrado');
    const png = await QRCode.toBuffer(e.codigo_qr, { width: 400, margin: 1, errorCorrectionLevel: 'M' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="qr-${e.numero_serie}.pdf"`);
    const doc = new PDFDocument({ size: [288, 200], margin: 12 });
    doc.pipe(res);
    doc.image(png, 12, 12, { width: 176 });
    doc.fillColor('#0f172a').fontSize(11).text(e.nombre, 196, 24, { width: 82 });
    doc.moveDown(0.5).fillColor('#64748b').fontSize(8).text('S/N: ' + e.numero_serie, { width: 82 });
    doc.fillColor('#94a3b8').fontSize(6).text('Préstamos TI · Campus Tapachula', 196, 176, { width: 82 });
    doc.end();
  })
);

router.get(
  '/:id',
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT e.*, c.nombre AS categoria, c.icono FROM equipos e LEFT JOIN categorias c ON c.id = e.categoria_id WHERE e.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) throw new HttpError(404, 'Equipo no encontrado');
    const acc = await query('SELECT id, nombre_accesorio FROM accesorios WHERE equipo_id = $1 ORDER BY id', [req.params.id]);
    res.json({ ...rows[0], accesorios: acc.rows });
  })
);

module.exports = router;
