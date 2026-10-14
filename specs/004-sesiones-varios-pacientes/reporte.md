# Reporte final: Sesiones con varios pacientes (fase 1, desde el panel)

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Publicada (2026-10-13, PR #17 del backend y #16 del front) · **Fecha**: 2026-10-13

**Repos**: los dos (agenda-backend y agenda-front) y la beta · **Migración**: Sí: `032_appointment_clients.sql`

## Resumen

En los negocios que el super admin habilite, una cita puede tener hasta 3 pacientes, por ejemplo
una pareja.
- **Avisos:** cada uno recibe sus emails y su recordatorio con su nombre. El aviso de WhatsApp
  trae un botón por persona. Al profesional le llega una sola copia.
- **Agenda:** la sesión se ve como un solo bloque con los nombres y la hora se ocupa una vez.
- **Fichas y reportes:** la sesión aparece en el historial de cada paciente y en los reportes por
  paciente. Cuenta como una cita y un solo ingreso.
- **El interruptor** viene apagado. Sólo lo cambia el super admin, en la ficha del negocio.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H0 – El super admin decide qué negocios lo tienen | P1 | Hecha | Tarjeta «Citas con varios pacientes» en la ficha del negocio (`/admin`) |
| H1 – Agendar una sesión de pareja y que les llegue a los dos | P1 | Hecha | «Otros pacientes» en el formulario de cita |
| H2 – Cualquier cambio de la cita les llega a todos | P1 | Hecha | Incluye agregar y quitar pacientes, y el recordatorio por paciente |
| H3 – Ver la sesión como una sola cita | P1 | Hecha | Agenda (día, semana, mes y lista), inicio y detalle |
| H4 – Avisar por WhatsApp a cada uno | P2 | Hecha | Un mensaje y un botón por paciente |
| H5 – Ficha, historia clínica y reportes de cada paciente | P2 | Hecha | Lo cobrado, sólo en el paciente principal |
| H6 – Un profesional que sólo ve a sus pacientes | P2 | Hecha | |

## Comprobación

Todo en local, con la base y la API de prueba y los datos de demostración.

**Fuentes de las pruebas:**
- **Prueba automática:** `tests/multi-client-appointments.test.ts` del backend, con 59
  comprobaciones.
- **Recorridos con Playwright:** los dos primeros, contra el panel local; el tercero, contra la beta.
  1. `varios-pacientes.mjs`: 26 comprobaciones.
  2. `varios-pacientes-inicio-reportes.mjs`: inicio y reportes.
  3. `varios-pacientes-beta.mjs`: 54 comprobaciones.

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-000 – Interruptor por negocio, apagado y sólo del super admin | Cumple | Prueba automática: viene apagado; el propietario no lo cambia (PATCH ignorado, 403 en la ruta del super admin); queda una vez en la actividad; no sale en el perfil público. En el navegador, el super admin lo enciende desde la ficha. |
| RF-001 – Hasta 3 pacientes por cita | Cumple | Prueba: un cuarto paciente da 400 «como máximo 3». Navegador: con 3 ya no se ofrece «Agregar otro paciente». |
| RF-001b – Sin habilitar no se agrega; al apagarlo se conservan y sólo se quitan | Cumple | Prueba: 400 «no tiene habilitadas…», se conservan, quitar sí. Navegador: con el interruptor apagado el formulario sólo deja quitar y una cita nueva no muestra «Otros pacientes». |
| RF-002 – Agregar y quitar desde el formulario | Cumple | Navegador: agregar de la lista, quitar y no ofrecer al principal. A 390 px, crear uno nuevo con el botón del espacio (`varios-pacientes-nuevo.mjs`): queda como paciente 2 y el principal no cambia. |
| RF-003 – Cada paciente recibe su email, con su saludo y sin datos de los demás; uno por dirección | Cumple | Prueba: 3 confirmaciones, cada cuerpo con su nombre y sin el nombre ni el email de los otros; cambio de hora a los 3; correo compartido, un email. Navegador: bandeja con un email por paciente. |
| RF-004 – Copia al profesional, aviso de cita nueva y agenda del día, una vez y con todos los nombres | Cumple | Prueba: una copia con «Ana Pareja, Carlos Pareja y Luis Pareja»; aviso de cita nueva y fila de la agenda del día con «Nora Sinemail y Omar Sinemail». |
| RF-005 – Al agregar, sólo el nuevo recibe; al quitar, sólo el quitado recibe la cancelación | Cumple | Prueba: quitar a Luis le manda sólo a él la cancelación; agregar a Diana le manda sólo a ella la confirmación. |
| RF-006 – Un recordatorio por paciente | Cumple | Prueba: 3 recordatorios y una sola vez cada uno. El del principal conserva la clave de siempre. Al quitar a una paciente, su recordatorio en cola deja de valer. |
| RF-007 – La protección contra cruces se mantiene; la hora se ocupa una vez | Cumple | Prueba: otra cita a la misma hora en la misma agenda da 409. La página de reservas toma las horas ocupadas de las citas, que no cambian. |
| RF-008 – Agenda, inicio y detalle con todos los pacientes | Cumple | Navegador: bloque «Marco Jiménez y Patricia Lara» en la semana, inicio con «Roberto Andrade y Silvia Mora» y detalle con «Pacientes» y la ficha de cada uno. |
| RF-009 – WhatsApp: un botón por paciente con teléfono | Cumple | Navegador: «Avísales por WhatsApp», 2 botones, «Hola Marco…» y «Hola Patricia…». |
| RF-010 – La sesión en el historial de cada uno; historia clínica individual | Cumple | Prueba: `?clientId=` del adicional la incluye; una evolución puede vincularse a la sesión, y no la de alguien que ya no está. Navegador: la sesión en la ficha de Patricia. |
| RF-011 – Reportes: una cita y un ingreso; por paciente, cuenta para cada uno | Cumple | Navegador, reporte de un día con sólo esa sesión: «Citas del periodo» 1; «Los que más vienen» Marco 1 cita · $20 y Patricia 1 cita · $0. Prueba: actividad de Carlos con 1 atendida y $0, y la de Ana con $20. |
| RF-012 – «Sólo sus pacientes»: el profesional ve a todos los de sus citas | Cumple | Prueba: Valeria no ve a Yolanda; tras la sesión en su agenda, sí (lista y ficha); a Carlos (otra agenda) no. |
| RF-013 – Las citas existentes siguen igual | Cumple | Prueba: las citas demo traen `extraClientIds: []` y sólo las de la prueba tienen otros pacientes. La migración se aplicó sobre datos existentes en local. |
| RF-014 – La reserva online no cambia | Cumple | Sólo se quitó el campo del perfil público; las pruebas de reserva pública siguen pasando. |
| RF-015 – La beta tiene lo mismo | Cumple | Recorrido en la beta con 54 ✓: interruptor, formulario, agenda, detalle, WhatsApp, bandeja simulada, recordatorios, alcance y 390 px. Diferencias de la beta en «Cambios respecto al plan». |
| RF-016 – Altas y bajas de pacientes en la actividad, sin datos de contacto | Cumple | Prueba: «Creó la cita de Ana Pareja, Carlos Pareja y Luis Pareja (…)». El diff de la cita incluye «Otros pacientes», sólo con nombres. |
| CE-001 – Agregar a un paciente existente en menos de 30 s y 3 acciones | Cumple | En el recorrido: «Agregar otro paciente», abrir el buscador y elegir. Son 3 acciones. |
| CE-002 – El 100 % de los pacientes con email recibe cada aviso una vez, con una copia | Cumple | Ver RF-003 a RF-006. |
| CE-003 – Nada cuenta doble; en reportes por paciente cuenta para cada uno | Cumple | Ver RF-011. |
| CE-004 – Ningún choque de horario tiene éxito | Cumple | Ver RF-007. |
| CE-005 – Tras la migración, las citas existentes siguen igual | Cumple | Ver RF-013. |
| CE-006 – Pruebas automáticas y 390 px | Cumple, con una excepción anterior a esta función | La prueba de `cron` ya fallaba antes de empezar (ver «Pendientes y riesgos»). El detalle y el formulario a 390 px no tienen desplazamiento horizontal, en el front y en la beta. |
| CE-007 – 0 % de intentos de agregar sin permiso o un cuarto paciente | Cumple | Ver RF-001 y RF-001b. |

**Pruebas automáticas**:
- **agenda-backend:** `npm run typecheck` sin errores. `npm test` pasa 39 de 40 suites, incluida
  la nueva; falla sólo `cron.test.mjs`, que ya fallaba antes de empezar, con el mismo error.
- **agenda-front:** `npm run build` y `npm run lint` sin errores ni avisos.
- **Beta:** `npm run build` y `npm run lint` sin errores ni avisos.

## Cambios respecto al plan

- **Al cambiar el paciente principal de una cita ahora se avisa.** Vale para todas las citas,
  también las de un solo paciente. El nuevo recibe el email de una cita nueva y el anterior, la
  cancelación. Es la misma regla de agregar y quitar pacientes. Antes, cambiar el paciente no
  avisaba a nadie.
- **El registro de WhatsApp dice a qué paciente se escribió.** `POST …/whatsapp-notice` acepta un
  `clientId` opcional (ruta, repositorio del front y la beta). Así, con varios pacientes, la
  actividad nombra a quien se le abrió WhatsApp.
- **Red de seguridad extra en la base.** Además de la del plan, la migración tiene un trigger que
  quita al paciente principal de los adicionales si pasa a ser el principal.
- **Componentes del inicio.** Las listas reciben la cita entera para nombrar a todos sus pacientes
  (antes recibían sólo el id del paciente).
- **La beta difiere en tres puntos**, por cómo está hecha:
  - no envía copia al profesional (no tiene ese tipo de email);
  - su actividad no guarda el detalle antes → después;
  - sus recordatorios no se repiten al reprogramar, como ya pasaba antes.

  El traspaso a la beta lo hizo un agente siguiendo el diff del front. Después volví a compilar,
  pasar el lint y revisar sus capturas.

## Pendientes y riesgos

- **Prueba `cron.test.mjs` (anterior a esta función).** Espera primero el aviso de «faltan las
  credenciales de Gmail», pero ahora el primer aviso por ntfy es el de una reserva por la página.
  Viene del cambio de los avisos de reservas por el cron (commit f56eb10). Es un arreglo pequeño y
  aparte, en la prueba o en el orden de los avisos.
- **Fuera de esta fase, según la spec:**
  - la asistencia y el estado son de la sesión entera, sin marcar que sólo uno faltó;
  - lo cobrado se atribuye al paciente principal;
  - la fase 2 sería un servicio «en pareja» en la reserva online.
- **Topes de emails:** cada email a un paciente cuenta para el tope diario a terceros, como
  siempre.
- **La migración 032 tiene que aplicarse antes de publicar el backend.** Sin ella, la API falla al
  leer las citas.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 09173a2 | Spec 004: citas con varios pacientes (sesiones de pareja), fase 1 desde el panel |
| agenda-front | 4f15ea6 | Spec 004: citas con varios pacientes (sesiones de pareja), fase 1 desde el panel |
| agenda-backend | (este commit) | Spec 004: reporte final y pruebas de los avisos al profesional |

La beta no tiene git. Su respaldo previo es
`agenda-beta-respaldo-antes-de-varios-pacientes-2026-10-13.tar.gz`.

## Cómo publicarlo

1. **Migración primero.** El dueño del producto la aplica en agenda-backend antes de publicar el
   backend:
   ```
   npm run db:migrate
   ```
2. **PR `dev` → `main` de agenda-backend**, que avisa de la migración 032. Después, el **PR `dev`
   → `main` de agenda-front**.
3. **Después de publicar:**
   - comprobar que los dos despliegues de Vercel queden «Ready»;
   - el super admin activa «Citas con varios pacientes» sólo en el negocio que lo pidió;
   - ese negocio crea una sesión de pareja de prueba y revisa que lleguen los emails.

## Texto para el PR

**agenda-backend:**

Citas con varios pacientes (spec 004, sesiones de pareja):
- hasta 3 pacientes por cita, sólo en los negocios que habilite el super admin;
- cada paciente recibe sus emails y su recordatorio;
- copia al profesional una vez;
- la hora se ocupa una vez.

**Migración 032** (`npm run db:migrate` antes de publicar).

Reporte: [specs/004-sesiones-varios-pacientes/reporte.md](https://github.com/jhordan-huera/agenda-backend/blob/main/specs/004-sesiones-varios-pacientes/reporte.md)

**agenda-front:**

Citas con varios pacientes (spec 004):
- «Otros pacientes» en el formulario de cita;
- un solo bloque con los nombres en la agenda;
- WhatsApp por paciente;
- fichas y reportes por paciente;
- interruptor del super admin.

Requiere el backend con la migración 032.

Reporte: [specs/004-sesiones-varios-pacientes/reporte.md](https://github.com/jhordan-huera/agenda-backend/blob/main/specs/004-sesiones-varios-pacientes/reporte.md)
