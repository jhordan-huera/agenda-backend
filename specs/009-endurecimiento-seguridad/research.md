# Decisiones técnicas: Endurecimiento de seguridad

Cada decisión tiene tres partes: qué se eligió, por qué y qué otras opciones se descartaron. Los
números (R1…) se citan en el [plan](./plan.md).

## R1. Topes de intentos exactos: contadores atómicos antes de comprobar

- **Decisión:** antes de comprobar una contraseña o un código, se suma el intento en la tabla
  `rate_limits` con `incrementCounter`, que es una sola sentencia atómica (`insert … on conflict do
  update … returning hits`). Las claves son:
  - `acceso:cuenta-ip:<huella del email>:<IP>`, con tope 10;
  - `acceso:ip:<IP>`, con tope 50;
  - `acceso:cuenta:<huella del email>`, con tope 30, que sólo cuenta si la conexión es nueva para la
    cuenta (`knownIp`, como hoy).

  Las tres usan una ventana de 15 minutos.
  - **Si un contador pasa de su tope:** se responde «Demasiados intentos fallidos…» sin comprobar
    nada.
  - **Si la contraseña es correcta:** se borran los dos contadores de la cuenta, porque hoy cuentan
    los fallos «desde el último inicio correcto», y se resta 1 al de la IP.
  - **Comprobación de hoy:** `isLockedOut`, que lee los fallos de `audit_logs`, se mantiene igual.
    Quedan las dos barreras.
- **Por qué:**
  - el contador se suma antes de llamar a bcrypt, así que 100 intentos simultáneos no pueden pasar
    los 10;
  - no bloquea conexiones de la base mientras se comprueba;
  - `rate_limits` ya existe (migración 029) y ya la usa el límite de peticiones.
- **Huella del email:** sha256 del email en minúsculas, para no guardar emails en las claves.
- **IP:** la misma que el límite de peticiones, con IPv6 agrupada por /64.
- **Paso intermedio de la verificación:** se suma el intento con `update login_challenges set
  attempts = attempts + 1 where id = $1 and attempts < 5 and expires_at > now() returning attempts`
  antes de comprobar el código. Sin fila, el paso ya no sirve.
- **Descartado:**
  - **Bloqueo `pg_advisory_xact_lock` por cuenta durante bcrypt:** en Vercel cada instancia tiene 3
    conexiones. Una ráfaga las dejaría ocupadas esperando el bloqueo y tumbaría el inicio de sesión
    de todos.
  - **Sólo `audit_logs` dentro de una transacción serializable:** reintentos y la misma espera.

## R2. Comprobaciones de contraseña con la sesión abierta

- **Decisión:** las cuatro pasan por la misma reserva de intento de R1, con el email de la cuenta:
  - cambiar el email del perfil (`PUT /users/:id`);
  - cambiar la contraseña;
  - desactivar la verificación;
  - generar códigos de recuperación.

  Si fallan, registran `session.login_failed` con un resumen propio, por ejemplo «Contraseña
  incorrecta al cambiar el email». Así cuentan para el bloqueo, para las alertas de ataques del cron
  y para la salud del sistema.
- **Por qué:** es la misma cuenta, así que el mismo tope. Y bcrypt sólo corre si queda cupo, con lo
  que tampoco se puede gastar la CPU de Vercel.
- **Descartado:** un limitador de peticiones aparte en `PUT /users/:id`. No cuenta por cuenta y
  frenaría también los cambios normales del perfil.

## R3. Avisos de cambios en cuentas de super admin

- **ntfy:** el cron busca en `audit_logs`, en la ventana (desde, hasta] de cada pasada, igual que
  `findStatusChanges`. Busca estas acciones sobre cuentas con `platform_role = 'super_admin'`:
  - `session.two_factor_enabled`;
  - `session.two_factor_disabled`;
  - `session.two_factor_reset` (`npm run db:reset-2fa`);
  - `session.password_changed` (nueva);
  - `platform.user_password_changed` (el principal cambia la de otro).

  El aviso lleva:
  - el título «Agenda360: cambio en una cuenta de super admin»;
  - la cuenta con `maskEmail`, qué cambió, cuándo y quién lo hizo, si fue otro.

  Va con prioridad 4 y como mucho 10 por pasada, más la cifra del resto.
- **Email:** tipo nuevo `account_security_changed` y plantilla `accountSecurityChanged` (qué cambió,
  cuándo en hora de Ecuador, IP y navegador). Se pone en cola en la misma transacción del cambio:
  - a la cuenta afectada;
  - al super admin principal (`platform_owner`), si es otra persona.

  `businessId` va en null y no cuenta como email a terceros.
- **Por qué:** lo que puede esperar lo hace el cron, sin `NTFY_TOPIC` en Vercel (principio VI). El
  email sale al momento, como los de hoy.
- **Descartado:** avisar por ntfy desde la API, porque pondría el tema en Vercel; el dueño ya lo
  descartó el 2026-10-12.

## R4. Reserva «Por verificar»: un paciente aparte que apunta a la ficha

- **Decisión:** si la cédula es de un paciente y ni el email ni el teléfono coinciden, la reserva crea
  un paciente aparte y sigue como si la cédula fuera nueva:
  - la cédula queda vacía (`document_id = ''`);
  - lleva el nombre, el email y el teléfono escritos;
  - lleva `source = 'booking_page'`;
  - la columna nueva `claimed_client_id` apunta a la ficha existente.
  - **Emails:** el principal y cada persona de la sesión reciben los suyos en el correo que
    escribieron. Esto incluye el recordatorio, porque los emails de una cita salen de `clients.email`.
  - **Topes:** el de pacientes nuevos del día y el del plan son los de un paciente nuevo.
  - **Acceso del rol Profesional:** se da sólo a ese paciente aparte. Por el trigger de la 028, un
    paciente creado en la misma transacción no queda pendiente.
  - **Si la misma persona vuelve a reservar con los mismos datos:** se reutiliza ese paciente, buscado
    por `claimed_client_id` y por `sameContact`, como se reutiliza la ficha de una cédula nueva.
  - **Reintento de la misma reserva:** `findRepeatedBooking` también reconoce a ese paciente, así que
    un doble envío responde igual que con una cédula nueva y no da 409.
- **Por qué:**
  - la cédula es única por negocio (índice parcial de la 006), así que el paciente aparte no puede
    llevarla;
  - todos los emails, los recordatorios, el alcance del rol Profesional y la historia clínica cuelgan
    del paciente de la cita. Con un paciente aparte nada llega a la ficha real sin tocar esos sitios;
  - una cédula vacía ya existe en los pacientes antiguos.
- **Descartado:**
  - **Una marca en la cita con el paciente real:** habría que cambiar los emails, los recordatorios,
    el alcance y la historia clínica para que no usaran sus datos. Si quedara un sitio sin tocar, la
    reserva escribiría a la ficha real.
  - **Guardar los datos escritos en la cita:** el mismo problema.

## R5. Unir a la ficha

- **Ruta nueva:** `POST /businesses/:id/clients/:clientId/confirm-claim` con
  `{ updateEmail, updatePhone }`. En una transacción:
  1. comprueba el permiso `clients.manage` y que el rol no sea Profesional;
  2. pasa a la ficha cada cita del paciente aparte, como principal y en `appointment_clients`. Si la
     ficha ya estaba en esa cita, quita la fila sobrante;
  3. si se pidió, actualiza el email y el teléfono de la ficha;
  4. borra el paciente aparte;
  5. registra `client.claim_confirmed` con los cambios.
- **Si el paciente aparte ya tiene historia clínica:** se responde 409 con un mensaje claro. No se
  mueven datos clínicos sin revisión; es un caso raro.
- **El rol Profesional no puede unir.** Al unir, la cita le daría acceso a la ficha real sin que
  Recepción lo confirme. Hoy, en una reserva online de un paciente existente, ese acceso lo libera
  Recepción (`releaseClientAccess`). El profesional ve el aviso y que lo debe revisar Recepción o el
  propietario. En los planes Free y Pro, que son una cuenta individual, el profesional es el
  propietario.
- **Cancelar:** es el cambio de estado de hoy. El paciente aparte queda sin cédula y no cuenta para
  el plan, porque `countClients` ya excluye los de la página sin citas activas.
- **Descartado:** fusionar fichas en general. No se pidió y es mucho más amplio.

## R6. Caducidad máxima de «Recordarme»

- **Decisión:** sin migración, con `sessions.created_at`, `remember` y `users.platform_role`:
  - **Al crear la sesión:** `expires_at` es `now() + 14 días`, o `now() + 7 días` para el super
    admin.
  - **Al renovarla:** `least(created_at + tope, now() + 14 días)`. El tope es de 30 días, o de 7 para
    el super admin.
  - **Al buscarla:** se exige además `not remember or created_at > now() - tope`. Así caducan también
    las sesiones ya abiertas que pasan el tope.
- **Por qué:** se usan las columnas de la 028, sin migración. Sin «Recordarme» no cambia nada.

## R7. Secreto de la verificación cifrado

- **Decisión:**
  - **Formato:** AES-256-GCM con `node:crypto`. Lo guardado es `v1.` + base64url(IV de 12 bytes +
    etiqueta de 16 + datos cifrados).
  - **Clave:** sha256 de `TWO_FACTOR_KEY`, una variable nueva de al menos 32 caracteres.
  - **Los secretos de hoy (base32 en claro):** se leen igual. Se vuelven a guardar cifrados la primera
    vez que la cuenta escribe un código correcto. Con la caducidad de 7 días (R6), todos quedan
    cifrados en una semana como mucho.
  - **Lectura y escritura:** en `two-factor.ts` (setup, enable, verifySecondFactor). Los demás sitios
    sólo miran `is not null`.
- **Sin la variable:**
  - con la base local se usa una clave fija de desarrollo;
  - en la nube la API no arranca (R9);
  - desde el equipo con la base de producción (`dev:prod`), entrar como super admin da un error
    claro: «Falta TWO_FACTOR_KEY…». El cron y las copias de seguridad no la necesitan.
- **Por qué:** sin dependencias nuevas, y nadie tiene que volver a activar la verificación.
- **Descartado:**
  - **Cifrar todo con un script:** el dueño tendría que correrlo contra producción.
  - **Derivar la clave de `PROXY_SECRET`:** une dos secretos que se cambian por motivos distintos.

## R8. Firma de la IP con caducidad, sin depender del orden de publicación

- **Decisión:**
  - **El proxy del front** (`middleware.ts`, en Edge, con Web Crypto) manda:
    - `x-agendo-client-ip`;
    - `x-agendo-client-ts`: la hora en segundos;
    - `x-agendo-client-sig`: HMAC-SHA256 en hex de `<ip>.<ts>` con `PROXY_SECRET`.
  - **La API** acepta la IP si la firma es válida y la hora está a ±120 s. Compara en tiempo
    constante.
  - **La guarda de Lambda** acepta la misma firma.
  - **Fase 1 (esta spec):** el front manda la firma y además el secreto de hoy, y la API acepta los
    dos. Así no importa qué se publica antes.
  - **Fase 2 (después de publicar los dos):** un cambio pequeño, sin spec. Primero el front deja de
    mandar el secreto y se publica. Después la API deja de aceptarlo.
- **Por qué:** quien vea una petición reenviada sólo puede reutilizar su firma 2 minutos. Además,
  ningún orden de publicación corta el servicio.
- **Descartado:** mandar sólo la firma ya en la fase 1. Si el front saliera antes que el backend, se
  perdería la IP real: los límites pasarían a ser globales y, en Lambda, se rechazaría todo.

## R9. La API no arranca desprotegida en la nube

- **Decisión:** en `config.ts`, si `hosted` (Vercel o Lambda), faltar cualquiera de estas cosas
  termina el proceso con la lista de lo que falta, sin valores:
  - las dos claves de Turnstile;
  - `PROXY_SECRET`;
  - `DATABASE_SSL=true`;
  - `DATABASE_URL` sin `sslmode`;
  - `TWO_FACTOR_KEY`.

  Además, la cookie va con `secure` también si `hosted`.
- **Por qué:** en Vercel, que el proceso termine al cargar hace que cada petición falle y que el
  registro diga por qué. Es fallar cerrado.
- **No se exige `NODE_ENV=production`:** se cubre con `secure` en la nube, sin arriesgar una caída
  por una variable que hoy quizá falta.
- **No afecta al equipo del dueño, a las pruebas, al cron ni a las copias:** ninguno es `hosted`.

## R10. Respuestas públicas sin cookie

- **Decisión:**
  - **API:** `/public` se monta antes de `loadSession`, con `req.ctx` vacío. Ninguna ruta pública usa
    la sesión: se comprobó en `platform-routes.ts`, `public-booking-service.ts` y `payment-service.ts`.
  - **Front:** `client.ts` usa `credentials: "omit"` en las rutas `/public/*`, y `early-data.js`
    también.
- **Por qué:** lo que la CDN guarda nunca lleva `Set-Cookie`, sin depender de Vercel ni del hosting
  que venga después.

## R11. Topes de emails: una parte reservada para el negocio

- **Cambio respecto a la spec.** La spec pedía un tope propio «más alto que el de hoy» para los avisos
  del negocio. Gmail permite unos 500 envíos al día con una cuenta normal, y el tope de 400 de hoy
  está pensado para no pasarse.
- **Decisión:**
  - el tope total de 400 (`THIRD_PARTY_EMAILS_PER_DAY`) se queda como está;
  - se añade un tope menor, sólo para lo que provoca el público: `PUBLIC_EMAILS_PER_DAY`, 150 por
    defecto.

  Así, quien llene el tope con reservas falsas gasta como mucho 150, y los recordatorios y avisos del
  negocio tienen siempre al menos 250.
- **Qué cuenta como público, sin columna nueva:**
  - la bienvenida del registro;
  - los emails de una cita reservada en la página y creados en su misma transacción:
    `n.created_at = a.created_at and a.source = 'booking_page'`.
- **Tipos:** `THIRD_PARTY_EMAIL_TYPES` gana los tres de la spec 008 (`appointment_pending`,
  `appointment_completed` y `appointment_no_show`).
- **Descartado:** dos topes que sumen más de 400, porque Gmail podría bloquear todos los envíos un
  día.

## R12. Datos de más

- **Bandeja del negocio:** `notificationService.list` excluye los tipos dirigidos al equipo de la
  plataforma (`plan_change_requested`).
- **Agendas para el rol Profesional:** `professionalService.list` deja en blanco los datos de las
  agendas que no son la suya: `email: ""`, `meetingUrl: ""` y `bankAccounts: []`. El tipo
  `Professional` no cambia y el front ya trata esos valores como «sin datos».
- **`GET /users/:id`:** a un super admin que pide la ficha de otro usuario sin la verificación
  activada se le responde `two_factor_required`, como en el resto del panel. Su propio perfil, sí.

## R13. Nombres que escribe el público

- **Decisión:** campo nuevo `personNameField(label)` en `lib/validations/fields.ts`, compartido. Es
  `requiredText` y además rechaza:
  - saltos de línea;
  - «@»;
  - `://` y `www.`;
  - palabras con forma de dominio («algo.com», «.net», «.ec»…).

  El mensaje es: «Escribe sólo el nombre, sin enlaces ni emails».

  Se usa en la reserva (quien reserva y las otras personas) y en el registro. Los formularios del
  panel no cambian, porque los escribe el equipo del negocio.

## R14. Cliente antiguo sin cédula

- **Decisión:** sólo se le añade la cédula si coinciden el nombre, el email y el teléfono. El teléfono
  se compara con `comparablePhone`, como `sameContact`. Si no, se trata como una cédula nueva.

## R15. Front, beta, GitHub y ntfy

- **Cerrar sesión:**
  - `useSignOut` captura el error y muestra «No se pudo cerrar la sesión. Revisa tu conexión: la
    sesión sigue abierta.», con el botón «Reintentar»;
  - la pantalla de bienvenida (`onboarding-page`) usa el mismo hook.
- **/privacidad:** Nominatim (Fundación OpenStreetMap) en la sección 7, con el texto que se busca y
  la IP. De paso también Vercel Analytics, que hoy tampoco figura. Cambia la fecha de «Última
  actualización».
- **CSP:** `img-src 'self' data: blob: https://owrmbzomwufznfjnyada.supabase.co`.
  - Las imágenes sólo salen del bucket de Supabase y de `data:`, que incluye los logos antiguos y los
    QR.
  - MapLibre carga sus sprites por `connect-src` y `createImageBitmap`.
  - Turnstile va en su iframe.
- **Beta:** sólo la reserva «Por verificar», con su repositorio de prueba: la reserva, la marca en el
  panel y unir o cancelar. No tiene página de privacidad ni CSP, y lo demás es del backend.
- **GitHub:**
  - en `backup.yml`, `BACKUP_EMAIL: ${{ secrets.BACKUP_EMAIL || vars.BACKUP_EMAIL }}`, para que la
    transición sea suave;
  - en `deploy-lambda.yml`, `if: github.ref == 'refs/heads/main' && …`, y el ARN del rol también
    con `secrets.… || vars.…`.
- **ntfy:** `maskPhone` muestra «***» y los últimos 4 dígitos.
