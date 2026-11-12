const nodemailer = require('nodemailer');
const { query } = require('../db');

/* ---------- Correo (Gmail SMTP con contraseña de aplicación) ---------- */
let transporter;
function getTransporter() {
  if (transporter !== undefined) return transporter;
  const user = process.env.GMAIL_USER;
  const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s/g, '');
  if (!user || !pass || user.includes('tu_cuenta') || pass.startsWith('xxxx')) {
    console.warn('[notify] Gmail no configurado: los correos se omitirán.');
    transporter = null;
  } else {
    transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  }
  return transporter;
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function plantilla(titulo, cuerpo) {
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#2563eb,#1e40af);color:#fff;padding:20px 24px"><h2 style="margin:0;font-size:18px">${esc(titulo)}</h2></div>
    <div style="padding:24px;color:#334155;font-size:15px;line-height:1.5">${esc(cuerpo)}</div>
    <div style="padding:12px 24px;background:#f8fafc;color:#94a3b8;font-size:12px">Sistema de Préstamo de Equipo · Campus Tapachula</div>
  </div>`;
}

async function sendMail(to, subject, texto) {
  const t = getTransporter();
  if (!t || !to) return;
  try {
    await t.sendMail({
      from: `"${process.env.MAIL_FROM_NAME || 'Préstamos TI'}" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      text: texto,
      html: plantilla(subject, texto),
    });
  } catch (e) {
    console.error('[notify] Error enviando correo:', e.message);
  }
}

/* ---------- Push (Expo Push Service → FCM en Android) ---------- */
async function sendPush(token, title, body, data = {}) {
  if (!token || !/^Expo(nent)?PushToken\[/.test(token)) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ to: token, title, body, data, sound: 'default', channelId: 'default', priority: 'high' }),
    });
  } catch (e) {
    console.error('[notify] Error enviando push:', e.message);
  }
}

/* ---------- API pública: nunca lanza errores ---------- */
// payload = { titulo, cuerpo, data? }
async function notifyUser(usuarioId, { titulo, cuerpo, data }) {
  try {
    const { rows } = await query('SELECT id, correo, push_token FROM usuarios WHERE id = $1 AND activo', [usuarioId]);
    const u = rows[0];
    if (!u) return;
    await query('INSERT INTO notificaciones (usuario_id, titulo, cuerpo) VALUES ($1, $2, $3)', [u.id, titulo, cuerpo]);
    await Promise.all([sendPush(u.push_token, titulo, cuerpo, data), sendMail(u.correo, titulo, cuerpo)]);
  } catch (e) {
    console.error('[notify] notifyUser falló:', e.message);
  }
}

async function notifyRoles(roles, payload) {
  try {
    const { rows } = await query('SELECT id FROM usuarios WHERE rol = ANY($1::rol_usuario[]) AND activo', [roles]);
    await Promise.all(rows.map((r) => notifyUser(r.id, payload)));
  } catch (e) {
    console.error('[notify] notifyRoles falló:', e.message);
  }
}

module.exports = { notifyUser, notifyRoles };
