require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { iniciarJobs } = require('./jobs');

if (!process.env.JWT_SECRET || !process.env.DATABASE_URL) {
  console.error('Faltan JWT_SECRET o DATABASE_URL en el archivo .env');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/equipos', require('./routes/equipos'));
app.use('/api/solicitudes', require('./routes/solicitudes'));
app.use('/api/prestamos', require('./routes/prestamos'));
app.use('/api/mantenimientos', require('./routes/mantenimientos'));
app.use('/api/notificaciones', require('./routes/notificaciones'));
app.use('/api/admin', require('./routes/admin'));

app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (err.code === '23505') return res.status(409).json({ error: 'Registro duplicado o conflicto de disponibilidad' });
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const port = process.env.PORT || 4000;
app.listen(port, '0.0.0.0', () => {
  console.log(`API de préstamos escuchando en el puerto ${port}`);
  iniciarJobs();
});
