# Plan de implementación: Encuesta después de la cita

**Rama**: `dev` · **Fecha**: 2026-11-12 · **Spec**: [spec.md](./spec.md)

**Con migración** (la 057): las encuestas, la marca «No quiero recibir estas encuestas» del paciente y el aviso nuevo
de la campana. La aplica el dueño del producto antes de publicar el backend. El interruptor no necesita columna: va
en `notificationSettings`, como el informe mensual.

## Decisiones que salen del código (para aprobar con el plan)

1. **Cuándo sale:** desde las 10:00 de la hora del negocio, del día siguiente a la cita en adelante. Como mucho a los
   3 días de la cita.
2. **La frecuencia, respuesta 1:** se pregunta si ese paciente no recibió ninguna encuesta del negocio en los últimos
   90 días. La primera cita Atendida siempre la recibe.
3. **Si el email espera en la cola** (por el cupo de Gmail) y no salió a los 2 días de ponerse en cola, se descarta.
   Es lo que pide la spec: «si pasaron 3 días desde la cita, ya no sale». Como el descarte del aviso de la lista de
   espera, va en la constitución.
4. **El aviso de 1 o 2 estrellas** va en la campana del propietario y del profesional de la agenda, con el nombre
   del paciente, como el resto de los avisos de una cita. Nunca lleva el comentario.
5. **Quién ve las opiniones:** quienes ven Reportes: el propietario, los administradores y el rol Profesional (sólo
   las de su agenda). En la ficha del paciente sale el mismo bloque para ellos; Recepción no lo ve.

## Diseño

1. **La base de datos** (`db/migrations/057_encuesta_despues_de_la_cita.sql`), con RLS:
   - **`surveys`:** una por cita (`appointment_id` único).
     - `business_id`, `appointment_id`, `client_id` (el paciente principal) y `professional_id`, todos con
       `on delete cascade`: se borran con el paciente;
     - `token`: 32 caracteres al azar, como el de «Tu cita»;
     - `sent_at` y `expires_at` (`sent_at` + 14 días);
     - `rating` (de 1 a 5), `comment` (hasta 1000 caracteres) y `answered_at`, vacíos hasta que responde.
   - **`clients.surveys_opted_out_at`:** cuándo pidió dejar de recibirlas (vacío = las recibe).
   - **La campana:** se vuelven a crear `panel_notices_kind_check` y `panel_notices_scope_check` con `survey_low`.

2. **El interruptor** (`notificationSettings.surveys`, `false` por defecto con `.default(false)`):
   - en Configuración → Notificaciones (`notification-settings-form.tsx`), «Preguntar al paciente cómo le fue»;
   - lo cambia el propietario (respuesta 2), con su entrada en la actividad (`NOTIFICATION_FIELDS`).

3. **El envío** (`back/src/services/surveys.ts`, nuevo: `runSurveyJob(db, businessId, at)`). Lo llama
   `queueSurveyRequests(now)` en `scheduled-tasks.ts`, antes de `processEmailQueue`, en cada pasada del cron y en
   local. Por cada negocio activo con la encuesta encendida, desde las 10:00 de su hora:
   - **busca las citas candidatas:** Atendidas, de hace 1 a 3 días, sin encuesta, con un paciente principal con email
     y sin la marca;
   - **descarta** las de pacientes que recibieron una encuesta del negocio en los últimos 90 días;
   - **elige una sola por paciente,** la más reciente;
   - **inserta la encuesta y pone en cola el email `survey_request`,** con 5 estrellas como botones
     (`/encuesta/:token?estrellas=N`) y «No quiero recibir estas encuestas». No lleva copia al profesional;
   - **lo descarta en `deliver`** si no salió a los 2 días de ponerse en cola (decisión 3);
   - **en el registro del cron,** sólo la cifra.

4. **La página de la encuesta** (`/encuesta/:token`, nueva; `front/src/pages/survey-page.tsx`):
   - **`GET /public/surveys/:token`:**
     - el negocio, el profesional, el servicio y la fecha de la cita;
     - si ya respondió o si caducó;
     - el aviso: «Tu respuesta la lee [negocio], con tu nombre. No se publica en ningún lado».
   - **`POST /public/surveys/:token`** `{ rating, comment }`:
     - una sola respuesta;
     - con la actividad («Paciente (desde su email)»: las estrellas, nunca el comentario);
     - si es de 1 o 2 estrellas, el aviso `survey_low` en la campana.
   - **`POST /public/surveys/:token/opt-out`:** pone la marca, con su entrada en la actividad. Repetirlo no hace
     nada.
   - **Las protecciones:** un límite de peticiones, como «Tu cita»; `Cache-Control: private, no-store`; `noindex`
     en `vercel.json`; la ruta limpia en los avisos de errores; y la página sigue el modo del aparato, como las del
     paciente.
   - **En pantalla:**
     - la estrella del email ya elegida, el comentario opcional y «Enviar»;
     - después, «Gracias por contarnos»;
     - con la encuesta ya respondida, «Ya respondiste esta encuesta»;
     - caducada, «Esta encuesta ya cerró».

5. **Las opiniones en el panel:**
   - **La ruta:** `GET /businesses/:businessId/surveys`, con `from`, `to`, `professionalId` y `clientId`. Devuelve:
     - el promedio, cuántas respondieron y cuántas de cada estrella;
     - las respuestas (fecha, paciente, profesional, servicio, estrellas y comentario), las más recientes primero,
       hasta 50.

     Pide `reports.view`; el rol Profesional, sólo su agenda (`agendaScope`).
   - **Reportes:** la tarjeta «Opiniones de los pacientes»
     (`front/src/features/reports/patient-feedback-card.tsx`, nueva), con el periodo y el profesional elegidos:
     - el promedio grande y «de N respuestas»;
     - una barra por estrella;
     - los últimos comentarios;
     - sin respuestas: «Todavía no hay opiniones en este periodo».

     No sale si la encuesta está apagada y no hay ninguna respuesta.
   - **La ficha del paciente:** el bloque «Sus opiniones», con sus respuestas. Sólo para quien ve Reportes.

6. **El aviso de la campana** (`survey_low`): «[Paciente] calificó su cita con 2 estrellas». Abre la ficha del
   paciente. Lo ven el propietario y quien tiene esa agenda (`{ owner: "all", team: null, agenda: true }`). No manda
   push ni ntfy.

7. **El informe mensual** (spec 040): `monthStats` suma el promedio y cuántas respondieron. El email lo agrega, con la
   comparación con el mes anterior, sólo si hubo respuestas. Sin comentarios ni nombres.

8. **La descarga de datos** (spec 028): `encuestas.xlsx`, con las encuestas respondidas (fecha de la cita, paciente,
   profesional, servicio, estrellas, comentario y fecha de la respuesta). Lleva su ruta, su cifra, su paso y su línea
   en el LEEME. El rol Profesional descarga las de su agenda.

9. **Lo que se toca por los tipos nuevos:**
   - el `EmailType` `survey_request` (nivel paciente) y sus listas (`EMAIL_PRIORITY`, `EMAIL_GROUPS`, `TYPE_LABELS` y
     la tabla de `email-quota.test.ts`);
   - el `PushKind`/`NoticeKind` `survey_low`, con `NOTICE_AUDIENCE`, su texto y su icono;
   - `TABLE_INFO`, `TABLES` del seed y `leftovers` de `delete-business.test.mjs`;
   - `npm run sync:shared`: `validations/survey.ts` se crea antes vacío en el backend.

10. **La constitución, 1.47.0, en los dos repos** (principio III):
    - la decisión;
    - la excepción a la copia al profesional;
    - el descarte a los 2 días en la cola;
    - que las opiniones nunca son públicas.

**No se hace:**
- publicar opiniones ni pedir reseñas en Google;
- la encuesta por WhatsApp;
- preguntar a los otros pacientes de una sesión en pareja;
- la beta.

## Comprobación contra la constitución

| Principio | ¿Cumple? | Cómo |
|---|---|---|
| II. Privacidad | Sí | Las opiniones sólo se ven dentro del panel, para quien ve Reportes. La campana, la actividad y los registros no llevan el comentario. El enlace es personal, `no-store` y `noindex` |
| III. Testimonios sólo con permiso | Sí | Nada sale en la portada ni en la página de reservas |
| III. Copia al profesional | Excepción | La encuesta no es un aviso de la cita. Va en la constitución |
| III. La cola no descarta | Excepción | La encuesta que esperó 2 días en la cola se descarta. Va en la constitución |
| III. Actividad | Sí | Responder, dejar de recibirlas y el interruptor van a la actividad; los envíos del cron, no |
| IV. Pruebas sin depender del día | Sí | La tarea recibe `at`; las pruebas usan fechas relativas a ese momento |
| V. Código compartido | Sí | La validación, los tipos y las plantillas se editan en el front |
| VI. Costo de Vercel | Sí | El envío lo hace el cron de GitHub. La API sólo responde la página y las opiniones de Reportes |
| VII. Diseño | Sí | Las estrellas son botones con su nombre («4 estrellas»), con el foco visible, contraste AA y 390 px sin desbordes |

## Pruebas

- **`tests/surveys.test.ts`** (nueva, la suite 76):
  - **El interruptor:** sólo el propietario, con la actividad. Apagado, no sale nada.
  - **`queueSurveyRequests(at)`:**
    - no sale antes de las 10:00, ni el mismo día de la cita, ni pasados 3 días;
    - sólo las Atendidas, sólo el paciente principal, sólo con email y nunca con la marca;
    - la primera cita sí; otra a los 30 días no; a los 91 días sí;
    - una por paciente aunque tenga dos citas;
    - sin `appointment_copy`;
    - un negocio suspendido no envía.
  - **La página:** responder una vez (la segunda, rechazada); la validación (estrellas de 1 a 5, comentario de hasta
    1000); caducada a los 14 días; un token que no existe, 404.
  - **El aviso de 1 o 2 estrellas,** sin el comentario; con 4 estrellas, ninguno.
  - **«No quiero recibir estas encuestas»:** la marca, la actividad y que no vuelve a recibirlas.
  - **Las opiniones:** el promedio y los conteos por periodo y profesional; el rol Profesional, sólo su agenda;
    Recepción, 403.
  - **El informe mensual, la descarga de datos y el borrado con el paciente.**
  - **El descarte a los 2 días.**
- **Las que se ponen al día:** `email-quota.test.ts`, `database-stats.test.ts`, `delete-business.test.mjs`, el texto del
  registro en `cron.test.mjs` y `monthly-report.test.ts`.
- **Backend:** `typecheck` y `npm test`.
- **Front:** build, lint sin avisos y todas las `check:*`, más la nueva `check:surveys` (leer la estrella del enlace,
  el promedio y las barras por estrella).
- **Recorrido en el navegador** (Chromium a 1440 en claro y WebKit a 390 en oscuro), con capturas:
  - encender el interruptor;
  - correr la tarea y abrir el enlace del email con 4 estrellas;
  - responder y ver «Gracias»; volver a abrirlo y ver «Ya respondiste»;
  - una de 2 estrellas y su aviso en la campana;
  - Reportes y la ficha del paciente;
  - sin desbordes ni errores en la consola.

## Riesgos

- **En psicología, una encuesta puede incomodar.** Por eso empieza apagada (respuesta 2) y pregunta como mucho cada 3
  meses (respuesta 1).
- **Pocas respuestas en un negocio pequeño:** el promedio sale siempre con «de N respuestas», para que no se lea más
  de lo que dice.
- **El cron de GitHub puede atrasarse:** la encuesta puede salir un poco después de las 10:00. No importa.
