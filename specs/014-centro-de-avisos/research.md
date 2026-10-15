# Investigación: Centro de avisos en el panel

**Spec**: [spec.md](./spec.md) · **Fecha**: 2026-10-15

Decisiones R1–R14. Cada una dice qué se eligió, por qué y qué se descartó.

## R1. Dónde se guardan: un aviso por suceso y el leído por persona

- **Decisión:** tres tablas nuevas (migración 041, ver [data-model.md](./data-model.md)):
  - `panel_notices`: una fila por suceso («llegó una reserva», «el paciente confirmó»…), del negocio, o
    de la plataforma si es del super admin;
  - `panel_notice_reads`: qué avisos leyó cada persona;
  - `panel_notice_state`: cuándo pulsó cada persona «Marcar todo como leído».
- **Por qué:**
  - Quién ve cada aviso se decide **al leer**, con el rol y la agenda de hoy (R2). Así se cumplen solos
    varios casos límite de la spec:
    - quien cambia de rol ve sólo lo de su rol nuevo;
    - quien deja el equipo ya no ve nada;
    - el propietario anterior deja de ver;
    - una cita movida a otra agenda la ve el profesional nuevo.
  - Una reserva en una clínica con 8 personas es una sola fila, no ocho.
  - «Marcar todo como leído» guarda una hora, no una fila por aviso.
- **Descartado:**
  - **Una fila por destinatario,** decidida al crear el aviso: no sigue el «rol de hoy», hay que
    borrarla a mano al cambiar el equipo y multiplica las filas.
  - **Reutilizar `push_messages`:** es una cola por aparato que se borra a los 7 días, y sólo existe si
    hay aparatos activados. La campana no debe depender de eso (RF-003).

## R2. Quién ve qué: la tabla de la spec, al leer

- **Decisión:** la consulta de la campana filtra con lo que la persona es **hoy**:
  - su rol en `business_users`;
  - si es `businesses.owner_id`;
  - su agenda: el profesional activo con `user_id` igual al suyo, sea cual sea su rol;
  - la agenda **de hoy** de la cita.

  | Aviso | Lo ve |
  |---|---|
  | `booking`, `receipt`, `patient_confirm`, `patient_cancel` | El propietario, los administradores y Recepción (todas las agendas); el rol Profesional, si la cita es de su agenda |
  | `new_appointment` | Quien tiene la agenda de la cita (también el propietario) |
  | `unclosed` | El propietario (todas) y quien tiene la agenda de la cita |
  | `evening_summary` | El del negocio (`professional_id` vacío), el propietario; el de una agenda, quien la tiene, si no es el propietario |
  | Los cuatro del super admin | Cada super admin (`platform_role = 'super_admin'`) |

  Además:
  - **Quien lo provocó no lo ve** (`actor_user_id`). Sólo pasa con «Cita nueva en tu agenda».
  - **Sólo desde que entró al equipo** (`business_users.created_at`): quien entra hoy no recibe 30 días
    de avisos viejos de golpe.
  - **Sólo los últimos 30 días** (R9).
- **Por qué:** es la tabla «Qué le llega a cada uno» que aprobó el dueño. El rol Profesional sigue
  viendo sólo su agenda, como en `agenda-scope.ts`, también con «sólo sus pacientes»: la cita de su
  agenda es suya.
- **Una sola regla, dos copias:** la tabla va como constante compartida (`NOTICE_AUDIENCE` en
  `src/lib/constants/notices.ts`, copiada con `sync:shared`). La consulta SQL del backend y el
  repositorio de la beta la siguen, y la prueba de los cuatro roles compara las dos con la constante.

## R3. El texto: el mismo del celular, con el nombre completo y armado al leer

- **Decisión:**
  - **Los avisos de citas** (los siete del negocio) no guardan el texto. Se arman al leer, con los datos
    de hoy de la cita y con los **mismos constructores** que los del celular:
    - pasan a `src/lib/notices.ts` (compartido): `describeNotice(kind, data, { names, now })`;
    - el celular sigue con `names: "short"` («Juan P.»);
    - la campana y la beta usan `names: "full"` («Juan Pérez», decisión 4).
  - **Los del super admin** no tienen pacientes, y su texto ya armado (el que hoy va al celular) se
    guarda en la fila.
- **Por qué:**
  - **Fecha correcta:** «Mañana 16:00» se calcula al mirar la lista, no se queda viejo («Mañana» de
    ayer es «Hoy»).
  - **Datos al día:** si se cambia el nombre del paciente o se quita a alguien de una sesión, la campana
    lo refleja.
  - **Pacientes borrados:** al borrar un paciente se borran sus citas en cascada, y con ellas sus
    avisos. Ningún texto guardado queda con su nombre.
  - **Una sola fuente** para los textos del celular, la campana y la beta (principio V).
- **Descartado:**
  - **Guardar el texto armado:** se queda viejo y guarda el nombre del paciente en una tabla más, que
    habría que limpiar al borrarlo.
  - **Copiar los constructores en la beta:** dos versiones que divergen.

## R4. Dónde se crean: en los mismos puntos que los del celular

- **Decisión:** cada función de `push-notices.ts` (spec 013) añade también su aviso del panel, haya o
  no aparatos con avisos activados:

  | Función | Aviso |
  |---|---|
  | `notifyOnlineBooking` (reserva online, también en pareja) | `booking` |
  | `notifyReceipt` (comprobante) | `receipt` |
  | `notifyPatientConfirmed` («Confirmo que voy», la primera vez, con quién) | `patient_confirm` |
  | `notifyPatientCancel` (cancelación desde el email) | `patient_cancel` |
  | `notifyNewAppointment` y `notifyNewSeries` (una por serie) | `new_appointment`, con quien la agendó |
  | `notifyNewBusiness` y `notifyPlanRequest` | los del super admin |
  | `queueUnclosedNotices`, `queueEveningSummaries`, `queueAccountSecurityNotices` y `queueLoginAttackNotice` (cron) | los del cron |

  El panel tiene su propio punto de guardado (`aviso_panel`), como `guardedPush`. Si falla (por
  ejemplo, sin la migración 041), se anota en el registro sin datos y la reserva, la cita, los emails y
  el celular siguen igual (RF-011).
- **«Cita nueva en tu agenda»** va a cualquier agenda con usuario, no sólo a la del propietario como
  en el celular. Es la decisión 1: al profesional de esa agenda.
- **Por qué:** los puntos ya están probados en la spec 013 (los reintentos, el doble toque y la serie
  no repiten). Añadir ahí la otra salida evita buscar de nuevo cada suceso.

## R5. Los del cron, para todos los negocios

- **Decisión:**
  - **Hoy** `queueUnclosedNotices` y `queueEveningSummaries` sólo miran los negocios cuyo propietario
    tiene aparatos. **Ahora** miran todos los negocios activos:
    - el aviso del panel sale siempre;
    - el del celular, como hoy, sólo si hay aparatos.
  - **El resumen de las 8** se guarda:
    - una vez para el negocio (el del propietario);
    - una vez por cada agenda con usuario que no sea el propietario, con sus propias citas sin cerrar
      (si tiene alguna).
  - **Claves para no repetir** (`dedupe_key` única), como en la 013:
    - `unclosed:<cita>:<fin>`;
    - `resumen:<negocio>:<fecha>` y `resumen:<agenda>:<fecha>`;
    - `cuenta:<registro>`;
    - `intentos:<cuenta>:<hora>`.
- **Por qué:** la campana no depende del celular (RF-003). El cron corre en GitHub Actions, no en
  Vercel: mirar todos los negocios no gasta la CPU de Vercel.

## R6. El contador y el refresco: barato y sin conexión abierta

- **Decisión:**
  - **`GET …/notices/unread`** devuelve sólo `{ unread }`: una consulta con índices y sin armar textos.
  - **El front** la pide:
    - al abrir el panel;
    - al volver a la pestaña;
    - cada 3 minutos, sólo con la pestaña visible;
    - al instante cuando el service worker recibe un aviso del celular en ese navegador (R11).
  - **La lista** (con textos) se pide sólo al abrir la campana o la página.
- **Por qué:** la CPU de Vercel Hobby tiene un tope de 4 h al mes. Una cuenta generosa: 20 pestañas
  abiertas 10 h al día, con 20 consultas por hora cada una, dan unas 120.000 consultas al mes. A unos
  5 ms de CPU cada una son unos 10 minutos al mes. La spec pide menos de 3 minutos para ver un aviso
  (CE-001), y con el celular, menos de 30 segundos.
- **Descartado:** WebSocket o Server-Sent Events (Vercel no mantiene conexiones abiertas en Hobby) y
  pedir el contador cada pocos segundos.

## R7. Leído y «Marcar todo como leído»

- **Decisión:**
  - **Leído:** tocar un aviso lo marca (`POST …/notices/:id/read`) y abre su pantalla.
  - **«Marcar todo como leído»** guarda la hora en `panel_notice_state`. Desde ahí, todo lo anterior
    cuenta como leído y lo que llegue después, no.
  - **Nada de esto va a la actividad** (decisión 5), ni la creación de los avisos (es automática: lo que
    los provoca ya queda registrado).
- **Por qué:** cada persona lleva el suyo (RF-005) y «Marcar todo» no escribe cientos de filas.

## R8. Las rutas y el modo soporte

- **Decisión:** las rutas del negocio cuelgan de `/api/businesses/:businessId/notices` y las del
  super admin de `/api/admin/notices` (ver [contracts/api.md](./contracts/api.md)).
  - **Las del negocio** sirven a cualquier rol del equipo (`authorize` sin permiso especial).
  - **El super admin en modo soporte** recibe 403 «La campana es del equipo del negocio»: no ve ni marca
    lo del equipo (caso límite). El front no le muestra la campana del negocio.
  - **Las de /admin** piden la verificación en dos pasos, como el resto de /admin.
- **Por qué:** sigue el patrón de las demás rutas del panel y de /admin.

## R9. 30 días y el borrado

- **Decisión:** el cron borra los avisos de más de 30 días (con sus lecturas, en cascada), en la misma
  limpieza que la cola del celular (`cleanupPush`). Las consultas filtran también los 30 días, por si
  el cron se atrasa.
- **Por qué:** RF-007 y la misma ventana que «Tu cita» (spec 010).

## R10. La campana en el front

- **Decisión:**
  - **Dónde:** `AppShell` (común a los dos paneles) recibe la campana:
    - en la computadora va arriba del menú lateral, junto al logo;
    - en el celular, a la derecha de la barra de arriba.
  - **Al tocarla** abre un `Popover` (ya existe en `components/ui`) con los últimos 20. En el celular
    ocupa el ancho de la pantalla menos los márgenes.
  - **La página** está en `/dashboard/notices` y `/admin/notices`:
    - los avisos agrupados por día («Hoy», «Ayer», «Mar 13 oct»);
    - «Sólo los no leídos», «Marcar todo como leído» y «Cargar más».
  - **El número** dice «9+» si son más de 9.
  - **Accesibilidad:** el botón se llama «Avisos, 3 sin leer» para el lector de pantalla.
  - **Si la ruta todavía no existe** (404, en la ventana de publicación), la campana no se muestra y no
    da error.
- **Por qué:** es el diseño que eligió el dueño (decisión 2). Usa los componentes de hoy.

## R11. Al instante con el celular activado

- **Decisión:** el `push` del service worker, además de mostrar el aviso, manda
  `{ type: "agenda360:aviso" }` a las ventanas abiertas. El panel escucha y vuelve a pedir el contador
  (y la lista, si está abierta).
- **Por qué:** quien tiene el celular activado (el propietario, el super admin) ve el número al momento
  sin esperar los 3 minutos (CE-001). Ya existe el mensaje `agenda360:abrir` para tocar un aviso, así
  que se sigue el mismo patrón.

## R12. La beta: la campana con avisos de prueba

- **Decisión:**
  - **Los mismos componentes** del front: la campana, la lista y la página, sobre el repositorio de
    prueba.
  - **Los avisos** se guardan en la base de `localStorage`, en una colección nueva que también reciben
    los navegadores que ya tienen datos guardados.
  - **Al cargar la demo** hay unos avisos de ejemplo de la clínica: reservas, una confirmación, una
    cancelación, un comprobante y una cita por cerrar, de hoy y de ayer.
  - **Cada reserva, «Confirmo que voy», cancelación desde «Tu cita», comprobante o cita del panel** que
    se haga en la demo suma su aviso, con la misma regla de quién lo ve (`NOTICE_AUDIENCE`) y los mismos
    textos (`describeNotice`).
  - La beta no tiene cron: las citas por cerrar y el resumen sólo salen en los avisos de ejemplo.
- **Por qué:** decisión 6, para las demostraciones de venta.

## R13. Los tipos

- **Decisión:** `NoticeKind` son los tipos de aviso del celular sin `test`:
  - del negocio: `booking`, `receipt`, `patient_confirm`, `patient_cancel`, `new_appointment`,
    `unclosed` y `evening_summary`;
  - de la plataforma: `new_business`, `plan_request`, `account_security` y `login_attack`.

  La migración los fija con un `check`.
- **Por qué:** un solo vocabulario para el celular y la campana.

## R14. Pruebas

- **Decisión:** una suite nueva, `tests/panel-notices.test.ts`, contra una base desechable:
  - **Los cuatro roles,** en la Clínica Dental Sonrisa: Ricardo (propietario), un administrador que
    añade la prueba, Elena (Recepción) y Valeria (Profesional). Más otra agenda sin usuario.
  - **Cada aviso de la tabla:** quién lo ve y quién no, comparado con `NOTICE_AUDIENCE`.
  - **Leído:** el contador, leer uno, «Marcar todo» y que cada persona lleva el suyo.
  - **Casos límite:**
    - modo soporte (403);
    - quien entra nuevo no ve lo viejo;
    - quien deja el equipo;
    - el cambio de rol;
    - una cita movida a otra agenda;
    - el paciente borrado;
    - los 30 días;
    - la tabla renombrada: la reserva responde 200 igual (RF-011).
  - **Textos:** nombre completo; nunca la cédula, el email, el teléfono ni las notas (CE-003).
  - **Del cron:** con la hora simulada, como en `push-notices`.
  - **Sin actividad:** leer no escribe en `audit_logs`.

  Además:
  - `push-notices` sigue igual: los textos del celular no cambian al moverlos a `describeNotice`.
  - El recorrido con Playwright del [quickstart.md](./quickstart.md), en el front y en la beta.
