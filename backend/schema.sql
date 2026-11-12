CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE rol_usuario AS ENUM ('SOLICITANTE', 'SOPORTE_TI', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE estado_equipo AS ENUM ('DISPONIBLE', 'PRESTADO', 'MANTENIMIENTO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE estado_solicitud AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'ENTREGADA', 'DEVUELTA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  correo TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  rol rol_usuario NOT NULL DEFAULT 'SOLICITANTE',
  tipo TEXT NOT NULL DEFAULT 'Docente',          -- Alumno / Docente
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  push_token TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categorias (
  id SERIAL PRIMARY KEY,
  nombre TEXT UNIQUE NOT NULL,
  icono TEXT NOT NULL DEFAULT 'laptop'
);

CREATE TABLE IF NOT EXISTS equipos (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  numero_serie TEXT UNIQUE NOT NULL,
  codigo_qr UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),   -- RNF-01: el QR solo contiene este UUID
  estado estado_equipo NOT NULL DEFAULT 'DISPONIBLE',
  categoria_id INT REFERENCES categorias(id),
  ubicacion TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accesorios (
  id SERIAL PRIMARY KEY,
  equipo_id INT NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
  nombre_accesorio TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS solicitudes (
  id SERIAL PRIMARY KEY,
  equipo_id INT NOT NULL REFERENCES equipos(id),
  usuario_id INT NOT NULL REFERENCES usuarios(id),
  responsable_id INT REFERENCES usuarios(id),
  motivo TEXT NOT NULL,
  horas_estimadas INT NOT NULL CHECK (horas_estimadas BETWEEN 1 AND 8),
  estado estado_solicitud NOT NULL DEFAULT 'PENDIENTE',
  motivo_rechazo TEXT,
  fecha_solicitud TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_resolucion TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS prestamos (
  id SERIAL PRIMARY KEY,
  solicitud_id INT UNIQUE NOT NULL REFERENCES solicitudes(id),
  fecha_entrega TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_limite TIMESTAMPTZ NOT NULL,
  fecha_devolucion TIMESTAMPTZ,
  condicion_entrega TEXT NOT NULL DEFAULT 'BUENO',
  condicion_devolucion TEXT,                       -- BUENO / DANADO
  observaciones_accesorios TEXT,
  accesorios_entregados JSONB NOT NULL DEFAULT '[]',
  accesorios_devueltos JSONB
);

CREATE TABLE IF NOT EXISTS mantenimientos (
  id SERIAL PRIMARY KEY,
  equipo_id INT NOT NULL REFERENCES equipos(id),
  prestamo_id INT REFERENCES prestamos(id),
  descripcion_falla TEXT NOT NULL,
  fecha_reporte TIMESTAMPTZ NOT NULL DEFAULT now(),
  resuelto BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_resolucion TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_estado ON solicitudes(estado);
CREATE INDEX IF NOT EXISTS idx_equipos_qr ON equipos(codigo_qr);
-- Un equipo solo puede tener un préstamo/solicitud aprobada o entregada a la vez (RNF-02)
CREATE UNIQUE INDEX IF NOT EXISTS uq_equipo_solicitud_activa
  ON solicitudes(equipo_id) WHERE estado IN ('APROBADA', 'ENTREGADA');
