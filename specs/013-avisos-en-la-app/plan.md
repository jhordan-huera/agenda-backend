# Plan de implementación: Avisos en el celular desde la app instalada

**Rama**: `dev` · **Fecha**: 2026-10-14 · **Spec**: [spec.md](./spec.md)

**Documentos**: [research.md](./research.md) (decisiones R1–R20) · [data-model.md](./data-model.md) ·
[contracts/api.md](./contracts/api.md) · [quickstart.md](./quickstart.md)

## Resumen

**Cómo funciona para el propietario:**
- **Activar:** al entrar al panel ve una vez «Activa los avisos en este celular», con «Activar» y
  «Ahora no». Con un toque, más el permiso del navegador, quedan activados con todos los tipos
  encendidos, y llega «Listo: aquí te avisaremos de las reservas». «Ahora no» lo deja tranquilo 7
  días en ese aparato.
- **Configuración → Notificaciones** tiene la tarjeta «Avisos en este celular»:
  - activar o desactivar en ese aparato y mandar un aviso de prueba;
  - apagar cada tipo;
  - en el iPhone sin instalar, cómo instalarla;
  - con el permiso bloqueado, cómo volver a permitirlo.
- **Al momento le llegan:**
  - las reservas online, también las «Por verificar»;
  - los comprobantes de pago;
  - las cancelaciones del paciente desde su email (spec 010);
  - las citas nuevas en su agenda que agendó otra persona.
- **Desde el cron, con hasta 10 minutos de retraso:**
  - cada cita que terminó hace 30 minutos y sigue Pendiente o Confirmada;
  - a las 8 de la noche, en la hora del negocio, «Tienes 3 citas de hoy sin cerrar».
- **Al tocar un aviso** se abre la cita (o la agenda del día), y si la sesión caducó, primero el
  inicio de sesión.
- **El paciente siempre va a medias** («Juan P.»): nunca su cédula, email, teléfono ni nada de la
  historia clínica.

**El super admin** los activa en Configuración de /admin y recibe, además de ntfy:
- al momento, los negocios nuevos y las solicitudes de plan;
- desde el cron, los cambios de seguridad en cuentas de super admin y los intentos fallidos.

**Backend** (lo principal):
- **El envío (R1):** los avisos estándar de los navegadores (Web Push), firmados con un par de claves
  propio y cifrados para cada aparato. Se escribe con lo que ya trae Node (`node:crypto`), **sin
  librería nueva**, y se comprueba con el ejemplo oficial de la norma.
- **Las claves (R2):** se crean con `npm run push:keys`. Si faltan, no hay avisos pero la API funciona
  igual.
- **Los aparatos (R3, R4):** uno por navegador, del usuario, con sus tipos. Cerrar sesión los pausa.
  Sólo se acepta la dirección de los servicios de avisos conocidos.
- **A quién (R5):** al propietario que tenga el negocio en ese momento y a los super admin.
  Recepción, administradores, el rol Profesional y el super admin en modo soporte no reciben los del
  negocio.
- **La cola (R6):** el aviso se guarda en la misma operación que lo provoca y sale al momento sin
  retrasar la respuesta, como los emails. Lo que no salió lo reintenta el cron hasta 24 h. Un
  aparato que ya no existe se da de baja solo. **Si algo falla, la reserva y los emails siguen
  igual.**
- **Qué avisa (R7–R14):** reservas, comprobantes, cancelaciones del paciente, citas nuevas (una sola
  por serie), citas por cerrar, el resumen de las 8 y los del super admin.

**Front:**
- el aviso «Activa los avisos» al entrar y la tarjeta en Configuración, en el panel y en /admin
  (R17);
- el service worker muestra los avisos y abre la pantalla que toca (R16);
- iniciar sesión vuelve a la pantalla del aviso (R18);
- un icono pequeño para la barra de Android;
- una línea en /privacidad (R19).

**Beta:** queda fuera. No tiene servidor que envíe avisos.

**Migración 040:** dos tablas nuevas, los aparatos y la cola de avisos (ver
[data-model.md](./data-model.md)).

**Constitución 1.8.0:** el texto propuesto está abajo.

## Contexto técnico

**Lenguaje/versión**: TypeScript. Node ejecuta `.ts` en el backend; el front usa React 19 con
service worker de workbox (`injectManifest`).

**Dependencias**: ninguna nueva. El cifrado y la firma usan `node:crypto`, como la verificación en dos
pasos (`totp.ts`) y el cifrado de la spec 009 (`secret-box.ts`). Ver R1: por qué no la librería
`web-push`.

**Almacenamiento**: la migración 040 (`push_subscriptions` y `push_messages`). El informe del cron va
en `cron_runs.report`, sin migración.

**Variables nuevas:**
- `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY`: en Vercel, Lambda y los secretos de GitHub;
- `VAPID_SUBJECT`: opcional.

En el front, ninguna.

**Pruebas**: las suites nuevas y las que se actualizan de [quickstart.md](./quickstart.md), con `npm
test` y `npm run typecheck`. En el front, `npm run build` y `npm run lint`, más:
- Playwright con la versión compilada, en escritorio y a 390 px;
- Chrome, Firefox y Safari de la Mac con el servicio de avisos de verdad, en local.

**Restricciones**:
- **CPU de Vercel:** cifrar y firmar un aviso son 1 o 2 milisegundos, y se envía después de
  responder. Lo que puede esperar (citas por cerrar, el resumen, los del super admin del cron,
  reintentos y limpieza) lo hace el cron de GitHub.
- **Servicios de avisos:** son los de cada navegador (Google, Apple, Mozilla, Microsoft), gratis y
  sin cuenta. Cada aviso dura 24 h como mucho.

## Comprobación contra la constitución (1.7.0 → 1.8.0)

| Principio | Cumple | Cómo |
|---|---|---|
| I. Español | Sí | Los avisos, la tarjeta, los mensajes de error y la documentación, en español. |
| II. Privacidad | Sí | El paciente a medias (`shortName`), sin contacto ni datos clínicos (R7). El aviso viaja cifrado: el servicio del navegador no lo puede leer. Los registros públicos del cron sólo tienen cifras, nunca títulos, textos ni direcciones de aparatos. La analítica no ve el destino del inicio de sesión. /privacidad lo explica. |
| III. Decisiones | Sí | Las siete decisiones del dueño del 2026-10-14. Modo soporte: el super admin no recibe los avisos del negocio y no se avisa de su entrada. ntfy no cambia. «Por verificar» (spec 009) se marca. La verificación en dos pasos se exige para activar en /admin. Los negocios no ven planes: sólo el aviso al super admin los nombra. |
| IV. Local | Sí | Todo se comprueba en local ([quickstart.md](./quickstart.md)), incluido el servicio de avisos real de Google, Mozilla y Apple. El iPhone sólo se puede ver con la app publicada (ver los riesgos). |
| V. Compartido | Sí | Tipos (`PushKind`, `PushConfig`, `PushDevice`), constantes (`src/lib/constants/push.ts`) y validaciones (`src/lib/validations/push.ts`) se editan en el front y se copian con `sync:shared`. Los dos archivos nuevos se crean vacíos en el backend antes, como en las specs 011 y 012. |
| VI. Barato | Sí | Sin dependencias ni servicios de pago. Lo que puede esperar va por el cron, y lo que sale al momento (la spec pide menos de 30 s) cuesta milisegundos y usa `waitUntil`, como los emails. La CSP no cambia (R19). |
| VII. Diseño | Sí | La franja y la tarjeta usan los tokens del tema y el estilo de las tarjetas de hoy. Una columna a 390 px, cada interruptor con su etiqueta y el estado anunciado al lector de pantalla. |
| Restricciones | Sí | La migración 040 la aplica el dueño antes del backend, y el plan lo dice como paso aparte. Las claves nuevas no impiden arrancar: no protegen nada (R2). |

**Sin excepciones.** Hay una aclaración del principio VI: ntfy lo manda el cron para no poner su tema
en Vercel. Aquí la clave privada de los avisos sí va en Vercel y Lambda, porque la spec pide el aviso
de una reserva en menos de 30 segundos. Lo aprobó el dueño en la spec (supuesto «Claves del servicio
de avisos»).

**Constitución 1.8.0 (MENOR), en los dos repos.** Texto propuesto:

- **Principio II**, el punto de ntfy pasa a decir:

  > - Los avisos por ntfy y en el celular llevan al paciente sólo a medias (`masking.ts`: "Juan P.",
  >   "ju***@gmail.com", "***5555", sólo los últimos 4 dígitos del teléfono desde el 2026-10-14). Los
  >   del celular sólo llevan el nombre a medias: nunca su contacto, su cédula ni nada de la
  >   historia clínica.

- **Principio III**, un punto nuevo:

  > - Los avisos en el celular (Web Push estándar, sin tiendas de aplicaciones) son sólo para el
  >   propietario de cada negocio y para los super admin; Recepción, los administradores y el rol
  >   Profesional no los reciben, y el super admin en modo soporte no recibe los del negocio. Al
  >   entrar al panel se ofrecen una vez por aparato («Ahora no» lo deja 7 días) y vienen con todos
  >   los tipos encendidos; en Configuración se apaga cada tipo o se desactivan en ese aparato, y
  >   cerrar sesión los pausa en él. El propietario recibe al momento las reservas online (también
  >   «Por verificar»), los comprobantes de pago, las cancelaciones del paciente desde su email y las
  >   citas nuevas en su agenda que agendó otra persona (una sola por serie); desde el cron, cada cita
  >   que terminó hace 30 minutos y sigue Pendiente o Confirmada y, a las 8 de la noche en la hora del
  >   negocio, el resumen de las de hoy sin cerrar. El super admin recibe al momento los negocios
  >   nuevos y las solicitudes de plan, y desde el cron los cambios de seguridad en cuentas de super
  >   admin y los intentos fallidos, además de ntfy. Si los avisos fallan, la reserva y los emails
  >   siguen igual (2026-10-14).

- **Restricciones técnicas y de seguridad**, un punto nuevo:

  > - Avisos en el celular con Web Push y claves VAPID propias (`VAPID_PUBLIC_KEY`,
  >   `VAPID_PRIVATE_KEY`) en Vercel, Lambda y los secretos de GitHub. Sin ellas la API arranca igual
  >   y no hay avisos. Sólo se envían a los servicios de avisos de los navegadores (Google, Apple,
  >   Mozilla y Microsoft).

Si el dueño cambia algo de «Cambios respecto a la spec» o de las preguntas, el texto se ajusta antes
de aplicarlo.

## Cambios respecto a la spec

Hay que aprobarlos con el plan:

1. **Cerrar sesión pausa los avisos en ese aparato (R3).**
   - **Por qué:** en una computadora compartida (la de recepción), quien entra después no debe ver
     los avisos del propietario.
   - **Cómo se reanudan:** al volver a entrar se reanudan solos, con los mismos tipos, sin volver a
     dar permiso.
   - **Ojo:** que la sesión caduque no los pausa; sólo «Cerrar sesión».
2. **Una serie de la spec 011 avisa una sola vez (R11):** «Citas nuevas en tu agenda · 8 citas desde
   el mar 20 oct 10:00 · Juan P.». Es como el email único de la serie. Ocho avisos seguidos serían
   spam.
3. **Si hay varios super admin, cada uno activa los suyos (R5)** y recibe los cuatro tipos. La spec
   dice «el super admin».
4. **«Negocio nuevo» es el del registro (R14):** sale cuando alguien termina su alta. Uno que crea un
   super admin desde /admin no avisa (pregunta 3).
5. **«Negocio nuevo» y «Solicitud de cambio de plan» salen al momento (R14).** La spec sólo dice que
   pueden tardar los del cron; éstos no hace falta que esperen.
6. **Citas por cerrar con el cron atrasado (R12):**
   - si el cron estuvo parado, se avisa como mucho de las de las últimas 3 horas. Así no llegan de
     golpe las de toda la mañana: las demás las cuenta el resumen de las 8;
   - una cita que termina a las 23:45 se avisa a las 00:15, aunque ya sea otro día.
7. **El resumen de las 8 (R13):**
   - cuenta las citas de hoy que terminaron hasta las 8 y siguen Pendiente o Confirmada. Las de más
     tarde aún no se pueden cerrar;
   - si el cron no corre entre las 8 y las 11 de la noche, ese día no llega.
8. **El profesional en el aviso (R7):** si el negocio tiene más de una agenda, «Nueva reserva» y «Cita
   por cerrar» añaden «· con Dra. Pérez». Así el propietario sabe de quién es (pregunta 2).
9. **Textos:**
   - **«celular» o «computadora»:** «en este celular» con pantalla táctil y «en esta computadora» si
     no;
   - **iPhone:** se usa «Agregar a inicio», como ya lo explica la app al instalarla (la spec dice
     «Añadir a pantalla de inicio»);
   - **sin el 🔔 del ejemplo:** el aviso ya lleva el icono de Agenda360.
10. **Iniciar sesión vuelve a la pantalla del aviso (R18).** Hoy el inicio de sesión lleva siempre al
    Inicio. Además, «Actividad → Seguridad» de /admin se puede abrir directamente.
11. **`/api/health` dice si los avisos están listos (`"push": true`).** Así se comprueba al publicar,
    como el CAPTCHA.
12. **/privacidad** nombra el servicio de avisos del navegador (R19).
13. **Hasta 10 aparatos por persona:** al activar el undécimo, se quita el más antiguo (R3).

## Estructura

```text
specs/013-avisos-en-la-app/   spec, plan, research, data-model, contracts/api.md, quickstart (tasks y reporte, después)

agenda-backend
  .specify/memory/constitution.md               1.8.0
  db/migrations/040_push_notifications.sql      NUEVO (data-model)
  src/config.ts                                 VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT; config.webPush (sin claves, null y aviso en el registro)
  src/services/web-push.ts                      NUEVO: cifrado RFC 8291, firma VAPID, envío, lista de servicios, generateVapidKeys (R1, R4)
  src/services/push-delivery.ts                 NUEVO: queuePush con punto de guardado, processPushQueue, schedulePushDelivery,
                                                flushPushDelivery, disableImmediatePushDelivery, limpieza (R6)
  src/services/push-notices.ts                  NUEVO: qué dice cada aviso y a quién: notifyOnlineBooking, notifyReceipt,
                                                notifyPatientCancel, notifyNewAppointment, notifyNewSeries, notifyNewBusiness,
                                                notifyPlanRequest, queueUnclosedNotices, queueEveningSummaries y los del cron
                                                del super admin (R5, R7–R14)
  src/services/push-device-service.ts           NUEVO: config, guardar, tipos, desactivar, aviso de prueba, pausar al cerrar sesión (R3)
  src/routes/push-routes.ts                     NUEVO: /api/push (contracts), con sus límites de peticiones
  src/app.ts                                    monta /api/push; en Lambda, flushPushDelivery al responder; /api/health con push
  src/services/public-booking-service.ts        book: notifyOnlineBooking (R8)
  src/services/payment-service.ts               completeUpload: notifyReceipt (R9)
  src/services/business-data-service.ts         appointmentService.create: notifyNewAppointment (R11);
                                                cancelFromPatientLink de la spec 010: notifyPatientCancel (R10)
  src/services/appointment-series-service.ts    (spec 011) create: notifyNewSeries, una vez por serie (R11)
  src/services/account-service.ts               businessService.create: notifyNewBusiness; subscriptionService.requestPlanChange: notifyPlanRequest (R14)
  src/services/auth-service.ts                  signOut pausa los aparatos de esa sesión (R3)
  src/services/account-alerts.ts                AccountChange con el id del registro (clave del aviso, R14)
  src/jobs/scheduled-tasks.ts                   citas por cerrar, resumen de las 8, avisos del super admin, envío y limpieza; informe push (R12–R15)
  scripts/cron.ts                               línea del registro y aviso de ntfy si los avisos no salen (R15)
  scripts/push-keys.ts                          NUEVO: npm run push:keys (R2)
  scripts/dev-local.ts                          claves de desarrollo en .local-db/vapid.json (R2)
  scripts/test.ts                               claves de prueba para la API de pruebas
  .github/workflows/cron.yml                    VAPID_* desde los secretos
  package.json                                  script push:keys
  src/db/seed.ts                                push_messages y push_subscriptions en TABLES
  src/shared/lib/constants/push.ts, src/shared/lib/validations/push.ts   NUEVOS (copias, vacíos antes de sync:shared)
  src/shared/**                                 sólo con npm run sync:shared
  .env.example, README.md                       las variables y la función
  tests/web-push.test.ts, tests/push-notices.test.ts                     NUEVOS
  tests/helpers/harness.ts                      servicio de avisos falso
  tests/cron.test.mjs, hardening.test.ts, delete-business.test.mjs       actualizados

agenda-front
  .specify/memory/constitution.md               1.8.0
  src/types/index.ts                            PushKind, PushConfig, PushDevice
  src/lib/constants/push.ts                     NUEVO, compartido: tipos por rol, etiquetas, 30 min, 20 h, 7 días
  src/lib/validations/push.ts                   NUEVO, compartido: pushDeviceSchema, pushKindsSchema
  src/sw.ts                                     push, notificationclick, pushsubscriptionchange (R16)
  public/icon-badge-96.png                      NUEVO: icono de la barra de Android
  src/features/push/push-support.ts             NUEVO: qué puede este navegador (R17)
  src/features/push/use-push-device.ts          NUEVO: activar, desactivar, tipos, aviso de prueba
  src/features/push/use-push-sync.ts            NUEVO: sincronización silenciosa al abrir el panel
  src/features/push/push-prompt.tsx             NUEVO: «Activa los avisos en este celular»
  src/features/push/push-settings-card.tsx      NUEVO: «Avisos en este celular»
  src/features/push/notification-navigation.ts  NUEVO: abrir la ruta del aviso sin recargar
  src/main.tsx                                  carga notification-navigation
  src/features/install/install-prompt.ts, install-app.tsx   exportan isStandalone, isAppleMobile e IosInstallDialog; texto de InstallAppCard
  src/components/layout/dashboard-layout.tsx, admin-layout.tsx   franja, sincronización y /login?next (R17, R18)
  src/features/auth/login-form.tsx, src/lib/auth/                safeNextPath (R18)
  src/pages/dashboard/settings-page.tsx         la tarjeta en Notificaciones (propietario, fuera del modo soporte)
  src/pages/admin/admin-settings-page.tsx       la tarjeta en la columna de la cuenta
  src/pages/admin/admin-activity-page.tsx       ?ver=seguridad
  src/lib/data/repository.ts, api-repository.ts, src/hooks/queries/use-push.ts, query-keys.ts   push.*
  src/pages/privacy-page.tsx                    el servicio de avisos (R19)
  README.md                                     los avisos y cómo probarlos

agenda-beta: sin cambios (no tiene servidor)
```

`vercel.json` del front no cambia (R19).

## Publicación

**El orden importa:**
- la migración va antes del código que la usa;
- las claves van antes de publicar el backend, para que los avisos funcionen desde el primer
  momento.

1. **Constitución 1.8.0,** al aprobar este plan, en los dos repos.
2. **Comprobar que las specs 010, 011 y 012 ya están publicadas** o que salen juntas con ésta. Sus
   migraciones (037, 038 y 039) van antes que la 040.
3. **Crear las claves del servicio de avisos** en tu equipo, con el código de esta spec ya en `dev`:

   ```
   cd ~/Documentos/Proyectos/Backend/agenda-backend
   npm run push:keys
   ```

   Salen dos líneas, `VAPID_PUBLIC_KEY=…` y `VAPID_PRIVATE_KEY=…`. Ponlas en tres sitios:
   - **Vercel:** en el proyecto del backend (Production), las dos variables;
   - **Lambda:** en la configuración de la función `agenda-backend` (Configuración → Variables de
     entorno), las dos;
   - **GitHub,** para el cron. Cada comando pide el valor:

     ```
     gh secret set VAPID_PUBLIC_KEY --repo jhordan-huera/agenda-backend
     ```

     ```
     gh secret set VAPID_PRIVATE_KEY --repo jhordan-huera/agenda-backend
     ```

   Guárdalas también en un lugar seguro. Si se pierden, cada aparato tiene que volver a activar los
   avisos. `VAPID_SUBJECT` no hace falta.
4. **Migración 040,** como paso aparte, antes del PR del backend. Si salen juntas con las specs 010
   a 012, el mismo comando aplica también la 037, la 038 y la 039:

   ```
   cd ~/Documentos/Proyectos/Backend/agenda-backend
   npm run db:migrate
   ```

5. **Comprobar que quedó aplicada.** Es una consulta de sólo lectura en el editor SQL de Supabase:

   ```
   begin read only;
   select name, applied_at from schema_migrations order by name desc limit 3;
   rollback;
   ```

   Debe aparecer `040_push_notifications.sql`.
6. **PR `dev` → `main` del backend.** Al publicarse, abrir esta dirección y ver `"push":true`:

   ```
   https://agenda-backend-lemon.vercel.app/api/health
   ```

   Si dice `false`, falta una clave en Vercel o está mal copiada. La API funciona igual, pero sin
   avisos.
7. **PR `dev` → `main` del front.** Si saliera antes que el backend, no se vería nada nuevo: la
   tarjeta sólo aparece cuando la API la ofrece.
8. **Beta:** sin cambios.

## Riesgos

- **iPhone:**
  - **cuándo funcionan:** sólo con la app instalada en la pantalla de inicio y con iOS 16.4 o más
    reciente. Es una regla de Apple, y la tarjeta lo explica;
  - **cómo se comprueba:** en local se prueba el servicio de Apple con Safari de la Mac, pero el
    iPhone sólo se puede ver con la app publicada, porque Apple exige `https` y la app instalada. Si
    al activarlo en tu iPhone algo falla, se corrige con un arreglo pequeño;
  - **con el modo de concentración** o los avisos de la app apagados en Ajustes, el iPhone no los
    muestra. Eso no lo controla la app.
- **Las claves:** si se pierden o se cambian, todos los aparatos dejan de recibir avisos hasta que
  se vuelven a activar. En Chrome y Firefox se arregla solo al abrir el panel; en el iPhone hace
  falta un toque. Guárdalas como `TWO_FACTOR_KEY`.
- **El cifrado es propio (R1).** Un error ahí haría que no llegara nada. Lo cubren el ejemplo
  oficial de la norma, byte a byte, y las pruebas con Chrome, Firefox y Safari de verdad.
- **Lo que se ve en la pantalla bloqueada:** el servicio y el paciente a medias («Limpieza · Juan
  P.»). Lo decidió el dueño. En un servicio delicado (por ejemplo, de salud mental), el nombre del
  servicio se ve con el celular bloqueado. Quien no lo quiera puede ocultar el contenido de los
  avisos en los ajustes del celular.
- **Una clínica con muchas citas** recibe un aviso por cada cita por cerrar. Se puede apagar ese
  tipo y quedarse con el resumen de las 8 (caso límite de la spec).
- **Retrasos del cron:** las citas por cerrar, el resumen y las alertas del super admin dependen de
  que el cron corra cada 10 minutos (cron-job.org). Si se para, se recuperan las últimas 3 horas y el
  resumen no llega si pasan las 11 de la noche.
- **Un aviso puede llegar dos veces** si el servicio de avisos tarda en responder y se reintenta. El
  segundo reemplaza al primero en la pantalla (mismo `tag`), así que no se ven dos.
- **Computadoras compartidas:** cerrar sesión pausa los avisos (cambio 1). Pero si alguien deja la
  sesión abierta, ese navegador sigue recibiendo los avisos del propietario, como hoy sigue viendo su
  panel.
- **Archivos compartidos con las specs 010, 011 y 012** (`business-data-service.ts`,
  `scheduled-tasks.ts`, `scripts/cron.ts`, los tipos y `seed.ts`): ésta se implementa con esas tres ya
  cerradas en `dev` (R20).
- **Si se publicara el backend antes de aplicar la migración 040,** las reservas y los emails
  seguirían funcionando (R6), pero sin avisos hasta aplicarla.

## Decisiones del dueño del producto (2026-10-14)

El dueño pidió avanzar con la 013 sin esperar a revisar el plan («si la 013 está aprobada, avanza»), así
que se toman las propuestas de abajo como sus respuestas. Las puede cambiar al probarlo:
1. Cerrar sesión pausa los avisos en ese aparato: sí.
2. Con varias agendas, el aviso dice de qué profesional es: sí.
3. «Negocio nuevo» sólo cuando alguien se registra, no cuando lo crea un super admin: sí.
4. Todos los super admin pueden activar sus avisos: sí.
5. El resumen de las 8 cuenta sólo las citas que ya terminaron: sí.

Los «Cambios respecto a la spec» de este plan quedan aprobados con él.

## Preguntas para el dueño del producto

1. **¿Cerrar sesión pausa los avisos en ese aparato?**
   - **Propuesta: sí** (cambio 1), para las computadoras compartidas. Se reanudan solos al volver a
     entrar.
   - **Si prefieres que no,** siguen llegando hasta que se pulse «Desactivar en este celular».
2. **En un negocio con varias agendas, ¿el aviso dice de qué profesional es?** Sería «Nueva reserva ·
   Mañana 16:00 · Limpieza · Juan P. · con Dra. Pérez».
   - **Propuesta: sí,** en «Nueva reserva» y en «Cita por cerrar». Con una sola agenda no se añade
     nada.
3. **«Negocio nuevo»: ¿también cuando un super admin crea un negocio desde /admin?**
   - **Propuesta: no,** sólo cuando alguien se registra, como dice la spec. Quien lo crea ya lo sabe.
4. **Super admin: ¿todos los del equipo pueden activar sus avisos, o sólo el principal?**
   - **Propuesta: todos,** cada uno en su panel y con sus cuatro tipos.
5. **El resumen de las 8: ¿cuenta sólo las citas que ya terminaron a las 8?**
   - **Propuesta: sí** (cambio 7). Una cita de las 8:30 todavía no se puede cerrar.
