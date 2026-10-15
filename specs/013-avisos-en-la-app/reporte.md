# Reporte final: Avisos en el celular desde la app instalada

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada en dev · **Fecha**: 2026-10-14

**Repos**: los dos (agenda-backend y agenda-front; la beta no cambia) · **Migración**: Sí:
`040_push_notifications.sql`

## Resumen

El propietario de cada negocio y los super admin reciben avisos en el celular o en la computadora,
como cualquier aplicación: al entrar al panel se ofrecen con un toque y en Configuración se apaga cada
tipo o se desactivan en ese aparato. Al propietario le llegan al momento las reservas online, los
comprobantes, las cancelaciones del paciente y las citas que le agenda otra persona; desde el cron,
las citas por cerrar y el resumen de las 8 de la noche. El paciente siempre va a medias («Juan P.»), y
si los avisos fallan, la reserva y los emails siguen igual. Se probó con Chrome y el servicio de avisos
real de Google: una reserva llegó al navegador en 2 segundos.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – Los avisos vienen activados | P1 | Hecha | Franja al entrar, tarjeta en Configuración (negocio y /admin), «Ahora no» 7 días, iPhone sin instalar y permiso bloqueado. En un iPhone de verdad, sin comprobar (ver abajo). |
| H2 – Le llegan los avisos del negocio | P1 | Hecha | Reservas (también «Por verificar» y en pareja), comprobantes, cancelaciones del paciente (spec 010) y citas nuevas en su agenda. Al tocarlos se abre la cita. |
| H3 – Citas sin cerrar | P1 | Hecha | «Cita por cerrar» a los 30 minutos y el resumen de las 8 en la hora de cada negocio, desde el cron, apagables por separado. |
| H4 – El super admin recibe los suyos | P2 | Hecha | Negocio nuevo, solicitud de plan, cambios de seguridad e intentos fallidos, además de ntfy. |

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – «Avisos en este celular»: activar, desactivar, prueba y tipos | Cumple | `push-notices` (aparatos, tipos, desactivar, aviso de prueba) y Playwright §1, §2, §7 y §13: los seis tipos encendidos de fábrica, «Guardado» al momento y apagado al recargar; en /admin, los cuatro del super admin. |
| RF-001b – Se ofrece al entrar; «Ahora no», 7 días | Cumple | Playwright §1 (franja «Activa los avisos en esta computadora», «Activar») y §8 («Ahora no» no vuelve al recargar; con la fecha adelantada 8 días, vuelve). |
| RF-002 – Cada aparato por separado; varios por persona | Cumple | `push-notices`: dos aparatos reciben la misma reserva; con un tipo apagado en uno, sólo el otro; el undécimo quita el más antiguo; la misma dirección de otra persona pasa a ella con los tipos de fábrica. |
| RF-003 – iPhone sin instalar y permiso rechazado | Cumple (simulado) | Playwright §10 (navegador con la identidad de un iPhone y sin `PushManager`: «sólo llegan con la app instalada» y el diálogo «Instalar en tu iPhone o iPad») y §9 (permiso denegado de verdad por CDP: sin franja y los pasos del candado). En un iPhone real: sin comprobar. |
| RF-004 – Reservas, comprobantes, confirmaciones, cancelaciones y citas nuevas, al momento | Cumple | `push-notices`: «Nueva reserva · {día} {hora} · {servicio} · Juan P.», «· Por verificar», la pareja «Carla M. y Luis R.», un reintento no repite; «Comprobante de pago», una segunda subida no avisa; «El paciente confirmó · {día} {hora} · Pedro P.» (2026-10-15), que abre la cita, y confirmar otra vez no repite; «Cita cancelada por el paciente», un doble toque no repite; «Cita nueva en tu agenda» si la agenda Recepción o el super admin en modo soporte, no si la agenda él ni en otra agenda; la serie de 8 (enganche de la 011) avisa una vez. Playwright §3 y el servicio real de Google (§0). |
| RF-005 – Los del super admin | Cumple | `push-notices`: el alta por el onboarding avisa a cada super admin con aparato y la de /admin no; la solicitud de plan con los dos planes; el cron (con `scripts/cron.ts` de verdad) avisa el cambio de contraseña de un super admin y los 10 intentos fallidos, una vez por cuenta y hora, y ntfy sigue mandando los suyos. |
| RF-005b – Citas por cerrar y resumen de las 8, apagables por separado | Cumple | `push-notices` con la hora del cron simulada: avisa una vez, no en la pasada siguiente ni si se cerró antes; con el cron parado 6 h, sólo las de las últimas 3 h; la de las 23:45 a las 00:15; Guayaquil y Madrid cada uno a sus 20:00, una vez; la de las 20:30 no cuenta; con 0 no sale; con el resumen apagado no llega y las citas por cerrar sí. |
| RF-006 – El paciente a medias, sin datos de contacto ni clínicos | Cumple | `push-notices` revisa los 47 avisos de la suite (pacientes con nombre y apellidos largos, email, teléfono, cédula y notas): ninguno aparece. Lo que imprimen la API y el cron no tiene títulos, textos ni direcciones de aparatos. |
| RF-007 – Al tocar se abre su pantalla, con inicio de sesión si hace falta | Cumple | Playwright §4 (CDP `deliverPushMessage`: el aviso con su título, texto, tag y ruta; al tocarlo la app abierta navega a la cita y abre su ficha; una dirección de otro sitio abre /dashboard) y §6 (`/login?next=…` y, tras entrar, la cita; `//ejemplo.com` lleva al Inicio). «Sin ventana abierta se abre una nueva» (`clients.openWindow`) sólo por revisión: Chrome headless no deja abrir ventanas desde un toque simulado. |
| RF-008 – Un aparato desaparecido deja de usarse solo | Cumple | `push-notices`: 410 lo borra y la reserva respondió 200; cinco 403 seguidos lo borran; recién activado, un 410 se reintenta (cambio 2). |
| RF-009 – Cambiar el propietario deja de avisar al anterior | Cumple | `push-notices`: con otro `owner_id`, los aparatos del anterior no reciben nada; un negocio sin propietario no avisa a nadie y, al asignárselo, la siguiente reserva le llega. |
| RF-010 – Sin servicios de pago ni tiendas | Cumple | Web Push estándar con claves propias; probado con Chrome y el servicio gratuito de Google (§0 y la prueba de CSP). |
| RF-011 – Si los avisos fallan, lo demás sigue igual | Cumple | `push-notices`: con la tabla `push_messages` renombrada (como sin la migración) la reserva responde 200, la cita y sus emails quedan y el registro dice que el aviso no se pudo poner en cola. `hardening`: sin claves VAPID la API arranca igual en la nube. |
| CE-001 – Aviso de una reserva en menos de 30 s | Cumple (medido: 2 s) | Playwright §0 con Chrome for Testing y el servicio real de Google (`jmt17.google.com`): reserva online → aviso mostrado por el navegador en 2 s. Con el servicio falso, en 1–2 s. En Android y en el iPhone, sin comprobar. |
| CE-002 – Activar en menos de un minuto | Cumple en Chrome (escritorio) | Un toque en «Activar» (más el permiso): el aparato queda guardado al momento y «Enviar un aviso de prueba» llega en 1 s con el servicio real. Android y el iPhone instalado: sin comprobar. |
| CE-003 – Ningún aviso con datos completos del paciente | Cumple | La revisión de privacidad de `push-notices` (47 avisos) y la del recorrido. |
| CE-004 – Pruebas y la tarjeta a 390 px | Cumple | Todas las suites pasan; Playwright §10 y §11 a 390 px: franja y tarjeta sin desplazamiento horizontal, una columna, foco visible y cada interruptor con su etiqueta. |

**Pruebas automáticas**:
- **Backend:** `npm run typecheck` sin errores y `env -u DATABASE_URL npm test`: 51 de 51 suites. Las
  nuevas: `web-push` (61 comprobaciones; el cifrado da el ejemplo de la RFC 8291 byte a byte) y
  `push-notices` (106). Las actualizadas: `cron` (34), `hardening` (46) y `delete-business` (33).
- **Front:** `npm run build` y `npm run lint` sin errores ni avisos nuevos (los dos avisos de Vite, el
  tamaño de un trozo y `inlineDynamicImports`, ya estaban).
- **Recorrido con Playwright** (`verificar-013.mjs`, versión compilada, escritorio y 390 px): 68 de
  68. **CSP** (`csp-013.mjs`, el build con las cabeceras de `vercel.json`, activar con Google, recibir
  y tocar): 5 de 5 en tres pasadas, sin errores en la consola.

| RF-012 – Lo que hace la persona con sus avisos queda en la actividad (2026-10-15) | Cumple | `push-notices`: activar («Activó los avisos en el celular en Chrome en Mac», o «en un aparato»), cambiar tipos («Reservas online: Encendido → Apagado»), desactivar (una vez, aunque se toque dos) y el aviso de prueba quedan en la actividad del negocio (el propietario la ve en Actividad → Usuarios) o de la plataforma (el super admin); la puesta al día silenciosa al abrir el panel y un cambio que no cambia nada, no. |

## Cambios respecto al plan

1. **Los servidores de Google de Chrome (R4).** Chrome da hoy direcciones `https://jmt17.google.com/fcm/send/…`,
   no sólo `fcm.googleapis.com`; con la lista del plan, «Activar» habría fallado en Chrome. Se aceptan
   también `jmt<N>.google.com` (sólo ese patrón: `script.google.com` o un dominio parecido se rechazan).
2. **Un aparato recién activado no se da de baja por un 404 o 410 (R6).** Con Chrome y el servicio
   real, Google respondió a veces 410 al aviso enviado nada más suscribirse y, 3 segundos después, lo
   aceptó y lo entregó (1 de 6 en la sonda y 1 vez en las pruebas de CSP). Por eso, en los 2 primeros
   minutos desde que se guarda el aparato, un 404 o 410 se reintenta como un fallo pasajero, y el
   aviso de prueba se reintenta una vez a los 3 s (si sigue igual, responde 502 y no lo borra).
3. **«Activar» llama directamente a `pushManager.subscribe` (R17),** que pide el permiso del navegador
   en la misma llamada, en vez de `Notification.requestPermission()` y después `subscribe`. Es un solo
   paso, sigue sin nada de la red antes y conserva el gesto del usuario que exige Safari.
4. **Si el servicio rechaza el aparato al activar,** la tarjeta vuelve a «Activar» con un mensaje en
   vez de quedarse en «Activados».
5. **El aviso «Avisos en el celular desactivados: …»** lo escriben la API al arrancar (`app.ts`) y la
   línea del cron, no `config.ts`: así `npm run db:migrate` y los demás comandos no lo repiten.
6. **Detalles de texto:** el resumen con una sola cita dice «Márcala Completada…» (en singular);
   `/login?next=` no se añade cuando la pantalla es el Inicio.
7. **`VAPID_SUBJECT`** va en GitHub como variable (`vars`), no como secreto: no lo es.
8. **Compartido de más:** `MUTABLE_PUSH_KINDS`, `MAX_PUSH_DEVICES` y `pushEndpointBodySchema`.
9. **/privacidad:** la fecha de «Última actualización» ya era el 14 de octubre de 2026 (la cambió la
   spec 010 ese día), así que no cambia.
10. **Navegadores reales del quickstart §3:** se probó Chrome con el servicio de Google. Firefox y
    Safari de la Mac no se pudieron probar en este equipo con Playwright; quedan para el dueño.

## Ampliación del 2026-10-15

Al probar en local, el dueño del producto pidió dos cosas más:

- **«El paciente confirmó» en el celular** (tipo `patient_confirm`, «Confirmaciones del paciente» en la
  tarjeta, encendido de fábrica y apagable). Sale la primera vez que alguien pulsa «Confirmo que voy»;
  en una sesión con varias personas, con el nombre de quien confirmó. Sin ntfy (como dice la spec 010) y
  sin migración: los aparatos que ya estaban activados lo reciben encendido.
- **Todo se audita** (constitución 1.9.0): activar los avisos en un aparato, cambiar sus tipos,
  desactivarlos y el aviso de prueba quedan en la actividad, con el navegador. En la spec 010, la
  actividad dice además cuándo se borró la confirmación del paciente.

Tareas T029–T031. El front compilado de antes no muestra el interruptor nuevo (salta los tipos que no
conoce) hasta volver a compilarlo.

## Pendientes y riesgos

- **iPhone y Android:** sin comprobar. Hace falta la app publicada (Apple exige `https` y la app
  instalada). Si al activarlo en el iPhone algo falla, es un arreglo pequeño.
- **Firefox y Safari de la Mac con sus servicios de avisos:** sin comprobar (Chrome sí).
- **El primer aviso de prueba al activar:** en Chrome headless, Google respondió 201 al aviso enviado
  nada más suscribirse pero el navegador no lo mostró en 1 de 2 pasadas (la reserva y el aviso de
  prueba siguientes sí llegaron en 1–2 s). En Chrome normal debería llegar; si no, «Enviar un aviso de
  prueba» lo repite.
- **El patrón de Google (`jmt<N>.google.com`)** sale de lo que da Chrome hoy. Si Google cambia otra
  vez de servidor, «Activar» lo dirá con «Este navegador usa un servicio de avisos que no
  reconocemos» y habrá que añadirlo (una línea en `web-push.ts`).
- **Enganche para la spec 011 (serie de citas):** hecho al fusionar en `dev`.
  `appointment-series-service.ts` llama a `notifyNewSeries(db, created, actor.userId)` justo después
  de `notifySeriesCreated`: un solo «Citas nuevas en tu agenda» por serie. La serie inserta sus citas
  sin pasar por `appointmentService.create`, así que no avisa dos veces. `push-notices` lo comprueba
  también por la ruta (Recepción crea una serie de 4 en la agenda del propietario: un solo aviso en la
  cola).
- **Archivos compartidos con las specs 011 y 012** (se trabajaron a la vez en otras copias; al
  fusionar sólo chocó `src/jobs/scheduled-tasks.ts`, resuelto juntando las dos partes): `src/jobs/scheduled-tasks.ts`, `scripts/cron.ts`,
  `src/services/business-data-service.ts`, `src/db/seed.ts`, `src/shared/types/index.ts` (y
  `src/types/index.ts` del front), `tests/cron.test.mjs`, `tests/delete-business.test.mjs`,
  `tests/helpers/harness.ts`, `README.md` de los dos repos, `src/pages/dashboard/settings-page.tsx`,
  `src/lib/data/repository.ts` y `api-repository.ts`, `src/hooks/queries/query-keys.ts`.
- **Lo que se ve en la pantalla bloqueada:** el servicio y el paciente a medias, como decidió el dueño
  (riesgo aceptado del plan).

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 4108132 | Spec 013: avisos en el celular desde la app (backend) |
| agenda-front | a1230cb | Spec 013: avisos en el celular desde la app (front) |
| agenda-backend | (el de este reporte) | Spec 013: reporte final y tareas cerradas |

Se hicieron en la rama local `trabajo-013` de cada copia y se fusionaron en `dev` después de las specs
011 y 012 (commit «Spec 013: avisos en el celular (fusión en dev)» en cada repo).

## Cómo publicarlo

1. **Constitución 1.8.0:** ya está en los dos repos.
2. **Las specs 010, 011 y 012** tienen que estar publicadas o salir juntas con ésta: sus migraciones
   (037, 038 y 039) van antes que la 040.
3. **Las claves del servicio de avisos,** en tu equipo, con este código ya en `dev`:

   ```
   cd ~/Documentos/Proyectos/Backend/agenda-backend
   npm run push:keys
   ```

   Salen dos líneas, `VAPID_PUBLIC_KEY=…` y `VAPID_PRIVATE_KEY=…`. Ponlas en tres sitios:
   - **Vercel:** proyecto del backend (Production), las dos variables;
   - **Lambda:** función `agenda-backend` → Configuración → Variables de entorno, las dos;
   - **GitHub,** para el cron (cada comando pide el valor):

     ```
     gh secret set VAPID_PUBLIC_KEY --repo jhordan-huera/agenda-backend
     ```

     ```
     gh secret set VAPID_PRIVATE_KEY --repo jhordan-huera/agenda-backend
     ```

   Guárdalas también en un lugar seguro, como `TWO_FACTOR_KEY`. `VAPID_SUBJECT` no hace falta.
4. **Migración 040,** como paso aparte, antes del PR del backend (si salen juntas, el mismo comando
   aplica también la 037, la 038 y la 039):

   ```
   cd ~/Documentos/Proyectos/Backend/agenda-backend
   npm run db:migrate
   ```

5. **Comprobar que quedó aplicada,** en el editor SQL de Supabase (sólo lectura):

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

   Si dice `false`, falta una clave en Vercel o está mal copiada (la API funciona igual, sin avisos).
7. **PR `dev` → `main` del front.** Después, en tu celular: abrir el panel, «Activar» y ver llegar
   «Avisos activados».
8. **Beta:** sin cambios.

## Texto para el PR

Spec 013: avisos en el celular desde la app instalada (Web Push estándar, sin librería ni servicios
de pago). El propietario recibe al momento las reservas, los comprobantes, las cancelaciones del
paciente y las citas que le agendan, y desde el cron las citas por cerrar y el resumen de las 8; el
super admin, los negocios nuevos, las solicitudes de plan y las alertas de seguridad. **Migración
040** (aplicarla antes) y **claves VAPID nuevas** en Vercel, Lambda y GitHub (`npm run push:keys`).
Reporte: `specs/013-avisos-en-la-app/reporte.md`.
