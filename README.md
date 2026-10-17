# Agenda360 · API (agenda-backend)

API REST de Agenda360: agenda y reservas online multi-negocio. La usa el frontend
[`agenda-front`](../../Frontend/agenda-front) (React + Vite).

**Stack:** Node.js 22.18+ (ejecuta TypeScript directamente, sin compilar) · Express 5 · PostgreSQL 16 ·
Zod · bcrypt · Nodemailer (Gmail OAuth2).

## Desarrollo en local (sin tocar producción)

```bash
npm run dev:local              # API + base de datos PostgreSQL en este equipo, con los datos demo
npm run dev:local -- --reset   # borra los datos locales y vuelve a cargar la demo
npm run dev:local -- --recordatorios   # también los recordatorios automáticos de las citas demo
```

Crea la base en `.local-db/` la primera vez (necesita `brew install postgresql@16`), la conserva entre
arranques y la detiene al salir (Ctrl+C). Aplica las migraciones nuevas en cada arranque: es el sitio
para probar una migración antes de aplicarla en Supabase. De `.env` sólo lee la cuenta de Gmail
(`GMAIL_*`): nunca la base, Supabase ni el CAPTCHA. Con ella los emails se envían de verdad, pero
**todos a tu propio correo** (`EMAIL_REDIRECT_TO` o, si no, `GMAIL_USER`) con el destinatario
original en el asunto (`[Para maria@…]`); lo que estaba en cola de otras sesiones no se envía. Sin
ella quedan en cola (historial de emails del panel). Los recordatorios automáticos de las citas
demo (unos 20 al día) sólo con `--recordatorios`.
Después arranca el frontend (`npm run dev` en agenda-front) y entra con `jhordan@demo.com` o
`admin@demo.com` (contraseña `demo1234`).

En un equipo propio (`dev`, `dev:local`, `dev:prod`, `start`) la API sólo escucha en `127.0.0.1`:
nadie de la misma Wi-Fi puede llamarla. El frontend de desarrollo llega igual, porque el proxy de
Vite corre en este mismo equipo. Alojada (Lambda) escucha en todas las interfaces, como siempre.

### Con la base de producción, sin gastar CPU de Vercel

```bash
npm run dev        # pregunta: 1) base local con datos demo · 2) base de producción
npm run dev:prod   # directo a la base de producción (DATABASE_URL de .env)
```

Para tareas reales hechas por ti (dar de alta un negocio, revisar datos de un cliente) desde este
equipo: lo que hagas es real, pero la CPU es la de tu ordenador. Con `config.productionDbFromHere`:
- no arranca tareas de fondo (cola de emails, recordatorios): siguen en el cron de GitHub;
- los emails de lo que hagas van a sus destinatarios reales (sin redirección) con enlaces a la web
  publicada (`APP_URL`; por defecto la de Vercel);
- con `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en `.env`, los archivos, comprobantes, logos y
  fotos van al Supabase Storage de producción; sin ellas no se pueden subir (quedarían en el disco
  de este equipo);
- `/api/health` devuelve `productionDatabase: true` y el frontend local (`npm run dev` en agenda-front)
  muestra el aviso "Base de PRODUCCIÓN".

Nunca uses `db:seed` ni `npm test` contra producción (los dos se niegan con una base remota).

### Ramas: `dev` para trabajar, `main` para publicar

Vercel sólo publica `main` (`git.deploymentEnabled` en `vercel.json`, igual en agenda-front): los
push a `dev` o a cualquier otra rama no crean despliegues ni gastan CPU de Vercel.

```bash
git switch dev                 # trabajar y hacer commits aquí (git push guarda la rama en GitHub)
# …cuando todo esté probado con dev:local:
npm run db:migrate             # si hay migraciones nuevas: en Supabase, ANTES de publicar
git switch main && git merge dev && git push   # publica en Vercel
git switch dev && git merge main               # seguir trabajando en dev
```

Publica primero la API y después agenda-front si el cambio toca a los dos.

## Puesta en marcha

1. **Instala las dependencias**

   ```bash
   npm install
   ```

2. **Configura `.env`** (copia `.env.example` si no existe):

   - `DATABASE_URL`: en Supabase → *Connect* → *Direct connection string* → *Direct connection* → *URI*.
     Sustituye `[YOUR-PASSWORD]` por la contraseña de la base de datos. Si tu red no tiene IPv6, usa
     *Session pooler*. No añadas `?sslmode=…`: el cifrado se activa con `DATABASE_SSL=true` y la
     API comprueba el certificado del servidor con la CA raíz de Supabase (ver "Seguridad").
   - `GMAIL_*`: credenciales OAuth2 de la cuenta que envía los emails (ver "Emails" para usar un
     token que sólo pueda enviar, con `GMAIL_TRANSPORT=api`).

3. **Crea las tablas**

   ```bash
   npm run db:migrate
   ```

4. **Datos iniciales**, una de las dos opciones:

   ```bash
   npm run db:seed                                  # datos demo (sólo desarrollo)
   ```

   o, para el super admin real:

   ```bash
   npm run db:create-admin -- tu@email.com --nombre Nombre --apellido Apellido
   ```

   La contraseña (8 caracteres como mínimo) se pide después en la terminal, sin mostrarla: como
   argumento quedaría en el historial de la shell. Sin terminal, se lee de `ADMIN_PASSWORD`. Al entrar
   por primera vez con datos reales tendrá que activar la verificación en dos pasos (obligatoria).

   Con los datos demo, todas las cuentas usan la contraseña `demo1234`: `jhordan@demo.com` (propietario,
   plan Pro), `andrea@demo.com` (admin), `miguel@demo.com` (recepción), `laura@demo.com` (plan Free),
   `carolina@demo.com` (negocio suspendido), `pedro@demo.com` (sin negocio) y `admin@demo.com` (super admin;
   con la base local la verificación en dos pasos no es obligatoria, salvo con `SUPER_ADMIN_2FA=required`).
   Varias agendas (plan Business, 3 contratadas): `ricardo@demo.com` (propietario de Clínica Dental
   Sonrisa), `valeria@demo.com` (rol Profesional, sólo su agenda) y `elena@demo.com` (recepción); el
   Dr. Andrés Vega es un profesional sin usuario. Todas las agendas demo cobran por transferencia con
   una cuenta de ejemplo; la de `jhordan@demo.com` tiene dos (al reservar en `/book/jhordan` se ven
   las dos).

5. **Arranca la API**

   ```bash
   npm run dev      # http://localhost:4000/api (se reinicia al guardar)
   ```

   Después arranca el frontend (`npm run dev` en agenda-front) y abre <http://localhost:5173>.

## Scripts

| Script | Qué hace |
| --- | --- |
| `npm run dev` / `npm start` | API con recarga automática / en producción |
| `npm run dev:local` | API con una base de datos local y los datos demo (ver "Desarrollo en local") |
| `npm run typecheck` | Comprobación de tipos |
| `npm test` | Pruebas de integración contra un PostgreSQL desechable (ver "Pruebas") |
| `npm run db:migrate` | Aplica las migraciones pendientes de `db/migrations` |
| `npm run db:seed` | Carga los datos demo (no hace nada si ya hay datos; `-- --reset` lo **borra todo** antes) |
| `npm run db:create-admin -- <email> [--nombre X] [--apellido Y]` | Crea el super admin (pide la contraseña sin mostrarla; mínimo 8 caracteres) |
| `npm run db:move-images` | Pasa al bucket `imagenes` los logos y fotos antiguos guardados dentro de la base (data URL); se puede repetir |
| `npm run sync:shared` | Copia de agenda-front el código compartido (ver abajo) |
| `npm run push:keys` | Crea el par de claves VAPID de los avisos en el celular y muestra las dos líneas para copiarlas (ver "Avisos en el celular") |
| `npm run analytics:refresh` | Prepara ya la foto de hoy de la analítica del super admin (30 y 90 días) contra la base local, para probar; con la de producción no hace nada (ver "Analítica del super admin") |
| `npm run lambda:package` | Prepara `dist/lambda.zip` para AWS Lambda (ver "Backend en AWS Lambda") |
| `npm run backup:decrypt -- <archivo>` | Descifra una copia de seguridad en `~/Agenda360-copias` (ver "Copias de seguridad") |

## Estructura

```
db/migrations/      Esquema SQL. Para cambiarlo, añade un NNN_….sql nuevo (nunca edites uno ya aplicado)
src/
  server.ts         Arranque local: HTTP, recordatorios y envío de emails
  app.ts            Express: seguridad, CORS, sesión y rutas bajo /api (entrada en Vercel)
  config.ts         Variables de entorno validadas
  db/               Conexión (pool.ts), columnas, migraciones, datos demo, super admin
  http/             Errores, cookie de sesión, protección CSRF, límite de intentos
  routes/           Rutas REST → servicios
  services/         Lógica de negocio (permisos, límites del plan, auditoría, emails…)
  jobs/             Tareas periódicas (recordatorios, cola de emails, limpieza)
  shared/           Copia del código de agenda-front: tipos, validaciones Zod, disponibilidad,
                    plantillas de email, planes y permisos
scripts/            cron.ts (cliente del cron de GitHub + ntfy), test.ts (npm test), dev-local.ts, sync-shared.ts
tests/              Pruebas de integración (*.test.mjs / *.test.ts)
.github/workflows/  cron.yml: tareas periódicas cada 10 min en producción; backup.yml: copia semanal;
                    deploy-lambda.yml: publicación en Lambda. Acciones fijadas por SHA
.github/dependabot.yml  Actualizaciones semanales de las acciones y de npm (pull requests a dev)
```

### Código compartido con el frontend

`src/shared` es una copia de archivos de `agenda-front/src` (tipos, validaciones, cálculo de
disponibilidad, plantillas de email, planes y permisos), para que frontend y API validen igual.
**Se editan en el frontend** y luego se copian con `npm run sync:shared`.

## API

Todas las rutas cuelgan de `/api`. Respuestas JSON; los errores tienen la forma
`{ "error": { "code": "conflict", "message": "Texto para el usuario" } }` con los códigos
`validation` (400), `unauthorized` (401), `plan_limit` (402), `forbidden` (403), `not_found` (404),
`conflict` (409), `rate_limited` (429), `push_failed` (502, el aviso de prueba en el celular no salió) y
`unavailable` (503). El super admin sin la verificación en dos pasos recibe `two_factor_required` (403) en
`/admin` (también su campana), `/businesses`, `/images` y `/push` (ver más abajo).

| Grupo | Rutas |
| --- | --- |
| Sesión | `GET /auth/session` (con `panelColors` para el super admin y `themeMode`, el modo de pantalla de la cuenta) · `POST /auth/login` · `register` · `logout` · `change-password` (sólo super admin) · `PUT /auth/theme-mode` (`{ mode }`: `light`, `dark` o `auto`; la propia cuenta, cualquier rol y el super admin sin la verificación en dos pasos; spec 019) |
| Perfil | `GET/PUT /users/:userId` |
| Negocio | `POST /businesses` (onboarding) · `GET /businesses/slug-availability` · `GET/PATCH /businesses/:id` · `GET …/professional` |
| Datos del negocio (`/businesses/:id/…`) | `team` (+ `PATCH …/:userId/clinical-access`) · `subscription` · `subscription/usage` · `subscription/request` (GET/POST/DELETE) · `clients` (+ `POST …/clients/import`, importar pacientes desde un Excel o un CSV, spec 012) · `services` · `appointments` (`?from&to&clientId`, `PATCH …/:id/status` con `notify`: `false` cambia el estado sin avisar al paciente, y `onlyIfOpen`: sólo si sigue Pendiente o Confirmada, si no 409; `POST …/:id/cancel-following` cancela ésa y las siguientes de su serie) · `appointment-series` (`POST …/preview` y `POST`, citas que se repiten, spec 011) · `schedules` · `blocked-times` · `notifications` · `notifications/reminders` · `audit-logs` |
| Historia clínica | `GET/POST /businesses/:id/clinical-templates` (`?all=1`) · `GET/PUT …/clinical-templates/:templateId` · `PATCH …/:templateId/active` · `POST …/clients/:clientId/clinical-record/attachments` · `POST /businesses/:id/clinical-attachments/:attachmentId/complete` · `GET …/:attachmentId/url` · `GET /businesses/:id/clients/:clientId/clinical-record` · `PUT …/clinical-record/profile` · `POST …/clinical-record/notes` · `POST /businesses/:id/clinical-notes/:noteId/addenda` |
| Público (sin sesión) | `GET /public/platform-settings` · `GET /public/categories` · `GET /public/captcha` (Site Key del registro) · `GET /public/businesses/:slug` · `POST /public/businesses/:slug/bookings` · `POST /public/businesses/:slug/clients/lookup` (sólo para versiones anteriores de la página: responde siempre `{found: false}`) · `GET /public/payments/:token` (+ `receipts`) · `GET /public/appointments/:token` · `POST …/confirm` · `POST …/cancel` («Tu cita», spec 010) |
| Super admin | `/admin/stats` (con `growth`, el crecimiento del mes frente a los mismos días del mes pasado, y `health`, la salud del sistema: emails de hoy, el cupo de Gmail —`emailQuota`, spec 015—, último cron, última copia e intentos fallidos; spec 006; el reparto por plan, `businessesByPlan`, sólo cuenta los negocios activos) · `/admin/businesses` (+ `status`, `plan`, `members`, `client-required-fields`) · `/admin/categories` (CRUD) · `/admin/plan-requests` (+ `approve`, `reject`) · `/admin/users` (+ `active`, `password`) · `/admin/audit-logs?scope=admin\|all` · `/admin/emails` · `/admin/settings` · `PUT /admin/panel-colors` (los colores del panel de quien lo pide; spec 007) |
| Avisos en el celular (spec 013) | `GET /push/config` · `PUT /push/device` · `PATCH /push/device` · `POST /push/device/off` · `POST /push/device/test` (sólo el propietario de un negocio activo, el rol Profesional con su agenda activa —sólo el resumen de las 8, spec 017— y el super admin; el aparato va en el cuerpo, nunca en la URL) |
| Analítica (spec 016) | `GET /admin/analytics?days=30\|90` (sólo el super admin, con la verificación en dos pasos): `{ snapshot }`, la última foto de ese periodo, o `{ snapshot: null }` si aún no hay; `days` distinto de 30 o 90, 400. Lee una fila y no calcula nada. La ficha (`GET /admin/businesses/:id`) suma `analytics`: su parte de la última foto de 30 días y su tipo |
| Centro de avisos (spec 014) | `GET /businesses/:id/notices/unread` · `GET …/notices` (`?limit&unread=1&cursor`) · `POST …/notices/:noticeId/read` · `POST …/notices/read-all` (cualquier rol del equipo; el super admin en modo soporte recibe 403) y lo mismo en `/admin/notices` (el super admin, con la verificación en dos pasos). Ninguna escribe en la actividad |
| Citas por cerrar (spec 018) | `GET /businesses/:id/appointments/to-close` (`?cursor`, tandas de 50: `{ appointments, overdue, today, nextCursor }`) · `GET …/appointments/to-close/count` (`{ overdue, today }`) · `POST …/appointments/close-all` (`{ status: "completed", notify, ids }`: `{ closed, skipped }`). Cada uno ve lo suyo: el rol Profesional, su agenda (sin agenda, 403); el resto del equipo y el super admin en modo soporte, el negocio. Consultar no escribe en la actividad |
| Citas completadas (spec 020) | `POST /businesses/:id/appointments/:appointmentId/correct-status` (`{ status, reason, notify }`: `status`, `confirmed`, `no_show` o `cancelled`; `reason`, de 10 a 300 caracteres; `notify`, por defecto `false`). Sólo el propietario y el super admin en modo soporte (los demás roles, 403) y sólo desde «Completada» (si no, 409). Devuelve la cita corregida |
| Estado | `GET /health` (con `push`: si la API tiene claves VAPID válidas) |

## Contraseñas, modo soporte e historia clínica

- **Las contraseñas las pone el super admin**: al agregar el propietario de un negocio, al agregar un
  miembro a un equipo, al agregar otro super admin y al cambiársela a un usuario (mínimo 8
  caracteres). Se envían por email. Los usuarios no pueden cambiarla ni hay recuperación por enlace
  ("¿Olvidaste tu contraseña?" indica el email de soporte). Sólo el super admin cambia la suya. Una
  cuenta existente sin negocio que pasa a ser propietaria recibe la contraseña que elige el super
  admin y se cierran sus sesiones abiertas. Quien se registra por `/register` elige la suya (mínimo 8
  caracteres); se puede cerrar el registro en Configuración de la plataforma. Riesgo conocido: el
  registro responde "Ya existe una cuenta con ese email" (revela qué emails están registrados); se
  deja así hasta tener verificación por email.
- **Cambiar el email** de la cuenta (`PUT /users/:id` con `currentPassword`) pide la contraseña
  actual y queda en los eventos de sesión.
- **Categorías de negocio en la base de datos** (tabla `business_categories`): el super admin las
  crea, edita, ordena y desactiva en `/admin/categories` (nombre, ícono, si es de salud y servicio
  sugerido). Una categoría en uso no se borra: se desactiva y los negocios que la tienen la conservan.
  La categoría de un negocio sólo la cambia el super admin (`PATCH /businesses/:id` responde 403 si
  un propietario intenta cambiarla).
- **Cambios de plan**: el plan lo cambia el super admin desde la ficha del negocio en `/admin` (también
  en modo soporte) y el propietario siempre recibe un email. El panel del negocio ya no tiene la
  pestaña Configuración → Suscripción (no ve planes ni precios). La API conserva la solicitud del
  propietario (`POST /businesses/:id/subscription/request`) y el resumen de `/admin` muestra las
  pendientes para aprobarlas o rechazarlas con un motivo, pero hoy la web no las crea.
- **Desde cuándo está en su plan** (migración 042, spec 015): `subscriptions.plan_since` toma `now()`
  al crear el negocio y en cada cambio de plan (elegir el mismo plan no la toca). La migración la
  rellenó con `current_period_end - 30 días` (la hora del último cambio) o, en Free, con el alta del
  negocio. La ficha dice «En Pro desde el 3 oct», sin fecha de renovación: no hay cobro todavía.
  `current_period_end` se queda en la base para el cobro de otra spec.
- **Cédula de los clientes**: identifica al cliente dentro del negocio (única por negocio, sólo
  números: sin letras ni guiones; en negocios de Ecuador, 10 dígitos con dígito verificador válido). En
  el panel, los datos obligatorios del paciente dependen del negocio (ver «Datos obligatorios del
  paciente»; por defecto, cédula y email). En la reserva pública el paciente escribe
  **siempre** cédula, nombre, email y teléfono: la página no dice si la cédula ya es de un cliente
  (con la de un paciente de un psicólogo, eso ya sería un dato sensible). Si la cédula existe en el
  negocio, la reserva sólo se une a esa ficha si coinciden el email o el teléfono guardados (sin
  mayúsculas ni formato: `099 123 4567` = `+593 99 123 4567`) y no cambia sus datos. Si no
  coinciden, la reserva sale **igual que con una cédula nueva** (la misma respuesta, los mismos
  emails al correo escrito, los mismos topes y la hora ocupada) y queda **«Por verificar»** (spec
  009): un paciente aparte, sin cédula, con los datos escritos y `clients.claimed_client_id`
  apuntando a la ficha, que no se toca ni recibe nada (ni el recordatorio). Antes respondía 403, y
  eso decía que la cédula era de un paciente. El negocio la revisa en la agenda: «Es el mismo
  paciente: unir a su ficha» (`POST /businesses/:id/clients/:clientId/confirm-claim` con
  `{ updateEmail, updatePhone }`: las citas pasan a la ficha y el paciente aparte desaparece; no lo
  puede hacer el rol Profesional, ni si el paciente aparte ya tiene historia clínica) o cancela la
  cita. La confirmación sólo muestra el email de la ficha si es el que escribió. El navegador puede recordar los datos del propio paciente ("Recordar mis datos", con
  "Olvidar mis datos"), nunca la API. Un cliente antiguo sin cédula con el
  mismo email, **el mismo nombre y el mismo teléfono** (sin tildes, mayúsculas ni espacios de más) recibe la cédula en
  lugar de duplicarse; con otro nombre es otra persona (una madre y su hijo con un solo email) y se
  crea su propia ficha, para no mezclar citas ni historias clínicas. El email ya no es único (familias).
- **Datos obligatorios del paciente** (migración 031, `businesses.client_required_fields`, jsonb
  `{ documentId, email, phone, address }`, true = obligatorio; en la API, `clientRequiredFields` del
  negocio): qué pide el panel de cada negocio al crear o editar un cliente. El nombre lo es siempre.
  Por defecto `{documentId: true, email: true, phone: false, address: false}`, lo que se exigía hasta
  ahora: los negocios existentes siguen igual. Sólo el super admin lo cambia, desde la ficha del
  negocio en `/admin` (`PUT /admin/businesses/:id/client-required-fields`, con la verificación en dos
  pasos obligatoria de `/admin`); `PATCH /businesses/:id` ignora el campo (también en modo soporte).
  El cambio queda en la actividad del negocio (`platform.client_required_fields_changed`, autor
  "(Super admin)", con cada dato antes → después). `POST` y `PUT …/clients` validan con
  `clientSchemaFor(required)` (código compartido): sin un dato obligatorio responden 400 («La cédula es
  obligatoria», «El teléfono es obligatorio»…), y lo que se escribe tiene que ser válido aunque sea
  opcional (cédula ecuatoriana, email, teléfono). Al editar un paciente antiguo al que le falta un dato
  que ahora es obligatorio hay que completarlo para guardar (también para guardar sus notas). La
  reserva online no cambia: tiene su propio esquema y pide siempre cédula, nombre, email y teléfono.
  La página pública no recibe el campo.
- **Ubicación del local** (migración 007, columnas `businesses.lat`/`lng`): el negocio marca su
  local en un mapa; la página de reservas lo muestra y los emails enlazan "Cómo llegar" al punto
  exacto (sin punto, a la dirección escrita). Latitud y longitud van juntas o ninguna.
- **Fechas de la historia clínica**: la del consentimiento informado (casilla "firmó") y la de cada
  evolución las pone la API con el día actual; triggers de PostgreSQL impiden cambiarlas después.
- **Negocio sin propietario** (migración 024, `businesses.owner_id` admite null): `POST
  /admin/businesses` crea el negocio con descripción, servicios (`services`: nombre, minutos y
  precio; precio 0 = oculto) y horario (`schedules`), sin cuenta; `POST /admin/businesses/:id/owner`
  agrega después al propietario (cuenta nueva o existente sin negocio; email `business_created`
  con su acceso; si hay una sola agenda sin usuario, se le vincula y toma su nombre).
- **Modalidades y precio "Gratis"** (migración 023): `services.modes` (`business`, `home`, `virtual`;
  al menos una) reemplaza a `location` (la API aún acepta `location` de un panel anterior).
  `appointments.is_virtual` (no puede ser a la vez a domicilio) y `professionals.meeting_url` (sala
  fija, `https://…`; no sale en la página pública). La reserva se rechaza si la modalidad no es una
  del servicio. `show_price` false = sin precio; true con precio 0 = "Gratis" (la migración ocultó
  los servicios que ya tenían precio 0, que antes significaba "no mostrar").
- **Cuentas individuales** (Free y Pro, `multipleAgendas: false` en `plans.ts`): no se crean
  profesionales (`assertMultipleAgendas`), ni se da el rol Profesional (`assertRoleAllowed`), y no se
  pasa a esos planes con miembros que lo tienen. Su única agenda sí se edita (especialidad, enlace).
- **Varias agendas** (migración 022, plan Business): cada profesional (`professionals`) tiene su
  horario (`schedules.professional_id`), sus bloqueos (`blocked_times.professional_id`; null = todo el
  negocio) y los servicios que atiende (`all_services` o `professional_services`). Free y Pro tienen
  una agenda; Business, las contratadas (`subscriptions.max_professionals`, las fija el super admin con
  `PUT /admin/businesses/:id/max-professionals`; null = sin tope): `assertProfessionalLimit` al crear
  o reactivar (`plan_limit`), y no se baja de plan con más agendas activas. `GET/POST/PUT/DELETE
  /businesses/:id/professionals` (gestionan propietario y administradores; con citas sólo se
  desactiva); el horario se guarda con `PUT /businesses/:id/professionals/:pid/schedule`. Dos citas
  sólo chocan si son de la misma agenda. Reserva online: `professionalId` o null ("el primero
  disponible": el que tiene menos citas ese día y está libre); `bookingSettings.chooseProfessional`
  false no pregunta. Llegada del paciente: `PATCH /appointments/:id/arrival` (`arrived_at`).
  Avisos al profesional (si tiene `email`): cita nueva que no agendó él y, de 6:00 a 11:00, su agenda
  del día (una vez por día: `notifications.dedupe_key`), la envía el cron.
- **Roles**: `owner`, `admin`, `staff` (se muestra como Recepción: todas las agendas) y
  `professional` (sólo su agenda: `agenda-scope.ts` filtra citas, horario, bloqueos y reportes; con
  `businesses.professional_scope = 'own'`, también los pacientes y su historia clínica: los que
  tienen citas en su agenda o registró él, `clients.created_by`). Sin agenda asignada, el rol
  Profesional no ve nada (`forbidden`). Una **reserva online** con la cédula de un paciente que ya
  existía y que aún no era suyo no le da acceso (`appointments.client_access_pending`, lo marca un
  trigger de la migración 028): ve la cita con el nombre del paciente (en `GET …/clients` llega con
  `restricted: true`, sin contacto ni notas), pero su ficha y su historia responden 404 hasta que la
  confirme o la gestione alguien que no sea él (propietario, administrador, recepción o el super
  admin en modo soporte). Si la confirma él mismo o la cancelan, sigue igual; un paciente nuevo
  creado por la reserva cuenta enseguida. Con «sólo sus pacientes», "Ya existe un cliente con esa
  cédula" no dice de quién es.
- **Planes y precios**: los negocios no los ven (ni la página de inicio): los precios se acuerdan con
  cada negocio y el plan lo cambia el super admin. Los límites siguen aplicándose; al llegar a uno,
  el mensaje invita a escribir a soporte.
- **Modo soporte**: el super admin opera en cualquier negocio (también suspendido) con permisos de
  propietario desde "Gestionar negocio" (con la verificación en dos pasos activada); lo que crea o
  cambia queda en la auditoría como "Nombre (Super admin)", lo que sólo consulta no (tampoco las
  historias clínicas ni sus archivos).
- **Historia clínica** (datos de salud, para uso del profesional): el propietario, los miembros que
  él autoriza y el super admin en modo soporte. Las evoluciones no se editan ni se borran (se añaden
  aclaraciones), cada consulta de las personas del negocio queda en la auditoría y un paciente con
  historia no se puede eliminar. En la actividad del negocio, los eventos de la historia clínica (`clinical_record`) sólo
  los ve quien tiene acceso clínico (un administrador sin él, no).
- **Formatos propios y archivos** (migración 010): en los planes Pro y Business el
  propietario crea y edita sus formatos (`/clinical-templates`, cada cambio es una versión nueva; un
  campo existente no cambia de tipo) o duplica uno de la plataforma. (Los servicios no tienen formato propio: siempre se
  propone el del negocio. La columna `services.clinical_template_id` quedó sin uso.) Archivos (JPG, PNG, WebP, HEIC, PDF, 15 MB) con subida directa firmada a Supabase
  Storage (en local, carpeta `storage/historias-clinicas/` y rutas `/api/files`); no se borran. Las
  subidas que nunca se completaron (más de un día en `pending`) las borra el cron: primero el archivo
  y después el registro (igual con los comprobantes).
- **Retención de la auditoría** (migración 026): `purge_audit_logs()` (la llama el cron) borra los
  inicios y cierres de sesión a los 90 días, las acciones del panel a los 5 meses (antes, 1 año) y
  los accesos y cambios en la historia clínica a los 5 años. Las citas, pacientes y pagos no se
  tocan; nadie más puede borrar ni editar la auditoría (triggers).
- **Pago por transferencia** (migraciones 025 y 030): cada agenda tiene **hasta 3 cuentas**
  (`professionals.bank_accounts`, jsonb: lista de `{ bank, accountType: savings|checking, number
  (sólo dígitos), holder, holderId (cédula/RUC, opcional) }`; la primera es la principal; lista
  vacía = no cobra por transferencia; `bankAccounts` en la ficha, validado con `bankAccountsSchema`).
  Cada cita tiene `payment_token` (enlace privado `/pago/:token` del frontend), `receipt_at` (último
  comprobante) y `paid_at`. Con cuentas y precio mayor que 0, la confirmación de la reserva
  (`payment.bankAccounts`), la página de pago y los emails de reserva y confirmación (mientras no esté
  pagada) llevan **todas** las cuentas (el paciente transfiere a cualquiera) y el enlace; la
  actividad registra "Datos bancarios" con todas, antes y después. Transición desde la cuenta única
  (`src/services/bank-accounts.ts`): la 030 copió `bank_account` a la lista y la columna se conserva
  con la primera cuenta (o null), con un trigger que pasa a la lista lo que escriba el código
  anterior, así que se puede migrar antes de publicar o volver atrás; las respuestas llevan además
  `bankAccount` (la primera o null) y la API acepta todavía `bankAccount` si no viene `bankAccounts`
  (reemplaza la primera y conserva las demás), ambos obsoletos, para los fronts viejos en caché.
  Publicar el backend antes que el front (el front nuevo ya no conoce `bankAccount`). Sin sesión: `GET /public/payments/:token`, `POST
  /public/payments/:token/receipts` (JPG, PNG, WebP, HEIC o PDF, 10 MB; **uno por cita**: enviado,
  se rechaza otro, también si dos pestañas suben a la vez; no en citas canceladas o "No asistió") y `POST …/receipts/:id/complete` (avisa por email al negocio). En el
  panel: `GET /businesses/:id/appointments/:id/receipts`, `GET /businesses/:id/payment-receipts/:id/url`
  (URL firmada de 5 min) y `PATCH /businesses/:id/appointments/:id/payment` (`{ paid }`). Los
  comprobantes se borran con la cita (al eliminar el paciente o el negocio, también sus archivos) y,
  para que el almacenamiento no se llene, el cron borra los de citas de hace más de 3 meses
  (`RECEIPT_RETENTION_MONTHS`; la cita conserva `paid_at` y `receipt_at`). El navegador reduce las
  fotos antes de subirlas (WebP, 2000 px: unos 200–450 KB); los PDF van tal cual.
- **«Tu cita»: el paciente confirma o cancela desde el email** (spec 010, migración 037,
  `src/services/appointment-page-service.ts`). Los emails de una cita activa (solicitud, confirmación,
  cambio, restablecida, vuelve a pendiente y recordatorio) llevan el enlace privado de cada persona a
  `/cita/:token` del frontend: el del paciente principal es su `payment_token` (el mismo del pago) y
  cada otra persona de una sesión tiene el suyo (`appointment_clients.access_token`, que no abre
  `/pago`). Sin sesión:
  - `GET /public/appointments/:token`: la cita para la página (`PublicAppointment`: servicio, fecha,
    hora, profesional, modalidad y negocio; nada del paciente, ni la dirección de la visita, ni el
    enlace de la videollamada, ni el precio) y lo que puede hacer quien la abre (`canConfirm`,
    `cancellation.status`, `payment`). Responde el mismo 404 si el token no existe, si esa persona ya
    no está en la cita, si cambió el principal, si el negocio está suspendido o si pasaron más de 30
    días desde la cita (`APPOINTMENT_PAGE_DAYS`). `Cache-Control: private, no-store`.
  - `POST …/confirm` («Confirmo que voy»): guarda `appointments.client_confirmed_at` o
    `appointment_clients.confirmed_at` sin cambiar el estado (confirmar la cita sigue siendo del
    negocio), registra `appointment.client_confirmed` la primera vez y no manda emails ni ntfy;
    repetirlo responde `already: true`. El botón del recordatorio abre `/cita/:token?confirmar=1`, y
    es la página la que confirma con un `POST` (con `X-Requested-With`): un antivirus que abre el
    enlace no confirma nada.
  - `POST …/cancel` («Cancelar mi cita»): sólo el principal, si el negocio tiene «Permitir
    cancelaciones» y falta **más** que su antelación (`canCancelOnline`, comprobado con la cita
    bloqueada). Usa el mismo cambio de estado que el panel (`cancelFromPatientLink`): la cancelación a
    cada persona, la copia al profesional («La canceló el paciente desde su email.»), un aviso al
    negocio (`patient_cancelled`) si su email no es el del profesional, la actividad
    `appointment.client_cancelled` y el aviso por ntfy. La hora queda libre.
  - **La confirmación se borra sola** (triggers de la 037) si cambian la fecha, la hora o el
    profesional, o si la cita se cancela; Atendida y No asistió la conservan. Cambiar el paciente
    principal desde el panel le da a la cita un `payment_token` nuevo y la deja sin confirmar; unir a
    la ficha (spec 009) conserva enlaces y confirmaciones.
  - El panel recibe `clientConfirmations` (`[{ clientId, confirmedAt }]`, el principal primero) en
    cada cita, para la marca «Confirmó el paciente».
  - Límites por conexión: `mi-cita` (60 vistas en 15 min) y `mi-cita-acciones` (20 confirmaciones o
    cancelaciones en 15 min).
- **Citas que se repiten** (spec 011, migración 038, `src/services/appointment-series-service.ts`).
  Desde «Nueva cita» del panel se agenda de una vez una serie: cada semana, cada 2 semanas o cada mes
  (el mismo día del mes; si no existe, el último), de 2 a 24 citas contando la primera, desde hoy y
  Pendiente o Confirmada. La reserva online no crea series.
  - `POST /businesses/:id/appointment-series/preview`: la lista de fechas, sin cambiar nada. Cada
    fecha con su marca (`free`, `busy` si hay otra cita del profesional, `blocked`, `day_off`,
    `outside_hours` o `plan_limit`), su motivo («Ya hay una cita de 10:00 a 11:00», sin nombrar al
    otro paciente) y, en las de otra cita, un bloqueo o fuera del horario, las horas libres de ese día
    en la cuadrícula del negocio. Con el cupo de cada mes topado en 24 (`planRemaining`) y el tope del
    plan (`monthlyLimit`). La lista la calcula `src/shared/lib/appointment-series.ts`, la misma
    función que usan la creación, el panel y la beta.
  - `POST /businesses/:id/appointment-series` (201): con las fechas que quedaron en la lista (sólo se
    puede cambiar la hora o quitar fechas). En una transacción con el negocio bloqueado, como una cita
    suelta: cada fecha se vuelve a comprobar y la que se ocupó, se bloqueó o pasó el cupo mientras se
    revisaba la lista vuelve en `skipped`. Las de un bloqueo, un día sin atención o fuera del horario
    sólo se crean con `allowOutsideHours` («Agendar igual»). Si no se puede crear ninguna, no se crea
    nada (409, o 402 si todas pasaban el cupo).
  - **Cada cita sigue siendo una cita normal** (su recordatorio, sus estados, sus avisos, su pago y su
    «Tu cita») y se cambia sola. Llevan `series: { id, index, total, frequency }` («Cita 3 de 8»);
    las sueltas, `series: null`. La serie (`appointment_series`) guarda la frecuencia, cuántas se
    pidieron, cuántas se crearon y quién la creó.
  - **Un solo email por paciente** (`appointment_series`, «Tus próximas 8 citas en …») con todas las
    fechas, cada una con el enlace a su «Tu cita», con la copia al profesional (sin esos enlaces) y,
    si corresponde, un solo aviso al profesional. Sólo con «Confirmaciones». Una sola entrada de
    actividad (`appointment.series_created`) y un solo aviso de ntfy por serie.
  - `POST /businesses/:id/appointments/:id/cancel-following` (`{ notify }`): «Cancelar ésta y las
    siguientes», por su número en la serie y sólo las que siguen Pendientes o Confirmadas (el rol
    Profesional, sólo las de su agenda). Un solo email por paciente (`appointment_series_cancelled`)
    y una copia por profesional, con «Cancelaciones» y la casilla «Avisar al paciente»; una entrada
    de actividad y un aviso de ntfy.
- **Importar pacientes desde un Excel o un CSV** (spec 012, migración 039,
  `src/services/client-import-service.ts`): Clientes → «Importar pacientes», del propietario, los
  administradores y el super admin en modo soporte (permiso `clients.import`; Recepción y el rol
  Profesional reciben 403). El archivo se lee en el navegador y no se sube ni se guarda: la API recibe
  sólo los datos de cada fila.
  - `POST /businesses/:id/clients/import` con `{ rows: [{ row, name, documentId, email, phone, address,
    notes }], includeIncomplete? }`. **Ampliación del 2026-10-15:**
    - con `includeIncomplete: true`, basta el nombre: las filas a las que les falta un dato obligatorio
      del negocio entran y salen en `incomplete` (`{ row, missing }`);
    - lo que viene se valida igual, y una cédula o un email mal escritos siguen con error;
    - sin él, la ruta hace lo mismo que antes;
    - «Por completar» no se guarda: se calcula con `missingRequiredFields` y los datos obligatorios de
      hoy. Contenido de la ruta: todas las filas no vacías de la hoja (de 1 a 5.000; `row` es el número de fila de
    Excel), también las que la revisión marcó con error. Primero exige la sesión (sin ella, 401 sin leer
    el cuerpo), después el límite `importar-pacientes` (20 cada 15 min por conexión) y por último lee el
    JSON, de hasta **4 MB** sólo en esta ruta (`app.ts` la salta en el lector general de 2 MB).
  - Cada fila se limpia y se valida con el mismo código que la revisión del panel
    (`src/shared/lib/validations/client-import.ts`: `prepareImportRow` y `classifyImportRows`), con las
    reglas del formulario del paciente del negocio (`clientSchemaFor` con los datos obligatorios y
    `documentIdError`). La limpieza quita espacios, puntos y guiones de la cédula, le vuelve a poner el 0
    que quitó Excel a una cédula de 9 dígitos en Ecuador (sólo si así es válida), pasa los teléfonos o
    emails de más de una celda a las notas y cambia el punto del teléfono por un espacio.
  - Todo o nada, en una transacción con el negocio bloqueado (`authorize` con `lock`): crea en una sola
    sentencia los válidos y nuevos (`source = 'import'`, el mismo `created_at`, `on conflict` en la
    cédula) hasta el cupo del plan (`remainingClientSlots`). Un paciente que ya existe no se toca: con
    la misma cédula o, si no tiene cédula, con el mismo nombre, email y teléfono. Repetir la importación
    (o dos a la vez) no duplica: lo que ya entró cuenta como «ya existía».
  - Responde `{ created, existing: [{ row, clientId }], repeated: [{ row, firstRow }], errors: [{ row,
    reason }], overLimit: [row] }`; `reason` nunca repite el valor de la celda.
  - No sale ningún email. Si se creó al menos uno, una entrada `client.imported` en la actividad
    («Importó 190 pacientes (3 ya existían, 5 con errores, 2 repetidas en el archivo)», sin nombres) y
    un solo aviso por ntfy en la siguiente pasada del cron.
  - Los importados cuentan para el tope del plan y en el total, pero no como «pacientes nuevos del mes»
    en el Inicio del super admin (`/admin/stats`, decisión del dueño del producto).
- **Almacenamiento** (`src/services/file-storage.ts`): tres buckets de Supabase Storage que se crean
  solos con su tamaño máximo y sus tipos de archivo: `historias-clinicas` (privado, o el de
  `STORAGE_BUCKET`), `comprobantes` (privado) e `imagenes` (público: logos y fotos). Las imágenes se
  suben con `POST /images` (`target`: avatar, logo o professional; 2 MB) y se guarda su dirección
  pública; la API no acepta imágenes nuevas que no estén en el bucket (las antiguas en data URL valen
  mientras no se cambien; `npm run db:move-images` las pasa). Una imagen nueva debe venir escrita tal
  como la devolvió la subida (la dirección canónica: `%2Ejpg` en vez de `.jpg` es el mismo archivo con
  otro texto) y ser un archivo subido por la API (`<carpeta>/<id>/<uuid>.<ext>`); la foto de una
  agenda, además, de `profesionales/<negocio>` o de la carpeta de su usuario. Al cambiar o quitar una
  imagen se borra la que ya nadie usa, **comparando por archivo** y no por texto (`releaseImages`):
  nadie borra el logo de otro negocio poniéndolo como su foto y quitándolo después. Cada subida queda
  en `image_uploads` (migración 029): como mucho 20 por usuario en 24 h, y el cron borra a las 24 h
  las que nadie usa (el bucket es público: no sirve de alojamiento). En local, carpeta `storage/<bucket>/` (las imágenes en
  `/api/files/public/imagenes/…`); con la base de producción y sin Supabase en `.env`, no hay subidas.
  Las rutas locales nunca salen de la carpeta de su bucket (`localFilePath`): Express decodifica
  `..%2F..%2F.env` como un solo trozo `../../.env`, así que la ruta pública rechaza también los
  trozos con barras y `localFilePath` comprueba con `path.resolve` que el archivo quede dentro.
  El navegador sube directo a Supabase: la CSP de agenda-front (`vercel.json`, `connect-src`) sólo
  permite el host de `SUPABASE_URL` (`https://<ref>.supabase.co`). Si cambia el proyecto de
  Supabase, hay que cambiarlo también allí.
  `list(prefix)` recorre una carpeta con sus subcarpetas: al eliminar un negocio se vacían
  `<negocio>/` en los buckets privados y `logos/<negocio>/` y `profesionales/<negocio>/` en el de
  imágenes (sólo lo que nadie más usa), también lo que no tenía registro.
- **Equipo de la plataforma** (migración 020): `users.platform_owner` marca al super admin principal
  (la migración lo pone en el que ya existía; `db:create-admin` lo pone si aún no hay ninguno).
  `GET/POST /admin/platform-admins` lista y agrega super admins (agregar, sólo el principal). Las
  rutas de usuarios (`/admin/users/:id/active` y `/password`) sólo dejan tocar a otro super admin al
  principal, y nunca al principal ni a uno mismo.
- **Avisos por WhatsApp** (migración 019): `notification_settings` lleva `whatsappOnStatusChange` y
  `whatsappFollowUps` (la migración los activa en los negocios que ya existían). El aviso lo abre el
  front con un enlace `wa.me`; `POST /businesses/:id/appointments/:id/whatsapp-notice` (`kind`:
  confirmed, cancelled, rescheduled, completed, no_show; `clientId` opcional: a cuál de los pacientes
  de la cita) sólo lo registra en la actividad.
- **Citas con varios pacientes** (migración 032, spec `specs/004-sesiones-varios-pacientes`; sesiones de
  pareja o de familia).
  - **Dónde se guardan:**
    - el paciente principal sigue en `appointments.client_id`, que es el de la reserva y el del pago;
    - los otros, hasta 2, en `appointment_clients (appointment_id, client_id, business_id, created_at)`;
    - en la API llegan como `extraClientIds` en todas las citas, por la subconsulta de
      `appointmentColumns()`.
  - **El interruptor:** sólo lo tienen los negocios que habilita el super admin:
    - columna `businesses.multi_client_appointments` (`multiClientAppointments`), apagada por defecto;
    - se cambia con `PUT /admin/businesses/:id/multi-client-appointments` (`{ enabled }`);
    - queda en la actividad como `platform.multi_client_appointments_changed`;
    - `PATCH /businesses/:id` lo ignora y el perfil público no lo trae.
  - **Reglas al guardar** (`src/services/appointment-clients.ts`):
    - sin el interruptor sólo se pueden quitar pacientes;
    - cada paciente nuevo tiene que ser del negocio, estar activo y estar en el alcance del
      profesional;
    - un `PUT` sin `extraClientIds` conserva los que había;
    - un trigger de la base impide más de 2 adicionales, repetir al principal o mezclar negocios.
  - **La hora:** se ocupa una sola vez (`appointments_no_overlap` no cambia).
  - **Emails** (`notifyAppointmentChange`):
    - cada paciente con email recibe el suyo, con su nombre;
    - los que se agregan a una cita activa reciben el de una cita nueva, y los que se quitan, la
      cancelación;
    - sale un email por dirección;
    - la copia al profesional sale una vez y nombra a todos (`joinNames`).
  - **Recordatorios:** uno por paciente.
    - El del principal conserva la clave de siempre y el de cada adicional le añade
      `:<client_id>`.
    - `reminderCurrentSql` comprueba en el envío que sigue en la cita.
  - **Historial y actividad:**
    - `?clientId=` y `clients/activity` incluyen las participaciones;
    - lo cobrado se suma sólo al paciente principal.
  - **Alcance:** un profesional con «sólo sus pacientes» ve a los adicionales de su agenda.
  - **Borrado:** borrar a un adicional sólo lo quita de la cita.
- **Servicios en pareja o en familia y su reserva online** (migración 033, spec
  `specs/005-servicios-en-pareja`).
  - **El servicio:** `services.people_per_session` (`peoplePerSession`, de 1 a 3, por defecto 1).
    - Sólo vale con el interruptor de las citas con varios pacientes (`peopleFor(business, service)`).
    - Sin el interruptor, o si el cuerpo no trae el campo, se conserva el guardado.
    - El perfil público manda el valor efectivo: 1 sin el interruptor.
  - **La reserva** (`POST /public/businesses/:slug/bookings`):
    - en un servicio de 2 o 3 personas, el cuerpo trae `extraPatients` (`{ documentId, name, email, phone }`);
    - quien reserva es el paciente principal;
    - cada persona se reconoce por su cédula con la misma regla (`resolveBookingClient`: email o
      teléfono que coincidan, ficha antigua sin cédula, o paciente nuevo con los topes del día y del
      plan);
    - las demás quedan en `appointment_clients`, todo en una transacción;
    - el límite de citas por persona al día cuenta también las sesiones en las que va como otra
      paciente;
    - el reintento compara las cédulas de todas.
  - **Emails:**
    - los datos de pago van sólo al paciente principal, también en las citas del panel;
    - el email de solicitud de las demás personas dice quién reservó (`bookedBy`);
    - el tope de emails a pacientes nuevos cuenta a todas las personas.
  - **«Sólo sus pacientes»:** cada otra persona de una reserva online que ya existía queda con
    `appointment_clients.client_access_pending` (trigger de la migración 033, con las reglas de la
    028) hasta que el negocio gestione la cita: el profesional ve su nombre, pero no su ficha.
  - **ntfy:** el aviso de la reserva tiene una línea por persona.
- **Colores de marca** (migración 018): `businesses.brand_colors` (jsonb, `{ primary, highlight }` en
  `#rrggbb`, con un check en la base; null = los de Agenda360). Se cambian con `PATCH
  /businesses/:id` (`brandColors`, permiso `business.manage`: sólo el propietario, o el super admin en
  modo soporte; un administrador no), quedan en la actividad y llegan al perfil público para que la
  página de reservas use los colores del negocio.
- **Colores del panel del super admin** (migración 035, spec 007): `users.panel_colors` (mismo
  formato y check que `brand_colors`). Cada super admin los guarda en su cuenta con `PUT
  /admin/panel-colors` (`{ colors }`; sólo la suya, sin auditoría) y llegan en la sesión como
  `panelColors`. No se aplican a los negocios ni a otros super admins.
- **Modo de pantalla** (migración 044, spec 019): `users.theme_mode` (`light`, `dark` o `auto`, con
  un check; por defecto `auto`, también en las cuentas que ya existían). Es de cada persona, de
  cualquier rol: lo guarda con `PUT /auth/theme-mode` (`{ mode }`, sólo el suyo) y le llega en la
  sesión como `themeMode`, leído en la misma consulta de la sesión (ninguna consulta nueva). Elegir el
  mismo modo no escribe nada; cada cambio queda en la actividad (`user.theme_mode_changed`, «Cambió el
  modo de pantalla de «Automático» a «Oscuro»»): la de su negocio o, la del super admin (también en
  modo soporte), la de la plataforma. Las páginas de los pacientes siguen al modo de su aparato. Al
  publicar, la migración 044 va antes del backend (`npm run db:migrate`, como paso aparte).
- **Formato de tu negocio** (migración 017): `businesses.clinical_default_template_id` guarda el
  formato que se propone en cada evolución nueva, en todas las citas. Lo elige el propietario con `PUT /businesses/:id/clinical-default-template` (cualquier
  plan, de la plataforma o propio y activo); si no eligió ninguno, o desactiva el elegido, se usa el
  recomendado para su especialidad. La lista de formatos marca cuál es con `isDefault`.
- **Odontograma, mapa del cuerpo y escalas** (migración 011): tipos de campo `odontogram` (FDI, por
  superficie y pieza), `bodymap` (frente y espalda) y `questionnaire` (PHQ-9 y GAD-7 con puntaje,
  interpretación y aviso en la pregunta 9 del PHQ-9). Versión 2 de atención médica, odontología,
  fisioterapia y psicología, y plantilla de escalas.
- **Plantillas de historia clínica** (migración 009): cada evolución se escribe con un formato
  (`clinical_templates` + `clinical_template_versions`) y guarda sus valores en `clinical_notes.data`
  (jsonb). Tipos de campo: texto, texto largo, número con unidad, escala, opción única o múltiple,
  sí/no, fecha, lista con columnas (receta, diagnósticos CIE-10, procedimientos) e IMC calculado.
  La API valida el contenido con los campos de la plantilla (`clinicalNoteDataSchema`, compartido
  con el frontend) y sólo guarda lo completado. Las versiones no se modifican (trigger): si una
  plantilla cambia se crea otra versión, las evoluciones antiguas se muestran con la suya y escribir
  con una versión vieja responde 409. Plantillas de la plataforma (business_id null): Atención
  médica, Evolución general, Nota libre y una o dos por especialidad (psicología, odontología,
  nutrición, fisioterapia, fonoaudiología, medicina estética); se recomiendan según la categoría del
  negocio. `db:seed -- --reset` las conserva.

## Doble reserva

- **Nunca dos citas a la misma hora**: la reserva bloquea el negocio en su transacción
  (`lockBusiness`), vuelve a comprobar la hora y, además, la base lo impide con la restricción
  `appointments_no_overlap` (exclusión por profesional y franja en citas activas).
- **Citas por persona y día desde la página** (migración 021): `bookingSettings.maxClientBookingsPerDay`
  (1 por defecto; 0 = sin límite). Cuenta las citas activas de esa cédula ese día (también las del
  panel) y responde 409 con código `daily_limit`. Desde el panel no hay límite.
- **Reintento de la misma reserva**: si se pierde la respuesta y el paciente vuelve a confirmar, su
  propia cita ocupa la hora. Si la misma cédula tiene una cita activa reservada online hace menos de
  30 minutos con el mismo servicio, fecha, hora y modalidad (y el mismo profesional, si lo eligió),
  **y coinciden el email o el teléfono**, se devuelve la confirmación de esa cita, sin crear otra ni
  reenviar emails, y **sin los datos ni el enlace de pago** (`payment: null`, `paymentByEmail: true`:
  la página dice "Revisa tu email para pagar"). Con otro email y otro teléfono es "hora ocupada".
- **Topes contra reservas falsas** (con cédulas inventadas, el algoritmo es público): un negocio
  recibe como mucho 30 reservas online en 24 h (`ONLINE_BOOKINGS_PER_DAY`; en un plan con cupo
  mensual, una cuarta parte del cupo: Free, 5) y la página le crea como mucho 15 clientes nuevos en
  24 h (`ONLINE_NEW_CLIENTS_PER_DAY`). Al llegar, 429 `rate_limited`: "no puede recibir más reservas
  online por hoy, escríbele por WhatsApp". Los clientes creados por la página (`clients.source =
  'booking_page'`) que nunca tuvieron una cita sin cancelar no cuentan para el tope de clientes del
  plan: el negocio cancela las reservas falsas y recupera el cupo.
- Pruebas: `tests/concurrency.test.ts`, `tests/booking-limits.test.ts` (reservas simultáneas de la
  misma persona y de personas distintas) y `tests/booking-retry.test.ts` (reintentos y fichas por email).

## Rendimiento y crecimiento

- **El panel no descarga el historial**: cada pantalla pide sólo su rango de citas (`from`/`to`);
  `GET /businesses/:id/appointments/:id` trae una cita suelta y `GET /businesses/:id/clients/activity`
  calcula en la base el resumen de cada cliente (totales, primera visita, última y próxima cita).
- **Página de reservas en la CDN**: `GET /public/businesses/:slug` responde con
  `Cache-Control: public, s-maxage=30, stale-while-revalidate=60`; Vercel la sirve sin llegar a la
  API en los picos de visitas. La reserva vuelve a comprobar la hora al confirmarla.
- **Contenido de los emails**: el cron borra el texto y el HTML de los emails con más de 30 días
  (`EMAIL_CONTENT_DAYS`) y deja el registro (a quién, tipo, asunto, fecha y estado).
- **Conexiones**: en Vercel, 3 por instancia por defecto (`DATABASE_POOL_MAX`); en local, 10.
- **Aviso de espacio**: la copia de seguridad semanal informa el tamaño de la base y avisa por ntfy
  (prioridad alta) si pasa de 350 MB (`DATABASE_WARN_MB`) de los 500 MB del plan gratis de Supabase.
- El hash de referencia del login es fijo: no se calcula bcrypt en cada arranque del servidor.

## Seguridad

- **Sesión:** cookie `httpOnly` con un token aleatorio; en la base sólo se guarda su hash (tabla
  `sessions`). Caduca por inactividad (migración 028): sin "Recordarme", a las 12 horas sin usarla
  (y como mucho 24 desde que se inició; la cookie se borra al cerrar el navegador); con
  "Recordarme", a los 14 días sin usarla: cada uso la renueva otros 14 días, también la cookie, pero
  como mucho 30 días desde que se inició (7 la del super admin, spec 009). El
  último uso (`sessions.last_seen_at`) se anota como mucho cada 5 minutos. Las sesiones abiertas
  antes de la migración siguen valiendo con esos límites. Cuando el super admin cambia una
  contraseña (la de otro o la suya), al activar la verificación en dos pasos o al desactivar una
  cuenta, se cierran sus (demás) sesiones.
- **Contraseñas** con bcrypt. El login tarda lo mismo exista o no el email.
- **Bloqueo por intentos fallidos:** se frena a la conexión que falla, no a la cuenta (el email del
  dueño es público: cualquiera podría dejarlo fuera a propósito). En 15 minutos y desde el último
  inicio de sesión correcto: 10 fallos con una cuenta desde una conexión la bloquean para esa cuenta
  (aunque la contraseña sea la correcta); 50 desde una conexión, con cualquier cuenta, la bloquean
  entera; y 30 con una cuenta sumando todas las conexiones (un ataque repartido entre muchas IP)
  dejan probar sólo desde conexiones en las que esa cuenta ya inició sesión. Se cuentan en la
  auditoría, así que valen para todas las instancias. Un email no registrado se bloquea igual: no
  revela qué cuentas existen. Cada intento se aparta **antes** de comprobar la contraseña o el código
  (contadores atómicos en `rate_limits`, `reserveAttempt` en `src/services/session-security.ts`):
  con cien intentos a la vez sólo se comprueban los del tope (spec 009). Lo mismo vale para la
  contraseña o el código que se piden con la sesión abierta (cambiar el email o la contraseña,
  desactivar la verificación, códigos de recuperación nuevos): cuentan para el mismo bloqueo y sus
  fallos quedan en los eventos de sesión.
- **Verificación en dos pasos** (TOTP: Google Authenticator, Microsoft Authenticator…) para la
  cuenta de super admin, desde Configuración. **Es obligatoria** con datos reales (producción, la
  nube o la base de producción desde tu ordenador; con una base local, sólo con
  `SUPER_ADMIN_2FA=required`): mientras no la active, el super admin inicia sesión (la sesión trae
  `twoFactorSetupRequired: true`), pero `/admin`, `/businesses` (modo soporte) e `/images` responden
  403 `two_factor_required` y el frontend le muestra la pantalla para activarla. Tras la contraseña, el login devuelve
  `{ twoFactorRequired, challenge }` y la sesión se abre en `POST /api/auth/login/two-factor` con
  el código de 6 dígitos (cada uno sirve una vez) o un código de recuperación (10, guardados como
  hash). 5 códigos incorrectos anulan el paso; cuentan para el bloqueo de la cuenta. Desactivarla
  pide la contraseña y un código (`src/services/two-factor.ts`, `src/services/totp.ts`). El secreto
  se guarda **cifrado** (AES-256-GCM con `TWO_FACTOR_KEY`, `src/services/secret-box.ts`); los de antes,
  en claro, se cifran con el siguiente código correcto. Activarla o desactivarla, y que un super
  admin cambie su contraseña, **avisa**: un email al momento a la cuenta y al super admin principal
  (`account_security_changed`) y un aviso por ntfy en la siguiente pasada del cron
  (`src/services/account-alerts.ts`), también tras `db:reset-2fa`.
  **Emergencia** (celular y códigos perdidos): `npm run db:reset-2fa -- <email>` desde tu ordenador.
- **Contraseñas fuera del registro de emails:** los emails con datos de acceso se guardan con la
  contraseña oculta (`••••••••`); ésta va aparte (`notifications.secret`) sólo hasta que el email
  se envía o se descarta.
- **CAPTCHA** (Cloudflare Turnstile) en las reservas de la página pública y en el registro
  (`/auth/register`, que envía la bienvenida a la dirección escrita), con `TURNSTILE_SITE_KEY` y
  `TURNSTILE_SECRET_KEY` (`src/http/captcha.ts`). Sin ellas no se pide: en producción alojada se
  registra un error al arrancar y `/api/health` responde `captcha: false`. Con ellas, todo lo que no
  sea una respuesta válida de Cloudflare se rechaza (si Cloudflare falla o no responde, 503 "inténtalo
  de nuevo"), y el token debe venir de un dominio del frontend (`hostname` de `FRONTEND_URL`,
  `APP_URL` o `TURNSTILE_HOSTNAMES`).
- **Topes contra el abuso de los emails** (`src/services/email-limits.ts`, spec 009), al poner en
  cola: como mucho 150 emails al paciente en 24 h por lo que provoca el público (reservas online y
  registros, `PUBLIC_EMAILS_PER_DAY`), así que quien llene la cuenta con reservas falsas no deja a los
  negocios sin recordatorios ni avisos; y 20 confirmaciones de reservas online a pacientes nuevos por
  negocio en 24 h. Lo que pasa de un tope queda en el historial como fallido ("No enviado: …") y avisa
  una vez al día en el registro y por ntfy (`NTFY_TOPIC` también en la API). El cupo diario de la
  cuenta de Gmail es otra cosa: no descarta nada, hace esperar (ver «Cupo de Gmail» en «Emails»). El
  tope de 400 emails a terceros (`THIRD_PARTY_EMAILS_PER_DAY`) ya no existe (spec 015).
- **Página pública** sin datos internos: ni el propietario, ni los avisos, ni el motivo de los
  bloqueos, ni el precio de los servicios que lo ocultan.
- **Datos demo** (`db:seed`) sólo en una base local: con el `.env` apuntando a Supabase se niega.
- **Multi-tenant:** cada operación comprueba que la sesión pertenece al negocio, que no está
  suspendido y que su rol tiene permiso (`src/shared/lib/permissions.ts`).
- **Concurrencia:** las escrituras de un negocio bloquean su fila durante la transacción: dos
  reservas simultáneas a la misma hora nunca se confirman ambas y los límites del plan no se
  superan. Además, PostgreSQL impide citas activas solapadas (restricción `appointments_no_overlap`).
- **CSRF:** las peticiones que modifican datos exigen la cabecera `X-Requested-With`; CORS sólo
  admite `FRONTEND_URL`.
- **Límite de intentos** por IP en login, registro, reservas públicas, pagos, «Tu cita» e imágenes. Las cuentas
  se guardan en PostgreSQL (tabla `rate_limits`, `src/http/rate-limit-store.ts`): todas las
  instancias de Vercel o Lambda comparten el mismo límite (antes cada una contaba en su memoria). Las
  IPv6 cuentan por subred /64. El cron borra las cuentas caducadas. En Vercel la IP del visitante
  llega desde el proxy del frontend en `x-agendo-client-ip`, firmada con `PROXY_SECRET` y la hora
  (`x-agendo-client-ts`, `x-agendo-client-sig`: HMAC-SHA256 de `<ip>.<segundos>`, válida 2 minutos;
  `src/http/secrets.ts` y `client-ip.ts`): nadie puede falsear su IP, y una firma vista no sirve
  después. El secreto fijo en una cabecera que se usaba antes (`x-agendo-proxy-secret`) ya no vale
  (fase 2 de la spec 009).
- **Function URL de Lambda cerrada:** en Lambda la API responde 403 a todo lo que no traiga la firma
  del proxy (comparada en tiempo constante), salvo `GET /api/health`: sólo se entra por el frontend.
- **En la nube no arranca desprotegida** (spec 009, `src/config.ts`): en Vercel o Lambda, si faltan
  las claves de Turnstile, `PROXY_SECRET` o `TWO_FACTOR_KEY`, si `DATABASE_SSL` no es `true` (con una
  base remota) o si `DATABASE_URL` lleva `sslmode`, el proceso termina con «Configuración insegura
  para la nube: …» (lo que falta, sin valores) y no atiende. Allí la cookie va siempre `Secure`.
- **Respuestas públicas sin cookie:** `/api/public/*` se atiende antes de cargar la sesión, así que
  ninguna respuesta pública (algunas las guarda la CDN) lleva `Set-Cookie`; el frontend las pide sin
  credenciales.
- **Cada uno recibe sólo lo que necesita:** la bandeja de emails del negocio no muestra los dirigidos
  a la plataforma (la solicitud de plan a los super admin); el rol Profesional recibe en blanco el
  email, la sala y las cuentas bancarias de las agendas que no son suyas; y la ficha de otro usuario
  pide al super admin la verificación en dos pasos, como el resto del panel.
- **Nombres del público** (reserva y registro): sin saltos de línea, «@», ni enlaces o dominios
  (`personNameField`), para que nadie use los emails de la plataforma para mandar textos a terceros.
- **RLS activado** en todas las tablas: con Supabase, la API REST automática (clave anónima) no
  puede leer nada; sólo esta API (dueña de las tablas) accede a los datos.
- `helmet` para las cabeceras HTTP.
- **Conexión a la base comprobada (TLS):** con `DATABASE_SSL=true` la conexión va cifrada y sólo
  se acepta un certificado firmado por la CA raíz de Supabase (*Supabase Root 2021 CA*, válida
  hasta abril de 2031) y con el nombre del servidor (`src/db/tls.ts`); `pg_dump`, con
  `sslmode=verify-full`. Sin esto, alguien en medio de la red podría hacerse pasar por la base y
  quedarse con la contraseña y los datos. Con otro proveedor se usan los certificados del sistema;
  las bases locales (`DATABASE_SSL=false`) no cambian. La CA va como texto en `tls.ts` (Vercel sólo
  compila el código: un `.crt` aparte no llegaría). Si Supabase la cambia, sustituye el texto por el
  nuevo certificado y compruébalo:

  ```bash
  curl -fsSL https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt | openssl x509 -noout -subject -issuer -enddate -fingerprint -sha256
  ```
- **Respuestas privadas sin caché:** las de `/api` llevan `Cache-Control: no-store`
  (`src/http/no-store.ts`, montado en `src/server.ts`: en local y en Lambda); las rutas públicas que
  ponen su propia caché (perfil público, categorías, imágenes locales) la conservan.
- **Registros sin datos personales:** un error inesperado se registra sólo con su nombre, código,
  tabla, restricción, mensaje y pila (`errorForLog` en `src/http/errors.ts`), nunca entero: los de
  PostgreSQL traen en `detail` la fila con los datos del paciente. Los avisos de ntfy del cron
  (resumen de correos y uno por cada reserva desde la página) llevan a los pacientes a medias
  ("Juan P.", "ju***@gmail.com", "***5555", ver `src/services/masking.ts`), y el registro
  público de Actions sólo el título y cifras.
- **API local sólo en este equipo** (`127.0.0.1`) y almacenamiento local encerrado en su carpeta
  (ver "Almacenamiento"): nadie de la misma Wi-Fi puede pedir `/api/files/public/…/..%2F..%2F.env`.
- **GitHub Actions:** cada acción fijada por el SHA de su commit (con la versión en un comentario) y
  la imagen `postgres:17` de `backup.yml` por su digest: una etiqueta movida no cambia el código que
  ve los secretos. Dependabot (`.github/dependabot.yml`) propone cada semana las actualizaciones de
  las acciones y de npm (pull requests a `dev`; empieza a funcionar cuando el archivo llega a
  `main`). El digest de postgres se actualiza a mano de vez en cuando; el actual se consulta con:

  ```bash
  curl -fsS https://hub.docker.com/v2/repositories/library/postgres/tags/17 | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>console.log(JSON.parse(s).digest))'
  ```
- **Copias de seguridad fuera del repositorio** (que es público): `.gitignore` cubre
  `*.sql.gz.enc`, `*.sql.gz`, `/agenda360-*.sql` y `/backups/` (no `*.sql`: las migraciones lo son)
  y `backup:decrypt` deja el volcado en `~/Agenda360-copias` (ver "Copias de seguridad").

## Emails

Los servicios guardan cada email "en cola" (tabla `notifications`) dentro de la misma transacción
que el cambio que lo provoca; `src/services/mailer.ts` los envía por Gmail en segundo plano y los
marca como enviados o, tras 8 intentos, fallidos (con el motivo en `last_error`).

- **Reintentos con espera creciente** (migración 027, `notifications.next_attempt_at`): tras cada
  fallo, el siguiente intento espera el doble (5 min, 10, 20… 320): unas 10 horas en total, así una
  caída de Gmail no agota los intentos en minutos.
- **Cada email se marca apenas sale**: el lote se toma con una consulta corta (`for update skip
  locked`) que lo reserva 10 minutos (`next_attempt_at`) y cada email queda `sent` al enviarse, sin
  transacciones largas. Si el proceso muere a mitad (tiempo máximo de Lambda, Vercel o Actions), lo
  enviado no se repite y lo pendiente vuelve a la cola al vencer la reserva. Nodemailer tiene
  límites de conexión (8 s) y de inactividad (12 s); el cron deja de empezar envíos a los 6 minutos.
- **Recordatorios** (`runReminderJob`, reglas en `src/services/reminder-rules.ts`): salen
  `reminderHoursBefore` horas antes, pero nunca entre las 21:00 y las 7:00 del negocio (a las 7:00
  salen los de las citas que aún no empezaron), ni si la cita se agendó, se movió o se reactivó ya
  dentro de esas horas y el negocio envía confirmaciones (el paciente acaba de recibir la
  confirmación o el aviso del cambio). Hay uno por cada fecha y hora de la cita (clave
  `dedupe_key` con `appointments.scheduled_at`, que cambia al reprogramarla o reactivarla): al
  moverla, sale otro para la fecha nueva. Antes de enviarlo se comprueba otra vez: si la cita se
  canceló, cambió o ya empezó, se descarta; en horas de silencio, espera a las 7:00. La copia al
  profesional de un recordatorio que sí le llegó al paciente sale aunque la cita haya cambiado o
  empezado mientras esperaba el cupo de Gmail (spec 015): la copia nunca se descarta.
- **Cambios que se avisan al paciente**: fecha, hora, servicio, profesional o modalidad (en el
  local, virtual o a domicilio, y la dirección de la visita). Una cita cancelada que vuelve a estar
  activa le envía "Tu cita ha sido restablecida". En las citas virtuales la hora lleva la zona del
  negocio ("10:00 (hora de Ecuador, GMT-5)"): el paciente puede estar en otro país.
- **Zona horaria**: la API sólo acepta zonas que existen (`isValidTimezone`); la migración 027 pasó
  a America/Guayaquil las inválidas que ya estaban guardadas. Si aun así falla un negocio, el cron
  lo registra y sigue con los demás y con la cola de emails (el aviso de ntfy lo cuenta).

- **Fuera de producción todos los emails se redirigen a `EMAIL_REDIRECT_TO`** (por defecto la propia
  cuenta de Gmail), con el destinatario original en el asunto. Así nunca se escribe a clientes de prueba.
- Las direcciones de los datos demo (`@demo.com`, `@example.com`) nunca reciben emails.
- En local, los recordatorios se ponen en cola cada `REMINDER_JOB_INTERVAL_MINUTES` minutos y la cola
  se revisa cada minuto. **En producción** el trabajo se reparte:
  - **La API en Vercel** envía al momento las confirmaciones y avisos de las citas (con `waitUntil`,
    la función sigue viva tras responder). No envía recordatorios.
  - **El cron de GitHub** (`scripts/cron.ts`, cada 10 min) trabaja **aislado de Vercel**: se conecta
    directamente a la base y a Gmail, pone en cola y envía los recordatorios, reintenta los correos
    que la API no pudo enviar y limpia lo caducado. **Avisa por ntfy** de lo enviado o fallido y da
    señal de vida a healthchecks.io. Cada ejecución queda en la tabla `cron_runs` (30 días).
  - **Avisos por ntfy de pacientes** (`src/services/booking-alerts.ts`), con los datos a medias:
    - **cada reserva por la página:** dice de cada persona si es «Paciente nuevo» o «Ya era paciente»;
    - **cada cita agendada desde el panel:** lo mismo que una reserva, con quién la agendó y su rol
      (sale del registro de actividad `appointment.created`);
    - **cada paciente registrado desde el panel:** dice quién lo registró y con qué rol (sólo
      `source = 'dashboard'`: los importados no salen uno por uno);
    - **cada importación de pacientes** (spec 012): «Agenda360: pacientes importados», con el negocio,
      la cifra («Importó 200 pacientes (3 ya existían, 5 con errores)») y quién la hizo, sin datos de
      pacientes. Sale del registro de actividad (`client.imported`); la línea del registro del cron
      suma «importaciones: N»;
    - **cada cambio de estado de una cita** (spec 008): de qué estado a cuál, quién lo hizo y a quién
      salieron los emails, o «Sin avisar al paciente». Sale del registro de actividad (las entradas
      con «Estado» en `changes`), así que entran los botones de estado, el formulario de la cita y la
      cancelación desde «Tu cita» (spec 010), que se titula «Agenda360: cita cancelada por el
      paciente» y dice «Cancelada por el paciente desde su email». «Confirmo que voy» no avisa;
    - **cada serie de citas del panel** (spec 011): un solo aviso («Agenda360: nueva serie de citas»)
      con cuántas, cada cuánto, desde y hasta cuándo, cuántas no se crearon, quién y sus emails; sus
      citas no tienen aviso propio. «Cancelar ésta y las siguientes» también avisa una sola vez
      («Agenda360: serie de citas cancelada»), sin un cambio de estado por cada cita.

    Hasta 10 de cada tipo por pasada; del resto sólo se dice cuántos son.
  - **Avisos al paciente en cada cambio de estado** (spec 008): además de la confirmación, la
    cancelación y «vuelve a estar agendada», salen «queda pendiente de confirmar» (con
    Confirmaciones), «gracias por tu visita» al marcar Completada y «elige otra hora» al marcar No
    asistió. Los dos últimos van con el interruptor `followUps` («Seguimiento», encendido si no está
    guardado) y sólo para citas de hoy o de los últimos 7 días. Todos llevan la copia al profesional.
    Con `notify: false` (la casilla «Avisar al paciente» desmarcada) no sale ninguno.
- **Cupo de Gmail** (spec 015): la cuenta de Gmail gratuita envía unos 500 emails en 24 h
  (`EMAIL_DAILY_QUOTA`, 500 por defecto; con Google Workspace, unos 2.000: se cambia la variable, no el
  código). Todos los envíos de las últimas 24 h cuentan juntos, y se mira **al enviar** (`claimBatch`
  en `mailer.ts`), no al poner en cola:
  - **Tres niveles** (`EMAIL_PRIORITY` en `email-limits.ts`; una prueba exige que cada tipo de email
    tenga el suyo): el **equipo** (contraseñas, seguridad, planes, altas) puede usar todo el cupo; el
    **paciente** (recordatorios, confirmaciones, bienvenidas), el cupo menos `EMAIL_TEAM_RESERVE` (20);
    el **negocio** (copias al profesional y avisos al negocio y a sus profesionales), el cupo menos
    `EMAIL_PATIENT_RESERVE` (100). Cada lote toma primero los del equipo, después los del paciente y al
    final los del negocio, y dentro de cada nivel los más antiguos: un aviso al negocio nunca le quita
    el sitio a un email al paciente.
  - **Lo que no cabe espera** en la cola (`queued`, `next_attempt_at` 30 minutos después y una marca en
    `last_error`), **sin gastar intentos y sin descartarse**: se vuelve a mirar en cada lote y sale en
    cuanto la ventana de 24 h libera cupo, antes que los nuevos de su nivel. Un día con muchas reservas,
    las copias al profesional salen al día siguiente. Un recordatorio que ya no llega a tiempo (la cita
    empezó) se descarta al enviarlo, como siempre.
  - **Al llegar al límite del paciente**, ntfy avisa una vez al día («Agenda360: se llegó al cupo de
    Gmail», sólo con cifras), y el aviso del cron suma «Esperan el cupo diario de Gmail: N».
  - **En Salud de `/admin`**: los envíos de 24 h frente al cupo (en ámbar desde el 80 %, en rojo al
    llegar al límite del paciente) y cuántos esperan, al paciente y al negocio.
  - Si Gmail rechaza igual (p. ej. la cuenta se usó desde otro lado), los emails se reintentan como
    siempre. El cupo se mira lote a lote: dos procesos a la vez (la API y el cron) pueden pasarse en un
    lote (10), y la reserva del equipo lo absorbe.
  - Para más volumen conviene un proveedor transaccional (Resend, SES…): sólo cambia `mailer.ts`.

## Avisos en el celular

Spec 013. El propietario de cada negocio y los super admin reciben avisos en el celular (o en la
computadora) desde la app instalada, como cualquier aplicación, con los avisos estándar de los
navegadores (Web Push): sin Play Store, App Store ni servicios de pago. Desde la spec 017, también cada
profesional (el rol Profesional con su agenda), sólo con el resumen de las 8 de su agenda. Los emails
no cambian: el aviso se suma.

- **Qué avisa:**
  - **al propietario, al momento:** cada reserva online (con «· Por verificar» si lo está), cada
    comprobante de pago, cada «Confirmo que voy» (la primera vez) y cada cancelación del paciente
    desde su email, y cada cita nueva en su agenda que agendó otra persona (Recepción, un
    administrador o el super admin en modo soporte);
  - **al propietario, desde el cron:** cada cita que terminó hace 30 minutos y sigue Pendiente o
    Confirmada («Cita por cerrar») y, a las 8 de la noche en la hora del negocio, «Tienes 3 citas de
    hoy sin cerrar» si queda alguna;
  - **a cada profesional, desde el cron (spec 017):** a las 8 de la noche, «Tienes 2 citas de hoy sin
    cerrar» con las de su agenda que ya terminaron y siguen Pendiente o Confirmada, si le queda alguna;
    una vez al día (clave `resumen:<agenda>:<fecha>`), sólo con la cifra, y abre la agenda de ese día.
    Va a quien tiene la agenda ese día, si sigue con el rol Profesional (audiencia `userOf` en
    `push-delivery.ts`). El propietario no recibe un segundo aviso por su propia agenda (ya tiene el del
    negocio). Su tarjeta sólo tiene ese tipo; sin una agenda activa no los puede activar (403 con el
    motivo). Recepción y los administradores siguen sin avisos al celular;
  - **al super admin:** al momento los negocios nuevos (el alta del registro, no los que crea él) y las
    solicitudes de plan; desde el cron los cambios de seguridad en cuentas de super admin y los
    intentos fallidos (además de ntfy, que no cambia).
- **Privacidad:** el paciente siempre a medias («Juan P.», `masking.ts`), nunca su cédula, email,
  teléfono ni nada de la historia clínica. El aviso viaja cifrado: Google, Apple, Mozilla o Microsoft
  lo transportan pero no lo pueden leer. Los registros (también los públicos del cron) sólo tienen
  cifras y el servicio (`fcm.googleapis.com, 403`), nunca títulos, textos ni direcciones de aparatos.
- **Actividad:** activar los avisos en un aparato, cambiar sus tipos, desactivarlos y el aviso de
  prueba quedan en la actividad del negocio (también los del profesional, a su nombre; o de la
  plataforma, los del super admin), con el navegador («Chrome en Mac»). La puesta al día silenciosa al abrir el panel y la pausa al cerrar
  sesión no.
- **Cómo funciona:**
  - `src/services/web-push.ts`: el estándar con `node:crypto`, **sin librería** — cifrado
    `aes128gcm` (RFC 8291, comprobado byte a byte con el ejemplo de la RFC en
    `tests/web-push.test.ts`), firma VAPID (JWT ES256, RFC 8292) y el `POST` al servicio de avisos
    (RFC 8030). Sólo envía a los servicios de los navegadores (`fcm.googleapis.com` y
    `jmt<N>.google.com` de Chrome, `updates.push.services.mozilla.com`, `web.push.apple.com` y
    `*.notify.windows.com`); cualquier otra dirección se rechaza al guardarla y al enviar.
  - `push_subscriptions` (migración 040): un aparato por navegador, del usuario, con los tipos que
    no quiere. El negocio se deduce al enviar (`businesses.owner_id`): cambiar el propietario deja de
    avisar al anterior. «Cerrar sesión» pausa los aparatos de esa sesión; al volver a entrar, la app
    los reanuda sola. Hasta 10 por persona.
  - `push_messages`: la cola, como la de los emails. Quien provoca el aviso lo pone en cola dentro de
    su transacción, en un punto de guardado: **si algo falla (p. ej. falta la migración), la reserva y
    sus emails siguen igual**. Sale al momento, 1 s después y sin retrasar la respuesta (en Vercel con
    `waitUntil`; en Lambda, `flushPushDelivery` al responder). Lo que no salió lo reintenta el cron a
    los 1, 5, 15 y 60 minutos, hasta 24 h. Un 404 o 410 da de baja el aparato (desinstaló la app),
    salvo en sus 2 primeros minutos: Google a veces lo responde nada más suscribirse y segundos después
    lo acepta. Cinco rechazos seguidos (400, 401, 403, 413) también lo dan de baja.
  - Qué dice cada aviso (los textos salen de `describeNotice`, en `src/shared/lib/notices.ts`, los
    mismos de la campana del panel) y a quién va: `src/services/push-notices.ts`. Las rutas: `src/routes/push-routes.ts`
    (`avisos-aparato`: 30 cambios y `aviso-prueba`: 5 avisos de prueba por conexión en 15 min).
  - El cron (`runPushJobs` en `scheduled-tasks.ts`) pone en cola las citas por cerrar, el resumen de
    las 8 y los del super admin, envía la cola (60 s como mucho) y limpia: avisos de más de 7 días y
    aparatos en pausa hace más de 90. Su registro suma «avisos en la app: enviados N · fallidos N ·
    aparatos dados de baja N»; si fallan avisos y no sale ninguno, ntfy avisa con «Agenda360: los
    avisos en la app no salen».
  - **Enganche para las series de la spec 011:** `notifyNewSeries(db, citas, actor.userId)` avisa una
    sola vez por serie («Citas nuevas en tu agenda · 8 citas desde el mar 20 oct 10:00 · Juan P.»).
- **Las claves (VAPID):** `npm run push:keys` crea el par y muestra `VAPID_PUBLIC_KEY=…` y
  `VAPID_PRIVATE_KEY=…`. Van en Vercel, en Lambda y en los secretos de GitHub (ver "Despliegue en
  Vercel"); `VAPID_SUBJECT` (el contacto, `mailto:` o `https:`) es opcional. **Sin claves, o con una
  mal copiada, la API arranca igual** y no hay avisos: `/api/health` dice `"push": false` y el
  registro, «Avisos en el celular desactivados: falta VAPID_PRIVATE_KEY.» (nunca un valor). Guárdalas
  como `TWO_FACTOR_KEY`: si se pierden o se cambian, cada aparato tiene que volver a activar los avisos
  (en Chrome, Edge y Firefox se arregla solo al abrir el panel; en el iPhone hace falta un toque).
- **En local:** `npm run dev:local` crea un par de desarrollo en `.local-db/vapid.json` (fuera de git)
  y las pruebas, el suyo. Los avisos sólo se prueban con la versión compilada del front (`npm run
  build` y `npx vite preview`): en `npm run dev` no hay service worker. Chrome los recibe de verdad
  en `http://localhost` (el servicio de Google funciona también en local). Con la base local, la API
  acepta además direcciones `http://127.0.0.1:<puerto>`, para el servicio de avisos falso de las
  pruebas (`tests/helpers/harness.ts`); nunca en la nube ni con la base de producción.
- **iPhone:** sólo con la app instalada en la pantalla de inicio e iOS 16.4 o más reciente (regla de
  Apple); la tarjeta de Configuración lo explica.

## Centro de avisos del panel

Spec 014. El panel del negocio y el de /admin tienen una **campana** con el número de avisos sin
leer («9+» con más de 9): en la computadora, junto al logo del menú lateral; en el celular, a la
derecha de la barra de arriba. Al tocarla se ven los últimos 20, y «Ver todos» abre la página
«Avisos» con los de los últimos 30 días. No hace falta activar nada: la campana no depende de los
avisos en el celular (los del propietario y el super admin y, desde la spec 017, el resumen de las 8
de cada profesional).

- **Qué le llega a cada uno** (la tabla de la spec, decidida al leer con lo que la persona es hoy):
  - **el propietario:** las reservas online (también «Por verificar»), los comprobantes, las
    confirmaciones y las cancelaciones del paciente y las citas por cerrar de todas las agendas, el
    resumen de las 8 del negocio y «Cita nueva en tu agenda» de la suya;
  - **Recepción y los administradores:** las reservas, los comprobantes, las confirmaciones y las
    cancelaciones del paciente de todas las agendas;
  - **quien tiene una agenda** (sea cual sea su rol; el rol Profesional sólo ve por aquí): todo lo de
    su agenda, también «Cita nueva en tu agenda» si la agendó otra persona, sus citas por cerrar y el
    resumen de las 8 de su agenda;
  - **el super admin**, en /admin: los negocios nuevos, las solicitudes de plan, los cambios de
    seguridad en cuentas de super admin y los intentos fallidos. En modo soporte no ve la campana del
    negocio (la API responde 403 «La campana es del equipo del negocio.»).

  Además, quien lo provocó no lo ve, cada persona sólo ve lo de desde que entró al equipo y la cita
  cuenta en su agenda de hoy (si se mueve a otra agenda, lo ve la profesional nueva). La regla es una
  constante compartida con el front y la beta, `NOTICE_AUDIENCE` (`src/shared/lib/constants/notices.ts`),
  y la consulta (`AUDIENCE_SQL` en `src/services/panel-notices.ts`) sale de ella.
- **Privacidad:** dentro del panel el paciente va con su nombre completo («Juan Pérez», decisión del
  dueño del 2026-10-15), porque el equipo ya lo ve así en la agenda; el celular y ntfy siguen a medias.
  Nunca la cédula, el email, el teléfono ni nada de la historia clínica. Los avisos de citas **no
  guardan el texto**: se arma al leer con los datos de hoy de la cita y los mismos constructores del
  celular (`describeNotice`, `src/shared/lib/notices.ts`). Así las fechas no se quedan viejas
  («Mañana» de ayer dice «Hoy») y al borrar un paciente (y con él sus citas) sus avisos desaparecen
  sin dejar su nombre en ninguna parte. Los del super admin sí guardan su texto (no tienen pacientes).
- **Actividad:** leer un aviso o «Marcar todo como leído» no va a la actividad (es una consulta de la
  propia persona), y crear los avisos tampoco: lo que los provoca ya queda registrado.
- **Cómo funciona:**
  - Migración 041: `panel_notices` (un aviso por suceso, no uno por persona), `panel_notice_reads`
    (qué leyó cada persona) y `panel_notice_state` (la hora de su «Marcar todo como leído»).
  - Los avisos se guardan en los mismos puntos que los del celular (`push-notices.ts`), haya o no
    aparatos, cada uno en su propio punto de guardado (`aviso_panel`): **si algo falla (p. ej. falta la
    migración 041), la reserva, la cita, los emails y el aviso al celular siguen igual**, y el registro
    sólo dice el tipo y el código.
  - El cron mira ahora todos los negocios activos para las citas por cerrar y el resumen de las 8 (el
    resumen va también por agenda, a quien la tiene si no es el propietario), guarda los del super
    admin y borra los avisos de más de 30 días. Su línea del registro suma «avisos del panel: N
    (borrados, más de 30 días: N)».
  - El contador (`…/notices/unread`) es una consulta con índices y sin textos: el front lo pide al
    abrir el panel, al volver a la pestaña, cada 3 minutos sólo con la pestaña visible y al momento
    cuando el service worker recibe un aviso al celular en ese navegador. Unos 10 minutos de CPU de
    Vercel al mes en una cuenta generosa; si sube, se alarga `NOTICE_REFRESH_MS`.
- **Publicación:** la migración 041 se aplica antes del código que la usa (`npm run db:migrate`, como
  paso aparte). Mientras el backend nuevo no está publicado, el front no muestra la campana (la ruta
  responde 404) y nada da error. No hay variables nuevas. En local, `npm run dev:local` aplica la 041
  al arrancar.

### Token de Gmail que sólo puede enviar (`GMAIL_TRANSPORT=api`)

Por SMTP (lo de siempre, `GMAIL_TRANSPORT` vacía o `smtp`) Google exige el permiso
`https://mail.google.com/`, que da acceso a **todo el buzón**: quien robe el refresh token puede
leer, borrar y reenviar cualquier correo de la cuenta. Con `GMAIL_TRANSPORT=api` los emails salen
por la API de Gmail (`users.messages.send`, `src/services/gmail-transport.ts`), que funciona con el
permiso `https://www.googleapis.com/auth/gmail.send`: con el token sólo se puede enviar. El mensaje
lo compone nodemailer igual que por SMTP; vale para la cola, el cron y las copias de seguridad.

1. **Google Cloud Console**, en el proyecto del cliente OAuth de `GMAIL_CLIENT_ID`:
   - *APIs y servicios → Biblioteca → Gmail API → Habilitar*.
   - *Pantalla de consentimiento de OAuth*: estado *En producción* (en *Prueba* el refresh token
     caduca a los 7 días).
   - *Credenciales*: el cliente OAuth debe ser de tipo *Aplicación web* con la URI de redirección
     `https://developers.google.com/oauthplayground` (añádela si no está).
2. **Quita el acceso antiguo** (el del buzón entero): <https://myaccount.google.com/permissions> con
   la cuenta de `GMAIL_USER` → la aplicación → *Quitar acceso*. Desde ese momento el envío falla
   hasta el paso 4: los emails quedan en cola y se reintentan solos.
3. **Genera el token nuevo** en <https://developers.google.com/oauthplayground>:
   - Engranaje → *Use your own OAuth credentials* → `GMAIL_CLIENT_ID` y `GMAIL_CLIENT_SECRET`.
   - *Step 1*: escribe sólo `https://www.googleapis.com/auth/gmail.send` → *Authorize APIs* → entra
     con la cuenta de `GMAIL_USER` y acepta.
   - *Step 2*: *Exchange authorization code for tokens*. La respuesta debe decir
     `"scope": "https://www.googleapis.com/auth/gmail.send"` (nada más). Copia el *Refresh token*.
4. **Cámbialo en todas partes a la vez** (con este token, SMTP ya no funciona):
   - `.env`: `GMAIL_REFRESH_TOKEN` nuevo y `GMAIL_TRANSPORT=api`.
   - Vercel (proyecto de la API): las mismas dos variables y *Redeploy*.
   - Lambda (*Configuration → Environment variables*): las mismas dos.
   - GitHub → *Settings → Secrets and variables → Actions*: secreto `GMAIL_REFRESH_TOKEN` y
     **variable** `GMAIL_TRANSPORT` = `api` (la usan `cron.yml` y `backup.yml`).
5. **Comprueba**: `npm run dev:local` muestra `✓ Emails por Gmail (…, API de Gmail)` y una reserva de
   prueba envía su email; en GitHub, *Actions → Recordatorios y correos → Run workflow*.

Vuelta atrás: `GMAIL_TRANSPORT` vacía y un refresh token con `https://mail.google.com/`.

## Citas por cerrar

Spec 018. Una cita que ya terminó (en la hora del negocio) y sigue **Pendiente** o **Confirmada** está
«por cerrar». Las de **días anteriores** (antes de hoy en la zona del negocio) bloquean el panel de quien
puede cerrarlas hasta que las cierre o pulse «Más tarde»; las de hoy salen en la lista, pero no
bloquean. **Nada se cierra solo** (decisiones del dueño del producto, 2026-10-15).

- **Cada uno lo suyo** (`agendaScope`): el rol Profesional, las de su agenda (sin agenda asignada, 403);
  el propietario, los administradores, Recepción y el super admin en modo soporte, las de todo el
  negocio (también las de una agenda sin usuario).
- **La lista** (`GET …/appointments/to-close`, `src/services/appointments-to-close.ts`): de la más vieja
  a la más nueva (fecha, hora e id), en tandas de 50 con cursor, con los pacientes (el principal
  primero), el servicio, el profesional y si es de un día anterior (`overdue`). Trae también las cifras
  de toda la lista. Usa el índice `(business_id, date)` y compara el fin de la cita como instante en la
  zona del negocio (una cita que termina a las 24:00 termina a la medianoche).
- **El contador** (`…/to-close/count`): sólo `{ overdue, today }`, sin nombres. El front lo pide como el
  de la campana: al entrar, al volver a la pestaña y cada 3 minutos sólo con la pestaña visible.
- **Cerrar una:** la ruta de siempre, `PATCH …/appointments/:id/status`, con `notify` (la casilla
  «Avisar a los pacientes», apagada por defecto) y `onlyIfOpen: true`: si otra persona ya la cerró, se
  respeta su estado y responde 409 («Alguien ya cerró esta cita: está «No asistió»…»).
- **«Marcar todas como completadas»** (`POST …/appointments/close-all`): las que se ven en la lista
  (hasta 200 por petición), en una transacción y con la fila del negocio bloqueada, como cada cambio de
  estado. Sólo cierra las de quien llama que siguen por cerrar (y ya terminaron); las demás vuelven en
  `skipped` sin tocarlas.
- **Actividad y emails:** cada cierre, uno por uno o en bloque, pasa por el mismo cambio de estado que
  la ficha (`changeAppointmentStatus`): una entrada por cita con «Estado» en los cambios (la lee también
  el aviso de ntfy) y, sin la casilla, «(sin avisar al paciente)» y ningún email en la cola. Con la
  casilla, los emails de la spec 008, que entran en el cupo de Gmail al enviarse (spec 015). «No
  asistió» suma a las inasistencias del paciente, como siempre. Consultar la lista o el contador no va
  a la actividad.
- **Publicación:** sin migración ni variables. Primero el backend y después el front: mientras el
  backend nuevo no está publicado, el front no bloquea ni muestra la franja (la ruta responde 404).

## Citas completadas fijas

Spec 020. Una cita **Completada** queda fija: no cambia de estado ni de datos, salvo el pago, los
comprobantes, las notas y su historia clínica. **Ninguna cita vuelve a Pendiente** una vez que salió de
ese estado; «No asistió» y «Cancelada» se siguen cambiando, y una cancelada se reactiva como Confirmada.
Si alguien se equivoca, la corrige el propietario con un motivo (decisiones del dueño del producto,
2026-10-16).

**Las citas del panel nacen Confirmadas** (2026-10-17): `POST /businesses/:id/appointments` y
`POST /businesses/:id/appointment-series` responden 400 con `PANEL_PENDING_MESSAGE` si llegan
«Pendiente». Sólo las reservas online (`source = 'booking_page'`) nacen Pendientes. Desde el panel se
puede crear también como Completada, No asistió o Cancelada, para registrar una sesión que ya pasó. Al
corregir una completada que ya terminó, «Confirmada» no se ofrece (`correctionTargets`): volvería a
quedar por cerrar.

- **La regla, en un solo lugar:** `canChangeStatus(from, to)` y `statusChangeError` de
  `src/shared/lib/constants/appointment-status.ts` (se copia del front con `sync:shared`). Desde
  «Completada», nada; a «Pendiente», sólo desde «Pendiente»; lo demás, sí. La usan la API, el front y la
  beta, con los mismos mensajes.
- **Dónde se cumple** (`business-data-service.ts`): `changeAppointmentStatus` (la ficha, «Por cerrar» una
  por una y «Marcar todas») y `PUT …/appointments/:id` responden 409 con el mensaje de la regla. En una
  completada, «Editar» sólo acepta otras notas: otro paciente, otros pacientes de la sesión, otro
  servicio, otra fecha, hora o duración, otro precio, otro lugar u otro profesional, 409 («Esta cita está
  completada: sólo se pueden cambiar sus notas…»). Sin `extraClientIds` ni `professionalId` (un panel
  anterior) se toman los que tenía. A una completada tampoco se le quita la llegada.
- **Lo que ya sólo tocaba citas abiertas** sigue igual: «Marcar que llegó», «Cancelar ésta y las
  siguientes», «Tu cita» (confirmar y cancelar desde el enlace del paciente), «Marcar todas como
  completadas» y mover una cita en la agenda. El pago (`PATCH …/payment`), los comprobantes y la
  historia clínica no miran el estado. Unir una reserva «Por verificar» a la ficha cambia el paciente de
  sus citas, también de las completadas: es la misma persona.
- **La corrección** (`POST …/appointments/:id/correct-status`, `appointmentService.correctStatus`): sólo
  `actor.role === "owner"`, que incluye al super admin en modo soporte; los administradores, Recepción y
  el rol Profesional reciben 403 («Sólo el propietario puede corregir…»). Sólo desde «Completada» y hacia
  Confirmada, No asistió o Cancelada (`appointmentCorrectionSchema`, compartido). Guarda como un cambio de
  estado (`saveStatusChange`, sin la regla del bloqueo): la actividad, `appointment.status_corrected`,
  dice «Corrigió el estado de la cita de … de «Completada» a «No asistió». Motivo: …», con «Estado» en
  los cambios, y ntfy la avisa como cualquier cambio de estado. Sin `notify` (por defecto), ningún email
  y la actividad termina en «(sin avisar al paciente)». Después, la cita sigue las reglas de su nuevo
  estado.
- **Pruebas:** `tests/completed-appointments.test.ts`.
- **Publicación:** sin migración ni variables. Primero el backend y después el front.

## Copias de seguridad

El plan gratis de Supabase no hace copias. `.github/workflows/backup.yml` ejecuta cada viernes
`scripts/backup.ts`. La lanza cron-job.org a las 03:00 de Ecuador (`POST /repos/<dueño>/agenda-backend/actions/workflows/backup.yml/dispatches`
con `{"ref":"main"}` y el mismo token que el cron); el horario propio de GitHub (03:17) queda de
respaldo y no repite la copia si ya hay una correcta de las últimas 20 horas. Una copia en cualquier
momento: **Actions → Copia de seguridad → Run workflow**.

1. `pg_dump` del esquema `public` (estructura y datos de todas las tablas) por el pooler de
   Supabase en modo sesión (puerto 5432; pg_dump no funciona en el 6543), comprobando el
   certificado del servidor (`sslmode=verify-full` con la CA de Supabase).
2. **La restaura en un PostgreSQL vacío y desechable** del propio job y compara las filas de cada
   tabla: cualquier error o fila que falte hace fallar el job (la copia se envía igual).
3. La comprime y la **cifra** (AES-256-GCM, clave derivada de `BACKUP_PASSPHRASE` con scrypt):
   sin la clave nadie puede abrirla, tampoco Google.
4. La envía como adjunto a `BACKUP_EMAIL` por Gmail y avisa por ntfy (sin sonido si salió bien,
   urgente si falló). Opcional: `BACKUP_HEALTHCHECK_URL` (healthchecks.io avisa si una semana no llega; periodo 7 días).
5. **La anota en `backup_runs`** (migración 034), buena o fallida, con el tamaño del archivo cifrado o
   el motivo limpio (sin la URL de la base). El inicio del super admin muestra la última. Si no se
   puede anotar, la copia sigue igual. Las anotaciones de más de un año se borran.

No incluye los archivos de la historia clínica (Supabase Storage), sólo la base de datos. Si la
copia cifrada se acerca a 10 MB, el aviso recomienda pasar a otro almacenamiento (Gmail admite
adjuntos de unos 18 MB).

**Recuperar una copia** (este repositorio es público: ni la copia ni el `.sql` deben quedar dentro):

1. Descarga el adjunto `agenda360-AAAA-MM-DD.sql.gz.enc` **fuera** de la carpeta de este proyecto
   (p. ej. en Descargas).
2. Desde esta carpeta, descífrala (usa `BACKUP_PASSPHRASE` de `.env` o te la pide):

   ```bash
   npm run backup:decrypt -- ~/Downloads/agenda360-AAAA-MM-DD.sql.gz.enc
   ```

   El volcado queda en `~/Agenda360-copias/agenda360-AAAA-MM-DD.sql` (carpeta sólo para tu usuario,
   permisos 700; archivo 600). Una salida dentro del repositorio se rechaza salvo con
   `--dentro-del-repo`.
3. Restáurala en una base de datos **vacía** (un proyecto nuevo de Supabase o un PostgreSQL 17
   local):

   ```bash
   psql "<URL de la base nueva>" -f ~/Agenda360-copias/agenda360-AAAA-MM-DD.sql
   ```

   Luego apunta `DATABASE_URL` (Vercel, Lambda, secretos de GitHub y `.env`) a esa base. Nunca la
   restaures encima de la base de producción con datos.
4. Borra el `.sql` descifrado al terminar: tiene datos personales y de salud.

Copia manual a una carpeta fuera del repositorio (necesita pg_dump 17: `brew install postgresql@17`):

```bash
PG_DUMP=/opt/homebrew/opt/postgresql@17/bin/pg_dump npm run backup -- --out ~/Agenda360-copias
```

## Analítica del super admin

Spec 016. /admin → «Analítica» compara los negocios, los sitúa frente a su tipo, dice a quién llamar y a
quién ofrecerle un plan mejor, y qué valor les da Agenda360. Cuatro pestañas (Comparar, Por tipo de
negocio, Salud y ventas, Uso y valor), con los últimos 30 o 90 días frente al periodo anterior de la
misma duración. La ficha de cada negocio suma la tarjeta «Frente a su tipo». Los negocios no ven nada
de esto y la beta no la lleva.

- **La foto diaria** (`src/services/analytics-service.ts`): el cron de GitHub, en su primera pasada
  después de las 06:00 de Ecuador, prepara la foto de 30 y la de 90 días si falta la de hoy, y borra
  las de más de 30 días (migración 043, `analytics_snapshots`: una fila por periodo y día, con todo en
  JSON). Las demás pasadas ven que ya está. La página sólo lee una fila: **no gasta CPU de Vercel**. Si
  falla, el cron sigue con lo demás y lo intenta en la próxima pasada; su línea del registro suma
  «analítica: preparada (N negocios)», «ya estaba la de hoy», «se prepara después de las 06:00» o
  «falló», sólo con cifras.
- **Las cuentas**, en SQL agregado por negocio (cinco consultas para toda la plataforma, ninguna por
  negocio), en la zona de cada negocio y en el periodo `[hoy − N días, hoy)`: citas (sin las
  canceladas) y crecimiento («nuevo» si el negocio es más nuevo que el periodo o antes no tuvo citas);
  % de reservas online, de inasistencias (sobre las cerradas), de cancelaciones y de confirmadas por el
  paciente (sobre las que recibieron el recordatorio o el enlace «Tu cita»); pacientes activos y nuevos
  (como el tope del plan, sin los importados); ingresos estimados (las atendidas), lo cobrado y el
  ticket (sólo las citas con precio); el uso del plan; las agendas, y el último acceso del equipo.
  Con menos de 10 citas, «pocos datos»: las tasas se ven con la marca y no cuentan para su tipo.
- **Por tipo de negocio:** la mediana de cada tasa, del ticket y de las citas por agenda entre los
  negocios activos del tipo con datos suficientes (con menos de 3, «pocos datos»), y los 3 días y las
  3 horas de más demanda. «Muy distinto» de su tipo es el doble o la mitad, con 5 puntos o más.
- **La salud y las ventas:** reglas fijas, en un solo objeto (`HEALTH` y `UPSELL` del servicio), con
  sus motivos en palabras («Nadie del equipo entra hace 12 días»). Se parte de 100: nadie entra hace
  más de 14 días −30 (de 7 a 14, −15); sin citas −30; citas −50 % o peor −25 (de −20 % a −50 %, −15; con
  10 o más antes); más de 10 sin cerrar −10; sin reservas online −5; inasistencias muy por encima de
  su tipo −5. De 70 a 100 sano, de 40 a 69 en riesgo, menos de 40 crítico; un negocio de menos de 14
  días sólo resta por el último acceso. «Listos para subir de plan»: un Free al 80 % de su tope, +30 %
  con 20 citas o más (Free y Pro), un Pro con sus 3 usuarios o con 120 citas cada 30 días en una sola
  agenda, y un Business con todas sus agendas contratadas en uso. «Negocios para vender» del Inicio
  sigue con sus reglas.
- **Uso y valor:** qué funciones usa cada negocio en el periodo (la página de reservas, los
  recordatorios, «Confirmo que voy», las series, la importación, los avisos en el celular, la
  campana, la historia clínica, los pagos y las varias agendas), su adopción, el valor del periodo
  (con las cancelaciones de 24 h o más de antelación según la actividad) y las inasistencias de los
  60 días antes y después de su primer recordatorio o «Confirmo que voy» (con 20 citas cerradas o más
  a cada lado). Los totales de la plataforma salen listos para copiar.
- **Privacidad:** la foto sólo lleva cifras por negocio y por tipo; los únicos datos personales son el
  nombre, el teléfono y el email de cada propietario (para llamarlo). Ninguna consulta lee nombres ni
  contactos de pacientes, y la prueba (`tests/analytics.test.ts`) revisa la foto entera.
- **En local:** `npm run analytics:refresh` prepara la foto de hoy a cualquier hora contra la base del
  entorno (la reemplaza si ya estaba). Con la base de producción desde el equipo no escribe nada: allí
  la prepara el cron (para no esperar a la mañana, GitHub → Actions → «Run workflow»).
- **Publicación:** la migración 043 va antes del backend (`npm run db:migrate`, como paso aparte) y
  el backend antes del front. Sin variables nuevas. Hasta la primera foto, la página dice «Las cifras se
  preparan cada mañana».

## Pruebas

`npm test` crea un PostgreSQL temporal (con `initdb`; en macOS `brew install postgresql@16`) o usa
`TEST_DATABASE_URL`, aplica las migraciones y, para cada suite de `tests/`, carga los datos demo y
arranca una API nueva. Nunca lee `.env`: no toca Supabase. `npm test -- cedula cron` ejecuta sólo
las suites con esos nombres.

## Despliegue en Vercel

La API se despliega como una función de Vercel (Express sin configuración: la entrada es
`src/app.ts`, que exporta `app`). El frontend es otro proyecto de Vercel y reenvía `/api/*` a esta
API con su `middleware.ts`, así el navegador sólo ve el dominio del frontend (cookies propias).

1. **Base de datos.** Aplica las migraciones pendientes desde tu ordenador **antes** de desplegar
   código que las necesite: `npm run db:migrate` (usa el `DATABASE_URL` de `.env`).
2. **Proyecto de la API** (este repositorio): Framework *Express* (lo detecta solo), Node 24.x.
   Variables de entorno:

   | Variable | Valor |
   | --- | --- |
   | `NODE_ENV` | `production` (emails a sus destinatarios reales; la cookie va `Secure` en la nube igualmente) |
   | `DATABASE_URL` | La de `.env`: el **pooler compartido** `aws-0-us-west-2.pooler.supabase.com:6543` con usuario `postgres.<ref>`. La dirección directa `db.<ref>.supabase.co` sólo tiene IPv6 y Vercel no la alcanza |
   | `DATABASE_SSL` | `true` |
   | `DATABASE_POOL_MAX` | `5` |
   | `FRONTEND_URL` | URL pública del frontend (p. ej. `https://agenda-front.vercel.app`) |
   | `TRUST_PROXY` | `1` |
   | `GMAIL_USER`, `GMAIL_FROM_NAME`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` | Los de `.env` |
   | `GMAIL_TRANSPORT` | Opcional: `api` para enviar por la API de Gmail con un token que sólo puede enviar (ver "Emails"); vacía, SMTP |
   | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Almacenamiento: historia clínica, comprobantes de pago, logos y fotos (Supabase → Project Settings → API Keys). Sin ellas no se pueden subir archivos ni imágenes |
   | `PROXY_SECRET` | El de `.env` (mismo valor que en el frontend). **Obligatoria**: sin ella la API no arranca |
   | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | CAPTCHA de la página de reservas y del registro (Cloudflare → Turnstile → Add widget, hostname del frontend, modo *Managed*). **Obligatorias**: sin ellas la API no arranca |
   | `TWO_FACTOR_KEY` | Clave del cifrado del secreto de la verificación en dos pasos, de 32 caracteres o más (`openssl rand -base64 48`). **Obligatoria**; la misma en el `.env` para `npm run dev:prod`. Si se pierde, los super admin entran con sus códigos de recuperación o `npm run db:reset-2fa` |
   | `TURNSTILE_HOSTNAMES` | Opcional: otros dominios del frontend, separados por comas (ya valen los de `FRONTEND_URL` y `APP_URL`) |
   | `EMAIL_DAILY_QUOTA` | Opcional: el cupo de envíos en 24 h de la cuenta de Gmail (por defecto 500; con Google Workspace, unos 2.000). Mismo valor en Lambda y en las variables del repositorio en GitHub (`vars`, las lee el cron, que también envía) |
   | `EMAIL_TEAM_RESERVE`, `EMAIL_PATIENT_RESERVE` | Opcionales: lo que se guarda del cupo para el equipo (20) y para el paciente (100). La del paciente, menor que el cupo; la del equipo, no mayor que la del paciente (si no, la API no arranca). También en Lambda y en las `vars` de GitHub |
   | `PUBLIC_EMAILS_PER_DAY` | Opcional: emails al paciente que provocan las reservas online y los registros en 24 h (por defecto 150) |
   | `NTFY_TOPIC` | Opcional: el del cron, para que la API avise al llegar al cupo de Gmail o a un tope de emails |
   | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Avisos en el celular (`npm run push:keys`, ver "Avisos en el celular"). Sin ellas la API arranca igual, sin avisos (`/api/health` dice `"push": false`). Las mismas en Lambda y en los secretos de GitHub |
   | `VAPID_SUBJECT` | Opcional: el contacto para los servicios de avisos (`mailto:` o `https:`); por defecto `APP_URL` si es https o el email de `GMAIL_USER` |

3. **Proyecto del frontend** (agenda-front): variables `API_URL` (URL de este proyecto, p. ej.
   `https://agenda-backend.vercel.app`) y `PROXY_SECRET`.
4. **GitHub → Settings → Secrets and variables → Actions** de este repositorio (el cron se conecta
   por su cuenta a la base y a Gmail, sin pasar por Vercel):
   - Secrets: `DATABASE_URL` (la misma de Vercel), `GMAIL_USER`, `GMAIL_CLIENT_ID`,
     `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `NTFY_TOPIC` (canal de ntfy al que te suscribes en
     el celular), `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` (las de Vercel: para borrar los
     comprobantes de pago de más de 3 meses; sin ellas se omite), `VAPID_PUBLIC_KEY` y
     `VAPID_PRIVATE_KEY` (las de Vercel: sin ellas el cron no envía los avisos en el celular, que
     caducan en cola) y, opcional, `HEALTHCHECK_URL` (healthchecks.io avisa si el cron deja de
     ejecutarse).
   - Variables: `APP_URL` (la del frontend: enlaces de los emails y del aviso) y, opcionales,
     `GMAIL_FROM_NAME` (por defecto "Agenda360"), `GMAIL_TRANSPORT` (`api`, ver "Emails"),
     `NTFY_SERVER` y `VAPID_SUBJECT`.
   - Copias de seguridad: secretos `BACKUP_PASSPHRASE` (el de `.env`) y `BACKUP_EMAIL` (quién recibe
     las copias; secreto y no variable, porque el registro de Actions es público y mostraría el valor
     de una variable) y, opcional, secreto `BACKUP_HEALTHCHECK_URL`. Pruébalo en
     **Actions → Copia de seguridad → Run workflow**.
   - Pruébalo en **Actions → Recordatorios y correos → Run workflow**.
5. **Comprobación:** `https://<frontend>/api/health` responde `{"ok":true,"database":true}` (y
   `"push":true` con las claves VAPID), el login funciona (la cookie pasa por el proxy) y una reserva
   de prueba envía su email.

El cron corre cada 10 minutos (el repositorio es público: GitHub Actions no tiene límite de
minutos). Sus registros son públicos, por eso sólo muestran cifras. El programador de GitHub puede
retrasar o saltarse ejecuciones: para un horario fiable, un servicio externo (cron-job.org) puede
lanzar el workflow con la API de GitHub (`POST /repos/<dueño>/agenda-backend/actions/workflows/cron.yml/dispatches`
con `{"ref":"main"}` y un token con permiso *Actions: write* sólo para este repositorio). GitHub
pausa los cron de los repositorios públicos tras 60 días sin actividad (avisa por email antes):
basta con un commit o con reactivarlo en Actions.

## Backend en AWS Lambda (us-west-2)

La misma API, sin cambios de código entre una y otra: [Lambda Web Adapter](https://github.com/awslabs/aws-lambda-web-adapter)
arranca `node src/server.ts` (con `run.sh`) y le pasa las peticiones. La API sabe que está alojada
(`AWS_LAMBDA_FUNCTION_NAME`): no arranca tareas de fondo (las hace el cron de GitHub) y, como Lambda
congela la ejecución al responder, envía los emails que la petición puso en cola **antes** de
responder (`flushEmailDelivery`, ~1 s más sólo en las peticiones que envían emails; como mucho un
lote y 8 s para empezar envíos, unos 20 s en el peor caso; lo que no salga lo envía el cron). Oregón, la
misma región de AWS que Supabase: misma latencia que Vercel `pdx1`. Gratis: el nivel siempre
gratuito de Lambda (1 M de peticiones y 400.000 GB-s al mes) queda muy por encima del uso.

Mientras dure la migración, Vercel sigue sirviendo la API: las dos versiones usan la misma base y el
frontend decide a cuál llama con su variable `API_URL`.

1. **Cuenta de AWS** en el plan *Paid* (el *Free* cierra la cuenta a los 6 meses; lo gratuito de
   Lambda sigue siéndolo), con MFA y un presupuesto con alerta de 1 USD (Billing → Budgets).
2. **Función** (región *US West (Oregon)*): Create function → Author from scratch, nombre
   `agenda-backend`, runtime **Node.js 24.x**, arquitectura **arm64**.
   - Código: `npm run lambda:package` y subir `dist/lambda.zip` (Upload from → .zip file).
   - Runtime settings → Handler: `run.sh`.
   - Layers → Add a layer → Specify an ARN: el de *LambdaAdapterLayerArm64* para us-west-2 que
     indica el README de Lambda Web Adapter.
   - Configuration → General: memoria 1024 MB, timeout 30 s.
   - Configuration → Environment variables: `AWS_LAMBDA_EXEC_WRAPPER=/opt/bootstrap`, `PORT=8080`
     y las mismas de la API en Vercel (tabla de arriba) con `DATABASE_POOL_MAX=2` (Lambda atiende
     una petición por instancia) y `APP_URL` con la URL del frontend.
   - Configuration → Function URL → Create, Auth type **NONE**. `<url>/api/health` debe responder
     `{"ok":true,"database":true,"captcha":true}`. Con `PROXY_SECRET` (el mismo del frontend), todo lo
     demás responde 403 si no llega por el proxy del frontend.
3. **Publicación desde GitHub** (`.github/workflows/deploy-lambda.yml`, al hacer push a `main`):
   - IAM → Identity providers → Add provider: OpenID Connect, URL
     `https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`.
   - IAM → Roles → Create role → Web identity: ese proveedor, audience `sts.amazonaws.com`,
     GitHub organization `jhordan-huera`, repository `agenda-backend`, branch `main`. Permiso
     (política en línea): `lambda:UpdateFunctionCode`, `lambda:GetFunction` y
     `lambda:GetFunctionConfiguration` sobre `arn:aws:lambda:us-west-2:<cuenta>:function:agenda-backend`.
   - Variable del repositorio: `AWS_LAMBDA_FUNCTION` (`agenda-backend`); **secretos**
     `AWS_DEPLOY_ROLE_ARN` (ARN del rol: lleva el número de la cuenta de AWS; como variable también
     vale) y `AWS_LAMBDA_URL` (la Function URL): el repositorio es público y los registros de Actions
     muestran las variables. Sólo publica desde `main`, también a mano (spec 009); en la política de
     confianza del rol, limita `token.actions.githubusercontent.com:sub` a
     `repo:<usuario>/agenda-backend:ref:refs/heads/main`. Probar con Actions → *Publicar en AWS
     Lambda* → Run workflow (desde `main`).
   - CloudWatch → Grupos de registros → `/aws/lambda/agenda-backend` → retención de 1 mes (los
     registros no se acumulan).
4. **Cambio:** en el proyecto del frontend en Vercel, `API_URL` = la Function URL (sin `/` final) y
   Redeploy. Probar el login, una reserva (su email), subir un logo y la agenda.
   **Vuelta atrás:** `API_URL` otra vez con la URL de la API en Vercel y Redeploy.
5. Tras unos días estable, borrar el proyecto de la API en Vercel. Los logs quedan en CloudWatch
   (Lambda → Monitor → View CloudWatch logs).

## Pendiente

- `Cache-Control: no-store` también en Vercel: montar `noStore` (`src/http/no-store.ts`) en
  `src/app.ts` con `app.use("/api", noStore)` antes de `app.use("/api", api)`. Hoy lo pone
  `src/server.ts` (local y Lambda), que Vercel no usa.
- Pagos (Stripe): el cambio de plan aún no cobra.
- Spec 015, aplazados por el dueño del producto: la copia de los archivos de la historia clínica en
  un almacenamiento aparte, y los términos del servicio con el contrato de encargo (necesitan la
  revisión de un abogado). Hasta entonces el registro sólo menciona la política de privacidad.
- La política de privacidad no promete lo que falta (spec 015): exportar los datos de un negocio
  (la portabilidad se atiende por soporte) y avisar de los cambios de la política desde la app.
