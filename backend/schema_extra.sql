-- Extensiones al esquema base (notificaciones y recordatorios)
ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS recordatorio_enviado BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS vencido_notificado BOOLEAN NOT NULL DEFAULT FALSE;

-- Bandeja de notificaciones dentro de la app (campana del Inicio)
CREATE TABLE IF NOT EXISTS notificaciones (
  id SERIAL PRIMARY KEY,
  usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  cuerpo TEXT NOT NULL,
  leida BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_usuario ON notificaciones(usuario_id, leida);
