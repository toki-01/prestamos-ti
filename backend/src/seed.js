require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

(async () => {
  const hash = await bcrypt.hash('Demo1234', 10);
  const usuarios = [
    ['Administrador', 'admin@demo.com', 'ADMIN', 'Docente'],
    ['Soporte TI', 'ti@demo.com', 'SOPORTE_TI', 'Docente'],
    ['Alejandro', 'docente@demo.com', 'SOLICITANTE', 'Docente'],
  ];
  for (const [n, c, r, t] of usuarios)
    await pool.query(
      `INSERT INTO usuarios (nombre, correo, password_hash, rol, tipo) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (correo) DO NOTHING`,
      [n, c, hash, r, t]
    );

  const cats = [
    ['Lab iOS', 'laptop'],
    ['Cañones', 'projector'],
    ['Audiovisual', 'headphones'],
    ['Adaptadores', 'cable'],
  ];
  for (const [n, i] of cats)
    await pool.query('INSERT INTO categorias (nombre, icono) VALUES ($1,$2) ON CONFLICT (nombre) DO NOTHING', [n, i]);
  const catId = async (n) => (await pool.query('SELECT id FROM categorias WHERE nombre=$1', [n])).rows[0].id;

  const equipos = [
    ['MacBook Pro M2', 'MAC-LAB-012', 'Lab iOS', 'Laboratorio iOS', ['Cargador MagSafe 3', 'Adaptador USB-C a USB-A/HDMI', 'Magic Mouse 2']],
    ['MacBook Pro M2', 'MAC-LAB-013', 'Lab iOS', 'Laboratorio iOS', ['Cargador MagSafe 3', 'Adaptador USB-C a USB-A/HDMI']],
    ['Cañón Epson X49', 'CAN-001', 'Cañones', 'Almacén', ['Cable HDMI', 'Cable de corriente', 'Control remoto']],
    ['Bocina Bluetooth JBL', 'AUD-001', 'Audiovisual', 'Almacén', ['Cable de carga USB-C']],
    ['Adaptador USB-C Multipuerto', 'ADP-001', 'Adaptadores', 'Almacén', []],
  ];
  for (const [nombre, serie, cat, ubic, acc] of equipos) {
    const r = await pool.query(
      `INSERT INTO equipos (nombre, numero_serie, categoria_id, ubicacion) VALUES ($1,$2,$3,$4)
       ON CONFLICT (numero_serie) DO NOTHING RETURNING id`,
      [nombre, serie, await catId(cat), ubic]
    );
    if (r.rows[0])
      for (const a of acc) await pool.query('INSERT INTO accesorios (equipo_id, nombre_accesorio) VALUES ($1,$2)', [r.rows[0].id, a]);
  }
  console.log('Datos de ejemplo listos. Usuarios: admin@demo.com / ti@demo.com / docente@demo.com (contraseña: Demo1234)');
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
