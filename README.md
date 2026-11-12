# Préstamos TI — App Android + API

Sistema móvil de préstamo de equipo de cómputo y audiovisual con códigos QR (MVP del Plan Maestro) más
**notificaciones push** y **notificaciones por correo (Gmail)**.

```
backend/   API REST (Node.js + Express + PostgreSQL)
mobile/    App Android (React Native + Expo), diseño basado en tu prototipo
```

## Qué incluye

**MVP (RF-01 a RF-09):** login con roles (Solicitante / Soporte TI / Admin), registro de equipos con lista dinámica de
accesorios, QR autogenerado (solo contiene un UUID) e impresión en PDF, escaneo con cámara, solicitudes con flujo de
aprobación, entrega y devolución con checklist de accesorios, y reporte automático de mantenimiento cuando un equipo
regresa dañado (el equipo sale del flujo "Disponible"). Transacciones SQL con bloqueo de filas + índice único para evitar
doble préstamo (RNF-02).

**Extras que pediste:**
- Push (Expo Push → FCM) y correo (Gmail) en: nueva solicitud (a TI), aprobada/rechazada, entrega, devolución,
  equipo dañado (a TI/Admin), préstamo por vencer (15 min antes) y préstamo vencido.
- Bandeja de notificaciones dentro de la app (campana del Inicio con punto rojo).

**Extras menores:** panel de TI (aprobar/rechazar, por entregar, en préstamo, fallas), pantalla de administración
(estadísticas y roles), historial de uso, cancelar solicitud, ingreso manual del UUID si la cámara falla.

## 1. Backend

Requisitos: Node 18+ y PostgreSQL.

```bash
cd backend
cp .env.example .env        # edita DATABASE_URL, JWT_SECRET y Gmail
npm install
npm run migrate             # crea tablas
npm run seed                # (opcional) datos y usuarios de ejemplo
npm start                   # puerto 4000
```

Usuarios de ejemplo (contraseña `Demo1234`): `admin@demo.com`, `ti@demo.com`, `docente@demo.com`.

### Gmail
1. Activa la verificación en dos pasos en la cuenta de Google.
2. Crea una **Contraseña de aplicación** (myaccount.google.com → Seguridad → Contraseñas de aplicaciones).
3. Ponla en `GMAIL_APP_PASSWORD` y el correo en `GMAIL_USER`. Si no se configura, el servidor simplemente omite los correos.

> Gmail limita ~500 correos/día. Para volumen mayor usa un servicio transaccional.

## 2. App móvil

```bash
cd mobile
npm install
npx expo install --fix      # alinea las versiones de Expo
```

Edita `app.json → expo.extra.apiUrl` con la URL de tu API:
- Emulador Android: `http://10.0.2.2:4000`
- Celular físico en la misma red: `http://IP_DE_TU_PC:4000`
- Producción: usa **HTTPS**.

Probar: `npx expo start` y abrir en el emulador/Expo Go.

### Generar el APK
```bash
npm i -g eas-cli
eas login
eas build:configure
eas build -p android --profile preview     # entrega un .apk instalable
```

### Activar las notificaciones push en el APK
Las push de Android requieren credenciales de Firebase (FCM):
1. Crea un proyecto en Firebase y registra la app Android con el paquete `mx.edu.prestamosti`.
2. Descarga `google-services.json`, colócalo en `mobile/` y agrega en `app.json → android`:
   `"googleServicesFile": "./google-services.json"`.
3. Sube la clave de servicio FCM v1 a Expo: `eas credentials` → Android → Push Notifications.
4. Reconstruye el APK. Las push no llegan a emuladores, solo a dispositivos físicos.

## Flujo de uso
1. **TI** registra un equipo (Panel → + Equipo) e imprime la etiqueta QR (PDF) con "Imprimir etiqueta".
2. **Solicitante** escanea el QR → ve disponibilidad y accesorios → solicita (motivo + horas).
3. **TI** recibe push/correo → aprueba en Panel → Pendientes.
4. **TI** escanea el QR (o Panel → Por entregar) → checklist → confirma entrega.
5. Al devolver, **TI** escanea de nuevo → marca accesorios uno a uno → "Dañado" exige describir la falla y manda el equipo a Mantenimiento.

## Pendiente para producción
- Subir la API a un servidor con HTTPS y PostgreSQL gestionado.
- Íconos/splash propios en `app.json`.
- Definir `ALLOWED_EMAIL_DOMAIN` para limitar el registro al correo institucional.
