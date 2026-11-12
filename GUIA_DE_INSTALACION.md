# Guía de instalación: Préstamos TI

Esta versión ya trae integrados `google-services.json` (proyecto Firebase `prestamo-ti`) y la dirección del servidor `http://192.168.100.61:4000`.

> Si tu IP cambia (por ejemplo, otra red Wi-Fi), edita `mobile/app.json` → `extra.apiUrl` y genera el APK otra vez, porque esa dirección queda guardada dentro del APK.

## 1. Requisitos
- Node.js 18 o superior
- PostgreSQL (recuerda la contraseña del usuario `postgres`)
- Cuenta de Expo (`eas login`)

## 2. Base de datos y backend

```
psql -U postgres -c "CREATE DATABASE prestamos;"
cd backend
cp .env.example .env
```

Edita `.env`:
- `DATABASE_URL=postgres://postgres:TU_CONTRASEÑA@localhost:5432/prestamos`
- `JWT_SECRET=` un texto largo cualquiera
- (Opcional) `GMAIL_USER` y `GMAIL_APP_PASSWORD` para los correos

Después:

```
npm install
npm run migrate
npm run seed
npm start
```

Comprueba que responde en `http://localhost:4000/api/health`. Debe mostrar `{"ok":true}`.
Deja esta terminal abierta. El celular y la PC deben estar en la misma red Wi-Fi.

Si el celular no conecta, abre el puerto 4000 en el firewall de tu PC.

## 3. Generar el APK

```
cd mobile
npm install
npm i -g eas-cli
eas login
eas build -p android --profile preview
```

Si es la primera vez, `eas build` te preguntará si quieres crear o vincular el proyecto de Expo. Acepta, y se agregará un `projectId` en `app.json`.
Cuando termine, descarga el `.apk` desde el enlace, desinstala cualquier versión anterior e instala la nueva.

## 4. Activar las notificaciones push (una sola vez)

El APK ya incluye `google-services.json`, pero Expo necesita además la clave de servicio de Firebase para enviar las push:

1. En Firebase: Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada. Se descarga un JSON.
2. En la terminal, dentro de `mobile/`, ejecuta `eas credentials`.
3. Elige Android, luego el perfil de build, y busca la opción de la clave de servicio de Google para notificaciones push (FCM V1). Sube ahí el JSON.

Las push solo llegan a celulares físicos con el APK instalado.

## 5. Usuarios de prueba

| Rol | Correo | Contraseña |
|---|---|---|
| Solicitante (docente o alumno) | docente@demo.com | Demo1234 |
| Soporte TI | ti@demo.com | Demo1234 |
| Administrador | admin@demo.com | Demo1234 |

Para ver el UUID del QR de cada equipo:

```
psql -U postgres -d prestamos -c "select nombre, codigo_qr from equipos;"
```

Puedes convertir ese UUID en un QR con cualquier generador en línea y escanearlo con la app. La pantalla del escáner también permite escribirlo a mano.

## 6. Si la app falla

**Se cierra al abrir:** conecta el celular por USB con la depuración activada y ejecuta:

```
adb logcat -c
(abre la app)
adb logcat -d | grep -i "javascriptexception" | head -3
```

Pega la línea que salga para ver el motivo exacto.

**"No se pudo conectar con el servidor":**
- El backend no está corriendo (`npm start`).
- El celular está en otra red Wi-Fi.
- La IP de `app.json` no coincide con la de tu PC (revísala con `ip a`).
- El firewall bloquea el puerto 4000.

**Las push no llegan:** revisa el paso 4 y que el celular haya aceptado el permiso de notificaciones.
