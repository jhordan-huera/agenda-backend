# Plan de implementación: Endurecimiento de seguridad

**Rama**: `dev` · **Fecha**: 2026-10-14 · **Spec**: [spec.md](./spec.md)

**Documentos**: [research.md](./research.md) (decisiones R1–R15) · [data-model.md](./data-model.md) ·
[contracts/api.md](./contracts/api.md) · [quickstart.md](./quickstart.md)

## Resumen

**Backend** (lo principal):
- **Topes de intentos exactos:**
  - contadores atómicos antes de comprobar la contraseña o el código (R1);
  - lo mismo en las cuatro comprobaciones con la sesión abierta (R2).
- **Cambios en cuentas de super admin:** aviso por email al momento y por ntfy desde el cron (R3).
- **Reserva «Por verificar»:** un paciente aparte que apunta a la ficha, más la ruta para unirlo (R4,
  R5).
- **Sesiones:** «Recordarme» con tope de 30 días, 7 para el super admin (R6).
- **Secreto de la verificación:** cifrado (R7).
- **Firma de la IP con caducidad (R8):** sin depender del orden de publicación.
- **La API no arranca desprotegida en la nube (R9).**
- **Respuestas públicas sin cookie (R10).**
- **Topes de emails:** 150 para lo que provoca el público, dentro de los 400 de hoy (R11).
- **Datos de más (R12), nombres sin enlaces (R13) y cédula de pacientes antiguos (R14).**

**Front:**
- la marca y la revisión de las citas «Por verificar»;
- cerrar sesión que avisa si falla;
- /privacidad;
- CSP más estricta;
- la firma en `middleware.ts`;
- peticiones públicas sin cookie;
- plantillas, tipos y validaciones compartidas.

**Beta:** sólo la reserva «Por verificar» con su repositorio de prueba.

**Migración 036:**
- protección de filas en `schema_migrations`;
- `clients.claimed_client_id`.

**Constitución 1.6.0** en los dos repos.

## Contexto técnico

**Lenguaje/versión**: TypeScript. Node ejecuta `.ts` en el backend; el front usa React 19, y
`middleware.ts` corre en Edge.

**Dependencias**: ninguna nueva. Se usan `node:crypto` (AES-256-GCM y HMAC) en el backend y Web
Crypto en `middleware.ts`.

**Almacenamiento**: la migración 036 (ver [data-model.md](./data-model.md)). Los contadores usan
`rate_limits` (029), las sesiones usan las columnas de la 028 y la cola de emails no cambia.

**Variables nuevas:**
- `TWO_FACTOR_KEY`: obligatoria en la nube;
- `PUBLIC_EMAILS_PER_DAY`: opcional, 150 por defecto.

**Pruebas**: las suites nuevas y las que se actualizan de [quickstart.md](./quickstart.md), con
`npm test` y `npm run typecheck`. En el front y la beta, `npm run build` y `npm run lint`, más el
recorrido con Playwright, la CSP con un servidor estático local y la prueba del proxy.

**Restricciones**:
- **CPU de Vercel:** bcrypt sólo corre si queda cupo de intentos, y los avisos por ntfy los manda el
  cron.
- **Gmail:** el total diario de emails a terceros no sube de 400.

## Comprobación contra la constitución (1.5.0 → 1.6.0)

| Principio | Cumple | Cómo |
|---|---|---|
| I. Español | Sí | Mensajes, emails, avisos y documentación en español. |
| II. Privacidad | Sí | La reserva ya no revela si alguien es paciente. ntfy enseña menos (teléfono «***5555», cuentas a medias, títulos sin nombres). El email de las copias deja de verse en los registros públicos. |
| III. Decisiones | Sí | Sólo cambia lo que aprobó el dueño el 2026-10-14: la reserva con la cédula de un paciente y otros datos queda por verificar, y las sesiones tienen tope. Se anota en la 1.6.0. Las contraseñas siguen yendo por email y el modo soporte no cambia. |
| IV. Local | Sí | Todo se comprueba en local. Lo que se exige en la nube no afecta al equipo del dueño, a las pruebas ni al cron. |
| V. Compartido | Sí | Tipos (`Client.claimedClientId`, `EmailType`), validaciones (`personNameField`) y plantillas (`accountSecurityChanged`, `bookingReceived`) se editan en el front y se copian con `sync:shared`. |
| VI. Barato | Sí | Sin servicios ni dependencias nuevas. ntfy, por el cron. La CSP se estrecha; no se añade nada. |
| VII. Diseño | Sí | «Por verificar» usa los tokens del tema y el estilo de las marcas de hoy, con texto (no sólo color), y se revisa a 390 px. |
| Restricciones | Sí | La migración 036 la aplica el dueño antes del backend, y el plan lo dice como paso aparte. |

**Sin excepciones.** Hay un riesgo de publicación: si falta una variable en Vercel, la API dejará de
atender (R9). Por eso los pasos de publicar empiezan comprobándolas.

**Constitución 1.6.0 (MENOR)**, en los dos repos:
- **Principio II:** el teléfono a medias en ntfy es «***5555».
- **Principio III:**
  - una reserva con la cédula de un paciente y un email y un teléfono que no coinciden queda «Por
    verificar», aparte de la ficha, hasta que el negocio la une o la cancela. Vale para cada persona
    de la sesión, y unir no lo puede hacer el rol Profesional;
  - «Recordarme» dura como mucho 30 días, y 7 para el super admin.

  Las dos son decisiones del 2026-10-14.
- **Restricciones de seguridad:** añadir los topes de intentos exactos, la firma de la IP y el
  arranque seguro en la nube.

## Cambios respecto a la spec

Hay que aprobarlos con el plan:

1. **Topes de emails (R11).** La spec pedía un tope propio «más alto que el de hoy» para los avisos
   del negocio. No se puede: Gmail permite unos 500 envíos al día, y el tope de 400 de hoy está para
   no pasarse.
   - **En su lugar:** lo que provoca el público tiene un tope de 150 dentro de esos 400. Así los
     recordatorios y avisos del negocio tienen siempre 250 reservados.
2. **Unir a la ficha no lo puede hacer el rol Profesional (R5).** Si lo hiciera, se daría acceso a la
   ficha real sin que Recepción lo confirme, como pasa hoy con las reservas online.
3. **Unir no mueve historia clínica (R5).** Si el paciente aparte ya la tiene, se avisa y no se une.
4. **Firma de la IP (R8).** En la fase 1 el front manda la firma y el secreto de hoy. Así no importa
   qué repo sale antes. La fase 2 quita el secreto y es un cambio pequeño, después de publicar.
5. **Secreto de la verificación (R7).** Los secretos de hoy se cifran con el siguiente código
   correcto de cada super admin: como mucho una semana, por la caducidad de 7 días.
6. **Beta:** no tiene página de privacidad, así que sólo recibe «Por verificar».
7. **/privacidad:** además de Nominatim, se añade Vercel Analytics, que hoy tampoco figura.
8. **Email al negocio de la reserva (`booking_received`):** dice que está por verificar, para que el
   negocio la revise.

## Estructura

```text
specs/009-endurecimiento-seguridad/   spec, plan, research, data-model, contracts/api.md, quickstart, tasks, reporte

agenda-backend
  .specify/memory/constitution.md               1.6.0
  db/migrations/036_security_hardening.sql      NUEVO (data-model)
  src/config.ts                                 TWO_FACTOR_KEY, PUBLIC_EMAILS_PER_DAY, arranque seguro en la nube (R9)
  src/app.ts                                    /public antes de loadSession (R10); la guarda de Lambda acepta la firma (R8)
  src/http/session.ts                           cookie Secure en la nube
  src/http/client-ip.ts, src/http/secrets.ts    firma con caducidad (R8)
  src/services/session-security.ts              reserva atómica de intentos (R1, R2)
  src/services/secret-box.ts                    NUEVO: cifrar y descifrar el secreto (R7)
  src/services/auth-service.ts                  signIn, verifyTwoFactor, changePassword, topes de sesión (R1, R3, R6)
  src/services/two-factor.ts                    cifrado, intentos y emails (R1, R2, R3, R7)
  src/services/account-alerts.ts                NUEVO: email de cambio de cuenta y aviso de ntfy (R3)
  src/services/account-service.ts               cambio de email con intentos (R2); GET /users con 2FA (R12)
  src/services/public-booking-service.ts        por verificar (R4); cliente antiguo (R14)
  src/services/business-data-service.ts         confirmClaim (R5)
  src/routes/business-routes.ts                 POST …/clients/:id/confirm-claim
  src/db/columns.ts                             claimedClientId
  src/services/notifications.ts                 booking_received con «por verificar»
  src/services/booking-alerts.ts                «Por verificar» en el aviso de la reserva
  src/services/email-limits.ts                  tope del público y tipos de la 008 (R11)
  src/services/activity-service.ts              bandeja sin emails a la plataforma (R12)
  src/services/professional-service.ts          agendas en blanco para el rol Profesional (R12)
  src/services/masking.ts                       «***5555»
  src/jobs/scheduled-tasks.ts, scripts/cron.ts  avisos de cambios de cuenta; EMAIL_GROUPS
  .github/workflows/backup.yml, deploy-lambda.yml
  README.md
  src/shared/**                                 sólo con npm run sync:shared
  tests/attempt-limits.test.ts, account-alerts.test.ts, booking-verify.test.ts, hardening.test.ts   NUEVOS
  tests/cedula.test.mjs, couple-booking.test.ts, booking-alert.test.ts, two-factor.test.ts,
  tests/security-sessions.test.ts, public-abuse.test.ts, cron.test.mjs                               actualizados

agenda-front
  .specify/memory/constitution.md               1.6.0
  src/types/index.ts                            Client.claimedClientId, EmailType account_security_changed
  src/lib/validations/fields.ts, booking.ts, auth.ts   personNameField (R13)
  src/lib/email/templates.ts                    accountSecurityChanged; bookingReceived con por verificar
  middleware.ts                                 firma con caducidad (R8)
  vercel.json                                   img-src
  public/early-data.js, src/lib/api/client.ts   /public sin cookie (R10)
  src/components/layout/use-sign-out.ts, src/pages/onboarding-page.tsx   aviso si falla
  src/pages/privacy-page.tsx                    Nominatim y Vercel Analytics
  src/components/shared/verify-badge.tsx        NUEVO: marca «Por verificar»
  src/features/appointments/claim-review.tsx    NUEVO: aviso y diálogo «unir a su ficha»
  src/features/appointments/appointment-details-sheet.tsx, appointment-list-item.tsx
  src/features/calendar/time-grid-view.tsx, agenda-list-view.tsx
  src/pages/dashboard/client-detail-page.tsx    marca y unir desde la ficha del paciente
  src/lib/data/repository.ts, api-repository.ts, src/hooks/queries/use-clients.ts   confirmClaim
  src/features/settings/email-outbox.tsx        nombre del tipo nuevo

agenda-beta: tipos, marca, revisión, el repositorio de prueba de la reserva (por verificar en vez de error) y confirmClaim en el de pacientes
```

## Publicación

**El orden importa:** una variable que falte deja la API sin atender (R9), y la migración va antes
del código que la usa.

1. **Comprobar el CAPTCHA del backend publicado.** Abrir esta dirección y ver `"captcha":true`:

   ```
   https://agenda-backend-lemon.vercel.app/api/health
   ```

   Si dice `false`, poner primero `TURNSTILE_SITE_KEY` y `TURNSTILE_SECRET_KEY` en el proyecto del
   backend en Vercel.
2. **Comprobar las demás variables del backend en Vercel:**
   - existe `PROXY_SECRET`;
   - `DATABASE_SSL` vale `true`;
   - `DATABASE_URL` no lleva `sslmode`.

   Lo mismo en Lambda, si se usa.
3. **Crear la clave del cifrado** con este comando:

   ```
   openssl rand -base64 48
   ```

   Ponerla como `TWO_FACTOR_KEY` en tres sitios:
   - el backend en Vercel (Production);
   - Lambda, si se usa;
   - el `.env` local, para `dev:prod`, pero sólo después de publicar el backend. Antes, `dev:prod`
     cifraría el secreto al entrar como super admin y la versión publicada no podría leerlo.

   Guardarla también en un lugar seguro: si se pierde, los super admin tendrán que entrar con sus
   códigos de recuperación.
4. **Pasar `BACKUP_EMAIL` a secreto en GitHub.** El primer comando pide el valor:

   ```
   gh secret set BACKUP_EMAIL --repo jhordan-huera/agenda-backend
   ```

   ```
   gh variable delete BACKUP_EMAIL --repo jhordan-huera/agenda-backend
   ```

5. **Migración 036,** como paso aparte, antes del PR del backend:

   ```
   cd ~/Documentos/Proyectos/Backend/agenda-backend
   npm run db:migrate
   ```

6. **PR `dev` → `main` del backend.** Al publicarse:
   - abrir `/api/health`;
   - entrar como super admin con el código.
7. **PR `dev` → `main` del front.**
8. **Fase 2,** después de que los dos estén publicados y funcionando. Es un cambio pequeño sin spec:
   1. el front deja de mandar el secreto de hoy, y se publica;
   2. el backend deja de aceptarlo, y se publica.
9. **Pasos opcionales, cuando quieras:**
   - `GMAIL_TRANSPORT=api` con un token que sólo sirva para enviar;
   - comprobar que `NTFY_TOPIC` sea largo y aleatorio;
   - en AWS, que el rol de publicación de Lambda sólo lo use `main`;
   - la consulta de sólo lectura en Supabase de la revisión.

## Riesgos

- **La API puede dejar de atender** si al publicar falta una variable en Vercel. Los pasos 1 a 3 lo
  evitan, y el registro de Vercel dice qué falta.
- **Pacientes aparte:** la reserva «Por verificar» crea pacientes que el negocio debe revisar. Se
  esperan pocos: quien cambió de datos o se equivocó de cédula. El email al negocio y la marca en la
  agenda los hacen visibles.
- **Una red compartida (por ejemplo, la wifi de una clínica)** comparte el tope de 50 fallos por IP,
  como hoy.
- **Perder `TWO_FACTOR_KEY`:** los super admin entran con sus códigos de recuperación, o con
  `npm run db:reset-2fa`.
- **El super admin escribe la contraseña y el código una vez por semana.** Lo eligió el dueño.
- **CSP más estricta:** una imagen que no venga de Supabase ni sea `data:` dejaría de verse. Se
  revisa todo el producto en local antes de publicar.
