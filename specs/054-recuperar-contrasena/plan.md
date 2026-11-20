# Plan de implementación: Recuperar la contraseña con una contraseña temporal

**Rama**: `dev` · **Fecha**: 2026-11-20 · **Spec**: [spec.md](./spec.md) · Rutas: back/ = agenda-backend, front/ = agenda-front

**Con migración** (la 061). La aplica el dueño del producto: para probar, en su base local; en producción, antes de
publicar el backend. Después, el backend y al final el front.

## Decisiones que salen del código

1. **La temporal del email es una contraseña aparte, no reemplaza a la de siempre.** Va en una tabla nueva
   (`temporary_passwords`) con su huella bcrypt, su vencimiento (1 hora) y si se usó. El inicio de sesión prueba
   primero la contraseña de siempre y, si no coincide, la temporal pendiente de la cuenta (o el hash de referencia, para
   tardar lo mismo). Así la de siempre sigue sirviendo (RF-003) y nadie deja afuera a otro.
2. **«Debe crear su contraseña» vive en la sesión.** `sessions.password_change_required` se marca al abrir la sesión
   con una temporal (la del email o la del soporte). Pasa por la verificación en dos pasos en
   `login_challenges.password_change_required`. La contraseña del soporte se marca en la cuenta
   (`users.password_change_required`): cualquier sesión que se abra con ella sale marcada hasta crear la propia.
3. **La barrera va donde ya está la de la sesión:** `requireSignedIn` (`/users`, `/images`, `/businesses`, `/admin`)
   y `/push` responden 403 `password_change_required` a una sesión marcada. En `/auth` sólo pasan la sesión, cerrar
   sesión, el modo de pantalla y crear la contraseña nueva; la verificación en dos pasos y el cambio con la actual,
   no. El front lo sabe por `Session.passwordChangeRequired`, como `twoFactorSetupRequired`.
4. **Crear la contraseña nueva es una ruta propia** (`POST /auth/new-password`): no pide la actual (ya entró con la
   temporal) y sólo atiende a una sesión marcada. Cambiarla en Perfil sigue siendo `POST /auth/change-password`, ahora
   para cualquier cuenta. Las dos devuelven la cookie nueva del dispositivo de confianza (spec 053), firmada con el hash
   nuevo.
5. **La misma respuesta siempre:** `POST /auth/forgot-password` responde 204 exista o no la cuenta, y hace el mismo
   trabajo (un bcrypt) en los dos casos. Los topes por email (3 por hora, 5 por día) usan `rate_limits` con la huella
   del email; pasado el tope no sale el email, pero la respuesta es la misma. El tope por conexión (10 por hora) es el
   429 de `limitRequests`, que no revela nada del email.
6. **WhatsApp sin que la API devuelva la contraseña:** el diálogo del super admin ya tiene la contraseña (la escribió o
   la generó en el navegador). Después de guardarla, arma el mensaje con `getWhatsAppUrl` (o `getShareWhatsAppUrl` sin
   teléfono). La API no la devuelve, no la guarda y no la registra.

## Diseño

1. **La migración** (`back/db/migrations/061_recuperar_contrasena.sql`):
   - `temporary_passwords`: `id`, `user_id` (`on delete cascade`), `password_hash`, `expires_at`, `used_at`,
     `created_at`; índice por `user_id`; con RLS;
   - `users.password_change_required boolean not null default false`;
   - `sessions.password_change_required` y `login_challenges.password_change_required`, `boolean not null default
     false`.

   Las cuentas que ya existen quedan en `false`: nadie tiene que cambiar su contraseña al publicar.

2. **Lo compartido** (en front/, `npm run sync:shared` desde back/):
   - **las validaciones** (`lib/validations/auth.ts`): `forgotPasswordSchema` (email y `captchaToken`) y
     `newPasswordSchema` (la nueva, mínimo 8, y confirmarla);
   - **los tipos:** `Session.passwordChangeRequired` y el `EmailType` `temporary_password`;
   - **las constantes:** `TEMPORARY_PASSWORD_MINUTES` (60), `TEMPORARY_PASSWORD_LENGTH` (10) y
     `TEMPORARY_PASSWORD_ALPHABET` (sin 0, O, 1, l ni I), con `generateTemporaryPassword()` (`crypto.getRandomValues`,
     sirve en el navegador y en Node);
   - **los emails:** `emailTemplates.temporaryPassword` («Tu contraseña temporal», con `credentials`, que sirve una
     vez, que vence en 1 hora, «si no fuiste tú…» y «Iniciar sesión»); `passwordChanged`, `teamInvite`,
     `platformAdminAdded` y `businessCreated` dicen que la contraseña es temporal y que al entrar se crea la propia;
   - **el mensaje de WhatsApp:** `buildTemporaryPasswordMessage({ firstName, email, password, loginUrl })`.

3. **La API:**
   - **`back/src/services/password-recovery.ts` (nuevo):**
     - `request(input, connection)`: valida; si la cuenta existe, está activa y no pasó los topes, en una transacción
       borra sus temporales sin usar, guarda la nueva y pone en cola el email (`secret` + `PASSWORD_MASK`, nivel
       equipo); siempre registra el pedido (`session.temporary_password_requested`, con `attemptedEmail` si no hay
       cuenta) y hace un bcrypt también sin cuenta;
     - `matchTemporary(db, userId, password)`: compara con la temporal pendiente y la marca usada de forma atómica
       (`update … where used_at is null and expires_at > now() returning`);
     - `setNewPassword(ctx, input, connection)`: sólo con la sesión marcada; distinta de la temporal (la del soporte es
       el hash actual; la del email, la última usada); guarda el hash, quita las marcas de la cuenta y de esta
       sesión, borra las demás sesiones y las temporales, registra `session.password_changed` («Creó su contraseña
       nueva») y envía el email de seguridad.
   - **`auth-service.ts`:**
     - `signIn`: la temporal si la de siempre no coincide (`session.temporary_login`; en un super admin, el
       email de seguridad a él y al dueño); con la de siempre, borra las temporales pendientes; la marca va a la
       sesión o al paso del código; sin cookie de dispositivo de confianza mientras esté marcada;
     - `verifyTwoFactor`: pasa la marca del paso del código a la sesión;
     - `changePassword`: para cualquier cuenta (no con la sesión marcada); también borra las temporales; el email de
       seguridad al super admin y al dueño, como hoy, y a las demás cuentas sólo a ellas;
     - `findSessionByToken` y `getSession`: leen y devuelven la marca.
   - **`account-alerts.ts`:** `session.temporary_login` en `ACCOUNT_CHANGES` (ntfy, sólo de super admins) y
     `queueOwnPasswordEmail(db, user, change, connection)`, que elige a quién avisar.
   - **`admin-service.ts`:** `setUserPassword` y las altas (propietario, miembro, super admin) marcan
     `users.password_change_required` y borran las temporales pendientes. `accounts.ts`: `createUserAccount` con la
     marca.
   - **Rutas y barrera:** `POST /auth/forgot-password` (`limitRequests` 10/hora y `requireCaptcha`) y `POST
     /auth/new-password` en `auth-routes.ts`; `requirePasswordChanged` en `http/session.ts`, dentro de
     `requireSignedIn`, en `/push` y en las rutas de `/auth` que no deben pasar. `password_change_required` (403) en
     `http/errors.ts`.
   - **La limpieza:** `deleteExpiredSessions` borra las temporales vencidas o usadas hace más de un día.
   - **La actividad:** las acciones nuevas en las etiquetas de Seguridad (back y front).

4. **El front:**
   - **`/forgot-password`:** el formulario (email, CAPTCHA con `useCaptcha` como el registro, «Enviar contraseña
     temporal»), el mensaje de siempre al enviarlo y, debajo, el contacto del soporte;
   - **`NewPasswordScreen`** (`front/src/features/auth/new-password-screen.tsx`): «Crea tu contraseña nueva», la nueva,
     confirmarla, «Guardar y entrar» y «Cerrar sesión»; en `admin-layout.tsx` y `dashboard-layout.tsx` antes que
     todo (también antes de la pantalla de la verificación en dos pasos y de la del negocio suspendido); al guardar,
     actualiza la sesión y se ve el panel;
   - **`public/early-data.js`:** no pide nada más con la sesión marcada;
   - **Configuración → Perfil:** `ChangePasswordForm` para todos los roles, con su texto nuevo;
   - **«Cambiar contraseña» del super admin** (`set-password-form.tsx`): el texto de temporal, «Generar una» y, al
     guardar, el paso «Contraseña temporal lista» con «Enviar por WhatsApp» y «Copiar mensaje»; la lista de usuarios
     pasa el teléfono de la cuenta;
   - **`check:password-recovery`:** el generador (largo, alfabeto, al azar), `newPasswordSchema` y el mensaje de
     WhatsApp.

5. **La constitución, 1.52.0, en los dos repos** (principio III): la decisión nueva en lugar de «no hay "olvidé mi
   contraseña"», y el riesgo aceptado que cambia.

**No se hace:**
- enlaces para definir la contraseña;
- la verificación en dos pasos para el equipo;
- las cuentas de pacientes, el registro público y la beta.

## Comprobación contra la constitución

| Principio | ¿Cumple? | Cómo |
|---|---|---|
| I. Español | Sí | Pantallas, emails, mensaje de WhatsApp y documentación en español |
| II. Privacidad | Sí | La temporal nunca queda en el registro de emails, la actividad ni los logs; misma respuesta para cualquier email |
| III. Decisiones del dueño | Cambia | El dueño cambió la decisión del 2026-10-04 con este pedido; se actualiza el principio III en los dos repos |
| Auditar todo | Sí | Pedido, entrada con la temporal, contraseña nueva, cambio en Perfil y la del soporte, en Seguridad |
| Pruebas en local | Sí | `tests/password-recovery.test.ts` con base temporal y `check:password-recovery` |
| Costo de Vercel | Sí | Un bcrypt por pedido, con topes; la limpieza va en el cron que ya existe |
| Diseño | Sí | Las pantallas siguen a la del acceso y a la de la verificación en dos pasos: una gama, claro y oscuro, 390 px |

## Pruebas

- **`back/tests/password-recovery.test.ts`:** todo lo de CE-001 (los tiempos, con un margen amplio para no depender
  de la máquina).
- **Las suites que cambian:** las que esperan que `change-password` rechace al equipo, y las de las altas y de
  «Cambiar contraseña» del super admin (ahora la sesión sale marcada).
- **`front/scripts/check-password-recovery.ts`.**
- **El recorrido local con Playwright:** pedir la temporal, leer el email de la cola local, entrar, crear la
  contraseña, cambiarla en Perfil y el diálogo del super admin con WhatsApp, en el computador y en el celular.
