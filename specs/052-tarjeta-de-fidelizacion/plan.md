# Plan de implementación: Tarjeta de fidelización

**Rama**: `dev` · **Fecha**: 2026-11-16 · **Spec**: [spec.md](./spec.md) (aprobada) · Rutas: back/ = agenda-backend,
front/ = agenda-front

**Con migración** (la 059, después de la 058). La aplica el dueño del producto: para probar, en su base local; en
producción, sólo al publicar. Todo empieza apagado.

## Decisiones que salen del código

1. **El sello sí se guarda**, a diferencia del control de la spec 051. Hacen falta:
   - el ciclo (número de tarjeta);
   - el «desde que se enciende»;
   - la constancia de la corrección;
   - las visitas que ve el paciente.

   Una fila por cita y paciente, con clave única: una cita nunca da dos sellos.
2. **Un solo punto de entrada:** `loyalty.onAppointmentStatus(db, before, after, actor)` se llama dentro de la misma
   transacción de cada camino que cambia el estado de una cita:
   - `saveStatusChange` (la ficha, «Por cerrar», «Marcar todas», el tablero y «Corregir estado»);
   - la edición de la cita («Editar», cuando cambia el estado);
   - la cita creada ya Atendida;
   - el escaneo del QR, que llama a `changeAppointmentStatus`.

   Todos esos caminos ya trabajan con el negocio bloqueado (`authorize(..., { lock: true })`), así que dos cambios a
   la vez no se pisan. Las claves únicas son la segunda barrera.
3. **La cuenta del paciente va aparte de la del equipo:**
   - sus tablas: `patient_accounts` y `patient_sessions`;
   - su cookie: `agenda360_patient`, distinta de `agendo_session`;
   - sus rutas: `/api/patient/*`.

   Una sesión de paciente nunca pasa por `authorize()`, que sólo lee la del equipo. Se reutiliza lo que ya existe:
   - la contraseña con bcrypt 12 (`accounts.ts`);
   - el CAPTCHA de Turnstile (`http/captcha.ts`), al crear la cuenta y después de 3 intentos fallidos;
   - el límite de intentos (`rate-limit-store.ts`);
   - la cabecera `X-Requested-With`;
   - `no-store`.
4. **El teléfono se guarda en un solo formato (+593…)** con la regla que hoy usa `toWhatsAppNumber`. La regla pasa a
   lo compartido: `normalizePhone` en `validations/fields.ts`, y la usan el front y el backend.
5. **El QR es un enlace,** `https://<app>/q/<token>` (32 caracteres al azar, cambiable). Sirve de dos formas:
   - **«Escanear» del panel** lo lee y saca el token;
   - **la cámara del celular del profesional** abre `/q/<token>`:
     - con la sesión del equipo iniciada, lleva a la confirmación del panel;
     - sin sesión, muestra «Este QR se muestra en el consultorio» y nada más.

   Así no depende de que el navegador sepa leer QR.
6. **Leer el QR en el panel:**
   - **Primero, el `BarcodeDetector` del navegador** (Chrome y Android).
   - **Si no lo tiene (Safari), el paquete `barcode-detector` 3.2.3** (MIT, octubre de 2026, con `zxing-wasm`). Se carga sólo al abrir «Escanear», así que no pesa en el resto de la app.
   - **El QR para mostrar** se dibuja con `uqr`, que ya se usa en el QR de la página de reservas.
7. **La unión cuenta–ficha** es una columna de la tarjeta: `loyalty_cards.patient_account_id`.
   - Una cuenta se une como máximo a una ficha por negocio (índice único).
   - Sólo se une desde «Escanear», eligiendo entre las citas de hoy que el usuario puede ver (`agendaScope`).
8. **El nivel es el número de tarjeta:** 1 Clásica, 2 Plata, 3 o más Oro. No se guarda aparte.
9. **«Bloqueada» y «Vencida» se calculan.** Se guardan Disponible, Canjeada y Anulada; el vencimiento es una fecha en
   la recompensa.
10. **El código de la recompensa:** 6 caracteres de un alfabeto sin confusiones (sin 0, O, 1 ni I), como `K7Q-3MD`.
    Es único por negocio y se genera con reintento.
11. **El canje** es una sola orden: `update … where status = 'available' and (expires_at is null or expires_at > now())
    returning`. Si va en una cita sin pagar (`paid_at is null`), en la misma transacción baja su precio según el tipo,
    con `greatest(0, …)`. La actividad registra el canje y el cambio de «Precio», como «Editar».
12. **Los permisos nuevos,** en `permissions.ts` (compartido):
    - `loyalty.manage` (propietario y administrador) para el programa, los beneficios y «Fidelización»;
    - `loyalty.redeem` (propietario, administrador y Recepción) para canjear.

    «Escanear» usa `appointments.manage` con `agendaScope`, como la ficha.
13. **Los emails:**
    - `loyalty_reward`, nivel «paciente», con su copia aparte al profesional por el mecanismo de siempre
      (`appointment_copy`);
    - el email de seguimiento (`appointment_completed`) suma una línea con el progreso si la tarjeta está encendida;
    - el asunto no lleva el servicio: «Ganaste un premio en [negocio]».
14. **El enlace para cambiar la contraseña:**
    - `patient_password_links`: el token guardado con hash, de un solo uso y que vence en 24 h;
    - el panel lo genera y abre `wa.me` hacia el teléfono de la cuenta;
    - al usarlo, la cuenta guarda qué negocio y cuándo, para el aviso.
15. **Las redes:** tres columnas en `businesses`. Se acepta el enlace o `@usuario`, y se guarda como enlace del dominio
    de cada red (facebook.com, instagram.com, tiktok.com). Si no es de ese dominio, se rechaza.

## Diseño

1. **La migración** (`back/db/migrations/059_tarjeta_de_fidelizacion.sql`). Todas las tablas nuevas, con RLS y sin
   políticas:
   - **En `businesses`:** `facebook_url`, `instagram_url` y `tiktok_url` (`text not null default ''`).
   - **`loyalty_programs`:** una por negocio.
     - `business_id` (clave);
     - `enabled_at` (vacío = apagada; si no, desde cuándo cuenta);
     - `name`, `description`;
     - `stamp_icon`, con un `check` sobre la lista;
     - `after_last` (`keep` | `restart`);
     - `updated_at`.
   - **`loyalty_benefits`:**
     - `id`, `business_id`;
     - `name`, `description`;
     - `visits_required` (1 a 100);
     - `kind` (`percent` | `fixed` | `free_appointment` | `free_service` | `custom`) y `value` (`numeric(10,2)`, con
       un `check` según el tipo);
     - `service_id` (`on delete set null`);
     - `conditions`, `valid_days` (vacío = no vence);
     - `is_active`, `archived_at`;
     - un índice único `(business_id, visits_required) where archived_at is null`.
   - **`loyalty_cards`:** la tarjeta del paciente en el negocio.
     - `client_id` (clave, `on delete cascade`) y `business_id`;
     - `card_number` (1 en adelante);
     - `patient_account_id` (`on delete set null`), con un índice único `(business_id, patient_account_id)`;
     - `linked_at`, `linked_by`, `created_at`.
   - **`loyalty_stamps`:**
     - clave `(appointment_id, client_id)`, los dos con `on delete cascade`;
     - `business_id`, `card_number`, `counted_at`;
     - `voided_at`, `voided_by` (la corrección).
   - **`loyalty_rewards`:**
     - `id`, `business_id`, `client_id`;
     - `benefit_id` (`on delete restrict`: por eso un beneficio ganado se archiva);
     - `card_number`, y la copia del beneficio (`name`, `description`, `kind`, `value`, `service_name`, `conditions`,
       `visits_required`);
     - `code` (único por negocio);
     - `unlocked_at`, `expires_at`;
     - `status` (`available` | `redeemed` | `voided`);
     - `redeemed_at`, `redeemed_by`, `redeemed_appointment_id` (`on delete set null`);
     - `voided_at`, `voided_reason`;
     - un índice único `(client_id, benefit_id, card_number)`.
   - **`patient_accounts`:**
     - `id`, `name`;
     - `phone` (único, +593…);
     - `password_hash`;
     - `qr_token` (único);
     - `reset_by_business_id`, `reset_at`;
     - `created_at`, `updated_at`.
   - **`patient_sessions`:** como `sessions`: `token_hash` único, `account_id`, `expires_at` y `created_at`.
   - **`patient_password_links`:** `token_hash` (clave), `account_id`, `business_id`, `created_by`, `expires_at` y
     `used_at`.

2. **Lo compartido** (en front/, `npm run sync:shared` desde back/):
   - **los tipos:**
     - `LoyaltyProgram`, `LoyaltyBenefit`, `LoyaltyCard`, `LoyaltyReward` y `LoyaltySummary`;
     - `PatientAccount`, `PatientCard` (lo que ve el paciente) y `ScanResult`;
     - las redes en `Business` y en la página de reservas;
     - los `EmailType` nuevos;
   - **las validaciones:** `loyaltyProgramSchema`, `loyaltyBenefitSchema`, `patientSignupSchema`,
     `patientLoginSchema`, `socialLinksSchema` y `normalizePhone`;
   - **las constantes:**
     - `STAMP_ICONS`, `LOYALTY_LEVELS` (Clásica, Plata, Oro) y `BENEFIT_KINDS`, con sus textos;
     - `REWARD_CODE_ALPHABET`;
     - `PATIENT_RESET_HOURS` (24);
   - **los permisos:** `loyalty.manage` y `loyalty.redeem`;
   - **los emails:** `emailTemplates.loyaltyReward` y la línea de progreso en `appointmentCompleted`.

3. **La API del negocio** (`back/src/services/loyalty.ts`, nuevo, y sus rutas en `business-routes.ts`):
   - **El programa:**
     - `GET` y `PUT /businesses/:id/loyalty`;
     - al encenderlo se guarda `enabled_at`, y al apagarlo se vacía.
   - **Los beneficios:**
     - `GET` y `POST /businesses/:id/loyalty/benefits`, `PUT /businesses/:id/loyalty/benefits/:benefitId`;
     - `DELETE /businesses/:id/loyalty/benefits/:benefitId`: borra el beneficio, o lo archiva si alguien lo ganó.
   - **Los sellos** (`onAppointmentStatus`):
     - **al pasar a Atendida:** inserta los sellos de cada paciente de la cita, el principal y los de
       `appointment_clients`, con `on conflict do nothing`. Sólo si la tarjeta está encendida y la cita pasó a Atendida
       después de `enabled_at`. Después llama a `unlock()`.
     - **al dejar de estar Atendida:** anula los sellos y las recompensas disponibles que ya no alcanzan.
   - **`unlock()`:** cuenta los sellos vigentes de la tarjeta actual y crea las recompensas de los beneficios activos
     alcanzados, con `on conflict do nothing`. Con `restart`, si se alcanzó el último beneficio activo, `card_number + 1`.
     Pone en cola el email de cada recompensa nueva.
   - **La ficha:** `GET /businesses/:id/clients/:clientId/loyalty` (sellos, nivel, recompensas y si tiene cuenta).
   - **El canje:**
     - `POST /businesses/:id/loyalty/rewards/:rewardId/redeem`, con `{ appointmentId? }`;
     - `GET /businesses/:id/loyalty/rewards?code=…` para buscar por código.
   - **«Fidelización»:**
     - `GET /businesses/:id/loyalty/summary` (las cifras);
     - `GET …/loyalty/members` (el progreso, ordenable por «les falta poco»);
     - `GET …/loyalty/rewards`, filtrable por paciente, beneficio y estado.
   - **«Escanear»** (`back/src/services/loyalty-scan.ts`):
     - `POST /businesses/:id/scan`, con `{ token }`: si la cuenta no está unida en este negocio, devuelve el nombre y
       las citas de hoy que el usuario puede ver; si ya está unida, devuelve el paciente y su cita o citas de hoy;
     - `POST /businesses/:id/scan/link`, con `{ token, appointmentId, clientId }`;
     - `POST /businesses/:id/scan/complete`, con `{ token, appointmentId }`: pasa por `changeAppointmentStatus`.
   - **El enlace de contraseña:** `POST /businesses/:id/clients/:clientId/patient-reset-link`, sólo si la ficha tiene
     una cuenta unida. Devuelve el enlace y el teléfono para `wa.me`.
   - **Las redes:** en `businessService.update`, con la actividad (`BUSINESS_FIELDS`).

4. **La API del paciente** (`back/src/routes/patient-routes.ts` y `back/src/services/patient-accounts.ts`, nuevos):
   - **La cuenta:**
     - `POST /patient/signup` (CAPTCHA) y `POST /patient/login` (límite de intentos y CAPTCHA a partir del tercero);
     - `POST /patient/logout` y `GET /patient/me`.
   - **La tarjeta:** `GET /patient/cards` devuelve, por cada negocio unido con la tarjeta encendida:
     - el negocio, su logo, sus colores y sus redes;
     - el programa y el nivel;
     - los sellos de la tarjeta actual, las casillas y los beneficios;
     - las recompensas, con su código y su estado;
     - las visitas (fecha y servicio).
   - **Los ajustes:**
     - `POST /patient/qr` (QR nuevo);
     - `PUT /patient/password`;
     - `DELETE /patient/account`.
   - **El enlace de contraseña:** `GET` y `POST /patient/reset/:token` (sin sesión).
   - **El QR sin sesión:** `GET /public/qr/:token` sólo dice si existe, para la página `/q/:token`; no devuelve
     ningún dato.
   - **Lo general:** `smallJsonBody` y `no-store` en `/api/patient`, y las sesiones vencidas se borran en el mismo
     cron que las del equipo.

5. **Lo que se toca:**
   - **las citas:** `business-data-service.ts`, con las llamadas a `onAppointmentStatus` (decisión 2);
   - **las fichas:** al unir dos (la revisión «Por verificar»), las tarjetas, los sellos y las recompensas pasan a la
     ficha que queda;
   - **las tablas:** `TABLE_INFO` (`database-stats`), las `TABLES` del seed y los `leftovers` de
     `delete-business.test.mjs`;
   - **los emails:** `EMAIL_PRIORITY` y las etiquetas del cron;
   - **la actividad:** `BUSINESS_FIELDS` (redes), y `LOYALTY_FIELDS` y `BENEFIT_FIELDS` nuevos.

6. **El front:**
   - **El menú:** «Fidelización» (`nav-items.ts`, `loyalty.manage`).
   - **La página `front/src/pages/dashboard/loyalty-page.tsx`,** con lo de `front/src/features/loyalty/`:
     - «Programa»: el interruptor, el nombre, la descripción, el sello y qué pasa al terminar;
     - «Beneficios»: la lista, «+ Agregar beneficio», editar, activar o desactivar y eliminar o archivar;
     - «Pacientes» y «Recompensas», con los filtros y la búsqueda por código;
     - las cifras arriba.
   - **La ficha del paciente:** el bloque «Tarjeta de fidelización», con «Canjear» y «Enlace para cambiar la
     contraseña».
   - **La cita:** «Tiene 1 premio disponible» y «Canjear en esta cita».
   - **«Escanear»** en la Agenda y en Inicio: `scan-dialog.tsx`, con la cámara, la confirmación, la unión y «Marcar
     como atendida». También la ruta `/dashboard/escanear?qr=…`, a la que lleva `/q/:token`.
   - **La app del paciente** (`front/src/pages/patient/`), con los colores de cada negocio (`BrandThemeProvider`):
     - `/mi-tarjeta/entrar` y `/mi-tarjeta/crear`;
     - `/mi-tarjeta`: la tarjeta como la imagen de referencia, con el diseño que elija el dueño;
     - «Mis premios»;
     - el QR (un diálogo a pantalla completa, con el brillo de la pantalla al máximo si el navegador lo permite);
     - el engranaje: la contraseña, el QR nuevo, salir y eliminar la cuenta;
     - `/mi-tarjeta/clave/:token`;
     - `/q/:token`.

     Todas con `noindex` en `vercel.json` y las rutas limpias en los avisos de errores.
   - **Las redes:** en Configuración → Negocio y en la página de reservas (`SocialLinks`, sólo las que hay).
   - **Los textos:**
     - `landing-constants.ts` («Tus pacientes reservan sin crear cuenta»);
     - `auth-showcase.tsx`;
     - `login-page.tsx` (más «¿Tienes tarjeta de fidelización? Entra aquí»);
     - `privacy-page.tsx`: la cuenta del paciente, sus datos y cómo eliminarla.
   - **`check:loyalty`:** las funciones puras:
     - las casillas;
     - el próximo premio;
     - el nivel;
     - el precio con el canje;
     - `normalizePhone`;
     - leer el token del QR;
     - los enlaces de las redes.

7. **Las vistas previas antes de programar la tarjeta del paciente:** 2 o 3 diseños sobre la imagen de referencia, con
   los colores de un negocio de ejemplo, en claro y en oscuro, a 390 px.

8. **La constitución, 1.50.0, en los dos repos** (principio III):
   - la cuenta del paciente es opcional y va aparte de la del equipo;
   - se une a la ficha sólo con el escaneo en persona;
   - cómo se suman y se quitan los sellos;
   - el canje ajusta el precio;
   - las redes del negocio;
   - «Tus pacientes no crean cuenta» pasa a «reservan sin crear cuenta».

**No se hace:**
- puntos por montos;
- el Wallet;
- la API de WhatsApp;
- las citas en la cuenta del paciente;
- el informe mensual y la descarga de datos;
- la beta.

## Orden de trabajo

1. **La base y las reglas (Historias 1 y 2):**
   - la migración;
   - lo compartido;
   - `loyalty.ts` con los sellos, el desbloqueo, la corrección y los ciclos;
   - las pruebas 1 a 9 y 12 a 15 del pedido;
   - «Fidelización», con el programa y los beneficios.
2. **La cuenta y el QR (Historias 3 y 4):**
   - `patient-accounts.ts` y las rutas del paciente;
   - «Escanear», con la unión y el marcado;
   - las pruebas de la cuenta y la prueba 16;
   - la app del paciente, con el diseño elegido.
3. **El canje y los avisos (Historias 5 y 6):**
   - el canje con el precio (pruebas 10 y 11);
   - los emails;
   - el enlace de contraseña.
4. **Las cifras y las redes (Historias 7 y 8):**
   - el resumen y los filtros;
   - las redes en Configuración y en la página de reservas;
   - los textos de «sin cuenta» y /privacidad.
5. **El cierre:**
   - la constitución;
   - el recorrido con Playwright a 390 y 1440, en claro y en oscuro;
   - `npm test` completo y todas las `check:*`;
   - el reporte.

## Comprobación contra la constitución

| Principio | ¿Cumple? | Cómo |
|---|---|---|
| I. Español | Sí | Textos, emails y documentación en español |
| II. Privacidad | Sí | La cuenta no ve nada hasta el escaneo en persona (se mantiene la regla de la spec 050); nada de la historia clínica en la tarjeta ni en los emails; asunto sin el servicio; ntfy y los registros sin datos del paciente; el paciente puede eliminar su cuenta |
| III. Decisiones del dueño | Sí, con un cambio aprobado | «Sin cuenta» pasa a «la cuenta es opcional» (decisión del 2026-11-16, va a la constitución); sin la API de WhatsApp ni la beta |
| Auditar todo | Sí | El programa, los beneficios, la unión, el marcado con QR, el canje (con el precio), el enlace de contraseña y las redes; sumar sellos y desbloquear, no (son automáticos) |
| IV. Pruebas en local | Sí | `tests/loyalty.test.ts` y `tests/patient-accounts.test.ts` con base temporal; `check:loyalty`; el recorrido en local |
| V. Código compartido | Sí | Tipos, validaciones, permisos, constantes y emails en front/ con `sync:shared` |
| VI. Barato de operar | Sí | Sin servicios nuevos: el lector de QR va en el navegador y se carga sólo en «Escanear»; sin cron nuevo (el vencimiento se calcula) |
| VII. Diseño | Sí | Colores de cada negocio en la tarjeta, una gama en el panel, claro y oscuro, 390 px; vistas previas antes de programar la tarjeta |
| Seguridad | Sí | Sesiones aparte; contraseña con bcrypt 12, límite de intentos y CAPTCHA; tokens largos y al azar; el enlace de contraseña con hash, de un solo uso y por 24 h; RLS en todas las tablas nuevas |

## Pruebas

- **`back/tests/loyalty.test.ts`.** Las 16 del pedido:
  1. varios beneficios;
  2. editarlos;
  3. activarlos y desactivarlos;
  4. borrar uno sin historial;
  5. archivar uno ganado;
  6. sumar sellos por cada camino (la ficha, «Por cerrar», «Editar» y el QR);
  7. que una cita no cuente dos veces;
  8. varios hitos a la vez;
  9. sin duplicados, también con dos cambios a la vez;
  10. canjear y bajar el precio;
  11. que no se canjee dos veces;
  12. conservar lo ganado;
  13. editar sin cambiar lo ganado;
  14. los ciclos y los niveles;
  15. el aislamiento entre negocios;
  16. los permisos (Recepción canjea pero no configura; el Profesional ni configura ni canjea).

  Y además:
  - sólo cuenta desde que se enciende;
  - la corrección quita el sello y anula;
  - en una cita en grupo suma cada persona;
  - el paciente desactivado no suma;
  - el vencimiento;
  - unir dos fichas.
- **`back/tests/patient-accounts.test.ts`:**
  - la cuenta con el teléfono en sus dos formas;
  - el límite de intentos;
  - que una sesión de paciente no entra a `/businesses`;
  - que una cuenta nueva con el teléfono de otro no ve nada;
  - la unión sólo por escaneo y dentro de las citas que el usuario puede ver;
  - el marcado con QR;
  - el QR nuevo invalida el anterior;
  - el enlace de contraseña: un uso, 24 h, el aviso y la actividad;
  - eliminar la cuenta.
- **`front/scripts/check-loyalty.ts`:** las funciones puras del diseño (punto 6).
- **El recorrido local con Playwright:**
  - el programa y un beneficio;
  - la cuenta del paciente;
  - «Escanear», con una imagen de QR en lugar de la cámara;
  - el sello, el premio y el canje;
  - la tarjeta en el celular, en claro y en oscuro.

## Cómo publicarlo (cuando el dueño lo pida)

1. Aplicar la migración 058 si todavía no está, y después la 059 en producción.
2. Abrir el PR de `dev` a `main` del backend y después el del front.
3. Todo sale apagado: cada negocio enciende su tarjeta en «Fidelización».
