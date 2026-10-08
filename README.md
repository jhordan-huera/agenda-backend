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
     *Session pooler*. No añadas `?sslmode=…`: el cifrado se activa con `DATABASE_SSL=true`.
   - `GMAIL_*`: credenciales OAuth2 de la cuenta que envía los emails.

3. **Crea las tablas**

   ```bash
   npm run db:migrate
   ```

4. **Datos iniciales**, una de las dos opciones:

   ```bash
   npm run db:seed                                  # datos demo (sólo desarrollo)
   npm run db:create-admin -- tu@email.com "Contraseña123" Nombre Apellido   # super admin real
   ```

   Con los datos demo, todas las cuentas usan la contraseña `demo1234`: `jhordan@demo.com` (propietario,
   plan Pro), `andrea@demo.com` (admin), `miguel@demo.com` (recepción), `laura@demo.com` (plan Free),
   `carolina@demo.com` (negocio suspendido), `pedro@demo.com` (sin negocio) y `admin@demo.com` (super admin).
   Varias agendas (plan Business, 3 contratadas): `ricardo@demo.com` (propietario de Clínica Dental
   Sonrisa), `valeria@demo.com` (rol Profesional, sólo su agenda) y `elena@demo.com` (recepción); el
   Dr. Andrés Vega es un profesional sin usuario.

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
| `npm run db:create-admin -- <email> <contraseña> [nombre] [apellido]` | Crea el super admin |
| `npm run db:move-images` | Pasa al bucket `imagenes` los logos y fotos antiguos guardados dentro de la base (data URL); se puede repetir |
| `npm run sync:shared` | Copia de agenda-front el código compartido (ver abajo) |
| `npm run lambda:package` | Prepara `dist/lambda.zip` para AWS Lambda (ver "Backend en AWS Lambda") |

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
.github/workflows/  cron.yml: tareas periódicas cada 10 min en producción
```

### Código compartido con el frontend

`src/shared` es una copia de archivos de `agenda-front/src` (tipos, validaciones, cálculo de
disponibilidad, plantillas de email, planes y permisos), para que frontend y API validen igual.
**Se editan en el frontend** y luego se copian con `npm run sync:shared`.

## API

Todas las rutas cuelgan de `/api`. Respuestas JSON; los errores tienen la forma
`{ "error": { "code": "conflict", "message": "Texto para el usuario" } }` con los códigos
`validation` (400), `unauthorized` (401), `plan_limit` (402), `forbidden` (403), `not_found` (404),
`conflict` (409) y `rate_limited` (429).

| Grupo | Rutas |
| --- | --- |
| Sesión | `GET /auth/session` · `POST /auth/login` · `register` · `logout` · `change-password` (sólo super admin) |
| Perfil | `GET/PUT /users/:userId` |
| Negocio | `POST /businesses` (onboarding) · `GET /businesses/slug-availability` · `GET/PATCH /businesses/:id` · `GET …/professional` |
| Datos del negocio (`/businesses/:id/…`) | `team` (+ `PATCH …/:userId/clinical-access`) · `subscription` · `subscription/usage` · `subscription/request` (GET/POST/DELETE) · `clients` · `services` · `appointments` (`?from&to&clientId`, `PATCH …/:id/status`) · `schedules` · `blocked-times` · `notifications` · `notifications/reminders` · `audit-logs` |
| Historia clínica | `GET/POST /businesses/:id/clinical-templates` (`?all=1`) · `GET/PUT …/clinical-templates/:templateId` · `PATCH …/:templateId/active` · `POST …/clients/:clientId/clinical-record/attachments` · `POST /businesses/:id/clinical-attachments/:attachmentId/complete` · `GET …/:attachmentId/url` · `GET /businesses/:id/clients/:clientId/clinical-record` · `PUT …/clinical-record/profile` · `POST …/clinical-record/notes` · `POST /businesses/:id/clinical-notes/:noteId/addenda` |
| Público (sin sesión) | `GET /public/platform-settings` · `GET /public/categories` · `POST /public/businesses/:slug/clients/lookup` · `GET /public/businesses/:slug` · `POST /public/businesses/:slug/bookings` |
| Super admin | `/admin/stats` · `/admin/businesses` (+ `status`, `plan`, `members`) · `/admin/categories` (CRUD) · `/admin/plan-requests` (+ `approve`, `reject`) · `/admin/users` (+ `active`, `password`) · `/admin/audit-logs?scope=admin\|all` · `/admin/emails` · `/admin/settings` |
| Estado | `GET /health` |

## Contraseñas, modo soporte e historia clínica

- **Las contraseñas las pone el super admin**: al agregar el propietario de un negocio, al agregar un
  miembro a un equipo y al cambiársela a un usuario. Se envían por email. Los usuarios no pueden
  cambiarla ni hay recuperación por enlace ("¿Olvidaste tu contraseña?" indica el email de soporte).
  Sólo el super admin cambia la suya. Quien se registra por `/register` elige la suya; se puede
  cerrar el registro en Configuración de la plataforma.
- **Categorías de negocio en la base de datos** (tabla `business_categories`): el super admin las
  crea, edita, ordena y desactiva en `/admin/categories` (nombre, ícono, si es de salud y servicio
  sugerido). Una categoría en uso no se borra: se desactiva y los negocios que la tienen la conservan.
  La categoría de un negocio sólo la cambia el super admin (`PATCH /businesses/:id` responde 403 si
  un propietario intenta cambiarla).
- **Cambios de plan con aprobación**: el propietario envía una solicitud desde su suscripción; los
  super admins reciben un email y la ven en el resumen del panel `/admin`, donde la aprueban (se
  aplica el plan) o la rechazan con un motivo. El plan sólo cambia desde el panel `/admin` (también
  en modo soporte) y el propietario siempre recibe un email.
- **Cédula de los clientes**: identifica al cliente dentro del negocio (única por negocio, sólo
  números: sin letras ni guiones; en negocios de Ecuador, 10 dígitos con dígito verificador válido). Cédula y email son obligatorios al crear
  un cliente (panel y reservas) y no se pueden quitar; los clientes antiguos sin ellos los completan
  al editar su ficha. En la reserva pública el cliente escribe
  su cédula: si ya es cliente, se reutiliza su ficha sin pedir ni mostrar sus datos (sólo "Hola,
  María L."); si es nuevo, completa nombre, email y teléfono. Un cliente antiguo sin cédula con el
  mismo email recibe la cédula en lugar de duplicarse. El email ya no es único (familias).
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
  Profesional no ve nada (`forbidden`).
- **Planes y precios**: los negocios no los ven (ni la página de inicio): los precios se acuerdan con
  cada negocio y el plan lo cambia el super admin. Los límites siguen aplicándose; al llegar a uno,
  el mensaje invita a escribir a soporte.
- **Modo soporte**: el super admin opera en cualquier negocio (también suspendido) con permisos de
  propietario desde "Gestionar negocio"; lo que crea o cambia queda en la auditoría como
  "Nombre (Super admin)", lo que sólo consulta no.
- **Historia clínica** (datos de salud, para uso del profesional): el propietario, los miembros que
  él autoriza y el super admin en modo soporte. Las evoluciones no se editan ni se borran (se añaden
  aclaraciones), cada consulta de las personas del negocio queda en la auditoría y un paciente con
  historia no se puede eliminar.
- **Formatos propios, por servicio y archivos** (migración 010): en los planes Pro y Business el
  propietario crea y edita sus formatos (`/clinical-templates`, cada cambio es una versión nueva; un
  campo existente no cambia de tipo) o duplica uno de la plataforma. (`services.clinical_template_id` sigue en la API, pero el panel
  ya no lo ofrece: se usa el formato del negocio.) Archivos (JPG, PNG, WebP, HEIC, PDF, 15 MB) con subida directa firmada a Supabase
  Storage (en local, carpeta `storage/historias-clinicas/` y rutas `/api/files`); no se borran.
- **Retención de la auditoría** (migración 026): `purge_audit_logs()` (la llama el cron) borra los
  inicios y cierres de sesión a los 90 días, las acciones del panel a los 5 meses (antes, 1 año) y
  los accesos y cambios en la historia clínica a los 5 años. Las citas, pacientes y pagos no se
  tocan; nadie más puede borrar ni editar la auditoría (triggers).
- **Pago por transferencia** (migración 025): `professionals.bank_account` (jsonb: banco, tipo de
  cuenta `savings`/`checking`, número sólo con dígitos, titular y cédula/RUC opcional) se guarda con
  la ficha del profesional. Cada cita tiene `payment_token` (enlace privado `/pago/:token` del
  frontend), `receipt_at` (último comprobante) y `paid_at`. Con datos bancarios y precio mayor que 0,
  la confirmación de la reserva (`payment`) y los emails de reserva y confirmación (mientras no esté
  pagada) llevan los datos y el enlace. Sin sesión: `GET /public/payments/:token`, `POST
  /public/payments/:token/receipts` (JPG, PNG, WebP, HEIC o PDF, 10 MB; **uno por cita**: enviado,
  se rechaza otro, también si dos pestañas suben a la vez; no en citas canceladas o "No asistió") y `POST …/receipts/:id/complete` (avisa por email al negocio). En el
  panel: `GET /businesses/:id/appointments/:id/receipts`, `GET /businesses/:id/payment-receipts/:id/url`
  (URL firmada de 5 min) y `PATCH /businesses/:id/appointments/:id/payment` (`{ paid }`). Los
  comprobantes se borran con la cita (al eliminar el paciente o el negocio, también sus archivos) y,
  para que el almacenamiento no se llene, el cron borra los de citas de hace más de 3 meses
  (`RECEIPT_RETENTION_MONTHS`; la cita conserva `paid_at` y `receipt_at`). El navegador reduce las
  fotos antes de subirlas (WebP, 2000 px: unos 200–450 KB); los PDF van tal cual.
- **Almacenamiento** (`src/services/file-storage.ts`): tres buckets de Supabase Storage que se crean
  solos con su tamaño máximo y sus tipos de archivo: `historias-clinicas` (privado, o el de
  `STORAGE_BUCKET`), `comprobantes` (privado) e `imagenes` (público: logos y fotos). Las imágenes se
  suben con `POST /images` (`target`: avatar, logo o professional; 2 MB) y se guarda su dirección
  pública; la API no acepta imágenes nuevas que no estén en el bucket (las antiguas en data URL valen
  mientras no se cambien; `npm run db:move-images` las pasa). Al cambiar o quitar una imagen se
  borra la que ya nadie usa. En local, carpeta `storage/<bucket>/` (las imágenes en
  `/api/files/public/imagenes/…`); con la base de producción y sin Supabase en `.env`, no hay subidas.
- **Equipo de la plataforma** (migración 020): `users.platform_owner` marca al super admin principal
  (la migración lo pone en el que ya existía; `db:create-admin` lo pone si aún no hay ninguno).
  `GET/POST /admin/platform-admins` lista y agrega super admins (agregar, sólo el principal). Las
  rutas de usuarios (`/admin/users/:id/active` y `/password`) sólo dejan tocar a otro super admin al
  principal, y nunca al principal ni a uno mismo.
- **Avisos por WhatsApp** (migración 019): `notification_settings` lleva `whatsappOnStatusChange` y
  `whatsappFollowUps` (la migración los activa en los negocios que ya existían). El aviso lo abre el
  front con un enlace `wa.me`; `POST /businesses/:id/appointments/:id/whatsapp-notice` (`kind`:
  confirmed, cancelled, rescheduled, completed, no_show) sólo lo registra en la actividad.
- **Colores de marca** (migración 018): `businesses.brand_colors` (jsonb, `{ primary, highlight }` en
  `#rrggbb`, con un check en la base; null = los de Agenda360). Se cambian con `PATCH
  /businesses/:id` (`brandColors`, permiso `business.manage`), quedan en la actividad y llegan al
  perfil público para que la página de reservas use los colores del negocio.
- **Formato de tu negocio** (migración 017): `businesses.clinical_default_template_id` guarda el
  formato que se propone en cada evolución nueva (salvo en las citas de un servicio con formato
  propio). Lo elige el propietario con `PUT /businesses/:id/clinical-default-template` (cualquier
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
- Pruebas: `tests/concurrency.test.ts` y `tests/booking-limits.test.ts` (reservas simultáneas de la
  misma persona y de personas distintas).

## Rendimiento y crecimiento

- **El panel no descarga el historial**: cada pantalla pide sólo su rango de citas (`from`/`to`);
  `GET /businesses/:id/appointments/:id` trae una cita suelta y `GET /businesses/:id/clients/activity`
  calcula en la base el resumen de cada cliente (totales, primera visita, última y próxima cita).
- **Página de reservas en la CDN**: `GET /public/businesses/:slug` responde con
  `Cache-Control: public, s-maxage=30, stale-while-revalidate=60`; Vercel la sirve sin llegar a la
  API en los picos de visitas. La reserva vuelve a comprobar la hora al confirmarla.
- **Contenido de los emails**: el cron borra el texto y el HTML de los emails con más de 90 días
  (`EMAIL_CONTENT_DAYS`) y deja el registro (a quién, tipo, asunto, fecha y estado).
- **Conexiones**: en Vercel, 3 por instancia por defecto (`DATABASE_POOL_MAX`); en local, 10.
- **Aviso de espacio**: la copia de seguridad semanal informa el tamaño de la base y avisa por ntfy
  (prioridad alta) si pasa de 350 MB (`DATABASE_WARN_MB`) de los 500 MB del plan gratis de Supabase.
- El hash de referencia del login es fijo: no se calcula bcrypt en cada arranque del servidor.

## Seguridad

- **Sesión:** cookie `httpOnly` con un token aleatorio; en la base sólo se guarda su hash (tabla
  `sessions`). "Recordarme" = 30 días; si no, 24 h y la cookie se borra al cerrar el navegador.
  Cuando el super admin cambia una contraseña o desactiva una cuenta, se cierran sus sesiones.
- **Contraseñas** con bcrypt. El login tarda lo mismo exista o no el email.
- **Bloqueo por intentos fallidos:** 10 fallos con una cuenta (desde su último inicio de sesión
  correcto) o 50 desde una conexión, en 15 minutos, bloquean el inicio de sesión hasta que pasen
  (aunque la contraseña sea la correcta). Se cuentan en la auditoría, así que valen para todas
  las instancias de Vercel. Un email no registrado se bloquea igual: no revela qué cuentas existen.
- **Verificación en dos pasos** (TOTP: Google Authenticator, Microsoft Authenticator…) para la
  cuenta de super admin, desde Configuración. Tras la contraseña, el login devuelve
  `{ twoFactorRequired, challenge }` y la sesión se abre en `POST /api/auth/login/two-factor` con
  el código de 6 dígitos (cada uno sirve una vez) o un código de recuperación (10, guardados como
  hash). 5 códigos incorrectos anulan el paso; cuentan para el bloqueo de la cuenta. Desactivarla
  pide la contraseña y un código (`src/services/two-factor.ts`, `src/services/totp.ts`).
  **Emergencia** (celular y códigos perdidos): `npm run db:reset-2fa -- <email>` desde tu ordenador.
- **Contraseñas fuera del registro de emails:** los emails con datos de acceso se guardan con la
  contraseña oculta (`••••••••`); ésta va aparte (`notifications.secret`) sólo hasta que el email
  se envía o se descarta.
- **CAPTCHA** (Cloudflare Turnstile) en la búsqueda por cédula y en las reservas de la página
  pública, con `TURNSTILE_SITE_KEY` y `TURNSTILE_SECRET_KEY` (`src/http/captcha.ts`). Sin ellas no
  se pide. Si Cloudflare no responde, la reserva no se bloquea.
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
- **Límite de intentos** por IP en login, registro y reservas públicas. En Vercel la IP del
  visitante llega desde el proxy del frontend en `x-agendo-client-ip`, que sólo se acepta junto con
  `PROXY_SECRET` (`src/http/client-ip.ts`): nadie puede falsear su IP.
- **RLS activado** en todas las tablas: con Supabase, la API REST automática (clave anónima) no
  puede leer nada; sólo esta API (dueña de las tablas) accede a los datos.
- `helmet` para las cabeceras HTTP.

## Emails

Los servicios guardan cada email "en cola" (tabla `notifications`) dentro de la misma transacción
que el cambio que lo provoca; `src/services/mailer.ts` los envía por Gmail en segundo plano y los
marca como enviados o, tras 5 intentos, fallidos (con el motivo en `last_error`).

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
- Gmail gratuito permite unos 500 emails al día; para más volumen conviene un proveedor
  transaccional (Resend, SES…): sólo cambia `mailer.ts`.

## Copias de seguridad

El plan gratis de Supabase no hace copias. `.github/workflows/backup.yml` ejecuta cada viernes
`scripts/backup.ts`. La lanza cron-job.org a las 03:00 de Ecuador (`POST /repos/<dueño>/agenda-backend/actions/workflows/backup.yml/dispatches`
con `{"ref":"main"}` y el mismo token que el cron); el horario propio de GitHub (03:17) queda de
respaldo y no repite la copia si ya hay una correcta de las últimas 20 horas. Una copia en cualquier
momento: **Actions → Copia de seguridad → Run workflow**.

1. `pg_dump` del esquema `public` (estructura y datos de todas las tablas) por el pooler de
   Supabase en modo sesión (puerto 5432; pg_dump no funciona en el 6543).
2. **La restaura en un PostgreSQL vacío y desechable** del propio job y compara las filas de cada
   tabla: cualquier error o fila que falte hace fallar el job (la copia se envía igual).
3. La comprime y la **cifra** (AES-256-GCM, clave derivada de `BACKUP_PASSPHRASE` con scrypt):
   sin la clave nadie puede abrirla, tampoco Google.
4. La envía como adjunto a `BACKUP_EMAIL` por Gmail y avisa por ntfy (sin sonido si salió bien,
   urgente si falló). Opcional: `BACKUP_HEALTHCHECK_URL` (healthchecks.io avisa si una semana no llega; periodo 7 días).

No incluye los archivos de la historia clínica (Supabase Storage), sólo la base de datos. Si la
copia cifrada se acerca a 10 MB, el aviso recomienda pasar a otro almacenamiento (Gmail admite
adjuntos de unos 18 MB).

**Recuperar una copia:**

1. Descarga el adjunto `agenda360-AAAA-MM-DD.sql.gz.enc` en la carpeta de este proyecto.
2. `npm run backup:decrypt -- agenda360-AAAA-MM-DD.sql.gz.enc` (usa `BACKUP_PASSPHRASE` de `.env` o
   te la pide) → `agenda360-AAAA-MM-DD.sql`.
3. Restáurala en una base de datos **vacía** (un proyecto nuevo de Supabase o un PostgreSQL 17
   local): `psql "<URL de la base nueva>" -f agenda360-AAAA-MM-DD.sql`. Luego apunta
   `DATABASE_URL` (Vercel, secretos de GitHub y `.env`) a esa base. Nunca la restaures encima de
   la base de producción con datos.
4. Borra el `.sql` descifrado al terminar: tiene datos personales y de salud.

Copia manual a una carpeta (necesita pg_dump 17: `brew install postgresql@17`):
`PG_DUMP=/opt/homebrew/opt/postgresql@17/bin/pg_dump npm run backup -- --out ~/Copias`.

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
   | `NODE_ENV` | `production` (cookie `Secure` y emails a sus destinatarios reales) |
   | `DATABASE_URL` | La de `.env`: el **pooler compartido** `aws-0-us-west-2.pooler.supabase.com:6543` con usuario `postgres.<ref>`. La dirección directa `db.<ref>.supabase.co` sólo tiene IPv6 y Vercel no la alcanza |
   | `DATABASE_SSL` | `true` |
   | `DATABASE_POOL_MAX` | `5` |
   | `FRONTEND_URL` | URL pública del frontend (p. ej. `https://agenda-front.vercel.app`) |
   | `TRUST_PROXY` | `1` |
   | `GMAIL_USER`, `GMAIL_FROM_NAME`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` | Los de `.env` |
   | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Almacenamiento: historia clínica, comprobantes de pago, logos y fotos (Supabase → Project Settings → API Keys). Sin ellas no se pueden subir archivos ni imágenes |
   | `PROXY_SECRET` | El de `.env` (mismo valor que en el frontend) |
   | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | CAPTCHA de la página de reservas (Cloudflare → Turnstile → Add widget, hostname del frontend, modo *Managed*) |

3. **Proyecto del frontend** (agenda-front): variables `API_URL` (URL de este proyecto, p. ej.
   `https://agenda-backend.vercel.app`) y `PROXY_SECRET`.
4. **GitHub → Settings → Secrets and variables → Actions** de este repositorio (el cron se conecta
   por su cuenta a la base y a Gmail, sin pasar por Vercel):
   - Secrets: `DATABASE_URL` (la misma de Vercel), `GMAIL_USER`, `GMAIL_CLIENT_ID`,
     `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `NTFY_TOPIC` (canal de ntfy al que te suscribes en
     el celular), `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` (las de Vercel: para borrar los
     comprobantes de pago de más de 3 meses; sin ellas se omite) y, opcional, `HEALTHCHECK_URL`
     (healthchecks.io avisa si el cron deja de ejecutarse).
   - Variables: `APP_URL` (la del frontend: enlaces de los emails y del aviso) y, opcionales,
     `GMAIL_FROM_NAME` (por defecto "Agenda360") y `NTFY_SERVER`.
   - Copias de seguridad: secreto `BACKUP_PASSPHRASE` (el de `.env`), variable `BACKUP_EMAIL`
     (quién recibe las copias) y, opcional, secreto `BACKUP_HEALTHCHECK_URL`. Pruébalo en
     **Actions → Copia de seguridad → Run workflow**.
   - Pruébalo en **Actions → Recordatorios y correos → Run workflow**.
5. **Comprobación:** `https://<frontend>/api/health` responde `{"ok":true,"database":true}`, el
   login funciona (la cookie pasa por el proxy) y una reserva de prueba envía su email.

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
responder (`flushEmailDelivery`, ~1 s más sólo en las peticiones que envían emails). Oregón, la
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
     `{"ok":true,"database":true}`.
3. **Publicación desde GitHub** (`.github/workflows/deploy-lambda.yml`, al hacer push a `main`):
   - IAM → Identity providers → Add provider: OpenID Connect, URL
     `https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`.
   - IAM → Roles → Create role → Web identity: ese proveedor, audience `sts.amazonaws.com`,
     GitHub organization `jhordan-huera`, repository `agenda-backend`, branch `main`. Permiso
     (política en línea): `lambda:UpdateFunctionCode`, `lambda:GetFunction` y
     `lambda:GetFunctionConfiguration` sobre `arn:aws:lambda:us-west-2:<cuenta>:function:agenda-backend`.
   - Variables del repositorio: `AWS_LAMBDA_FUNCTION` (`agenda-backend`) y `AWS_DEPLOY_ROLE_ARN`
     (ARN del rol); **secreto** `AWS_LAMBDA_URL` (la Function URL: el repositorio es público y los
     registros de Actions muestran las variables). Probar con Actions → *Publicar en AWS Lambda* →
     Run workflow.
   - CloudWatch → Grupos de registros → `/aws/lambda/agenda-backend` → retención de 1 mes (los
     registros no se acumulan).
4. **Cambio:** en el proyecto del frontend en Vercel, `API_URL` = la Function URL (sin `/` final) y
   Redeploy. Probar el login, una reserva (su email), subir un logo y la agenda.
   **Vuelta atrás:** `API_URL` otra vez con la URL de la API en Vercel y Redeploy.
5. Tras unos días estable, borrar el proyecto de la API en Vercel. Los logs quedan en CloudWatch
   (Lambda → Monitor → View CloudWatch logs).

## Pendiente

- Pagos (Stripe): el cambio de plan aún no cobra.
- Imágenes (foto y logo) en un almacenamiento de archivos; hoy se guardan como data URL en la base
  (máx. 500 KB).
