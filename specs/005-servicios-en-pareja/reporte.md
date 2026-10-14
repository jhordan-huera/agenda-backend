# Reporte final: Servicios en pareja o familia y su reserva online (fase 2)

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada en dev · **Fecha**: 2026-10-13

**Repos**: los dos (agenda-backend y agenda-front) y la beta · **Migración**: Sí: `033_people_per_session.sql`

## Resumen

En los negocios que el super admin habilite, cada servicio puede ser para 1, 2 o 3 personas
(individual, pareja o familia).
- **Página de reservas:** en un servicio para 2 o 3 personas pide los datos de cada una. A cada
  persona la reconoce por su cédula, como siempre; si no existe, la registra como paciente nueva.
  Crea una sola cita pendiente con todas.
- **Emails:** cada persona recibe el suyo. El de la pareja dice quién reservó. Los datos de pago
  van sólo a quien reservó, y al profesional le llega una sola copia.
- **Panel:** al elegir un servicio en pareja en una cita, se abre solo el espacio del segundo
  paciente. Si falta, se avisa sin bloquear.
- **Privacidad:** se cerró un hueco. La otra persona de una reserva online no abre su ficha a un
  profesional con «sólo sus pacientes» hasta que el negocio gestione la cita.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – El negocio marca un servicio como «en pareja» | P1 | Hecha | «Personas por sesión» en el formulario de servicios, sólo con el interruptor |
| H2 – Reservar una sesión de pareja por la página | P1 | Hecha | Bloque «Datos de la otra persona», confirmación y pantalla final con todos |
| H3 – La página protege los datos de cada persona | P1 | Hecha | Incluye la marca de acceso pendiente por persona (migración 033) |
| H4 – Los límites de la página siguen funcionando | P1 | Hecha | Límite por persona, topes, reintento y ntfy |
| H5 – En el panel, el servicio en pareja abre los espacios solo | P2 | Hecha | Aviso ámbar que no bloquea |

## Comprobación

Todo en local, con PostgreSQL de prueba, la API local y los datos de demostración. Nunca en Vercel
ni contra Supabase.

**Fuentes de las pruebas:**
- **Prueba automática nueva:** `tests/couple-booking.test.ts` del backend, con 64 comprobaciones.
- **Recorrido con Playwright** `servicios-pareja.mjs`, contra el panel y la página de reservas
  locales, en escritorio y en celular (390 px): 32 comprobaciones.
- **Recorrido con Playwright en la beta** (`beta005/`): 77 comprobaciones.
- **Comprobación al revés de la privacidad:** se quitó a propósito la protección nueva (D7) y la
  prueba falló en los tres puntos de acceso de la profesional. Con la protección puesta, pasa.

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – Personas por sesión (1, 2 o 3; por defecto 1) | Cumple | Prueba: un servicio nuevo nace con 1, se guarda 2 o 3 y se rechaza 4. Recorrido: se crea «Terapia de pareja» para 2 |
| RF-002 – Sólo con el interruptor; sin él, individual y se conserva el dato | Cumple | Prueba: sin el interruptor se ignora el campo, la página ve 1 al apagarlo, el servicio conserva 2 y se rechaza la reserva con otra persona. Recorrido: FisioActiva (sin habilitar) no ve el campo; al apagarlo la página lo muestra individual |
| RF-003 – La página dice para cuántas personas y pide los datos de cada una | Cumple | Recorrido: «Para 2 personas» en la tarjeta y en el resumen, y el bloque «Datos de la otra persona». Prueba: sin la otra persona, 400 que pide recargar |
| RF-004 – Cada persona por su cédula, con la regla de hoy | Cumple | Prueba: existente + nueva, las dos existentes y las dos nuevas. Con la cédula de otra paciente y otro contacto, 403 «No pudimos confirmar los datos de Gina Escrita…», sin datos de su ficha |
| RF-005 – No dos veces la misma cédula | Cumple | Prueba: 400. Recorrido: el aviso aparece en la otra persona |
| RF-006 – Una sola cita pendiente; todo o nada | Cumple | Prueba: principal y otra paciente en la misma cita. Un rechazo (403, 409 o 429) no deja pacientes ni citas |
| RF-007 – Emails de cada persona; dice quién reservó; una copia | Cumple | Prueba: cada uno su solicitud, la de Bruno dice «Ana Existente reservó para ti» y no muestra el contacto de Ana, una copia con los dos nombres. Recorrido: 2 solicitudes y 1 copia |
| RF-008 – Datos de pago sólo al principal (también en el panel) | Cumple | Prueba: el «comprobante» sólo en el email de la principal, en la reserva y en una cita de pareja creada por recepción |
| RF-009 – Límites por persona, del día y del plan | Cumple | Prueba: Mateo (otra paciente de una sesión) no reserva otra ese día, ni como principal ni como la otra persona (409 con su nombre). Dos personas nuevas cuentan dos para el tope de pacientes nuevos (429 sin dejar nada). La sesión cuenta como una cita |
| RF-010 – Reintento en 30 minutos | Cumple | Prueba: la misma reserva de familia, con las personas en otro orden, devuelve la misma confirmación sin más citas, pacientes ni emails. Con otra persona, la hora sale ocupada |
| RF-011 – ntfy nombra a todos, a medias | Cumple | Prueba: el aviso trae a Ana («Ya era paciente») y a Bruno («Paciente nuevo»). `booking-alert.test.ts`: una línea por persona, a medias |
| RF-012 – «Recordar mis datos» sólo de quien reserva | Cumple | Recorrido: en el navegador quedan los de Ana, no los de Carlos. La casilla dice «(sólo los tuyos)» |
| RF-013 – La pantalla final nombra a todos | Cumple | Recorrido: «Sesión para Ana Pareja Existente y Carlos Pareja Nuevo» |
| RF-014 – Panel: espacios que se abren solos y un aviso que no bloquea | Cumple | Recorrido: al elegir «Terapia de pareja» aparece «Paciente 2» y el aviso ámbar, y «Crear cita» sigue activo |
| RF-015 – Email o teléfono compartidos | Cumple | Prueba: dos personas con el mismo email y teléfono se registran las dos y reciben una sola solicitud |
| RF-016 – Servicios individuales y negocios sin habilitar, como hoy | Cumple | Suite completa del backend, 41 de 41 (reservas, límites, reintentos y abusos sin cambios). Recorrido en FisioActiva |
| RF-017 – La beta igual | Cumple | `npm run build` y `npm run lint` sin errores. Recorrido con Playwright en la beta (puerto 3199): 77 de 77 en dos pasadas (servicio en pareja, reserva con una persona existente y otra nueva, cédula repetida, aviso del panel, 390 px, privacidad de «sólo sus pacientes», todo o nada, pago sólo al principal, interruptor apagado). Sin el tope de emails a pacientes nuevos ni el reintento, que la beta no tiene |
| CE-001 – Reservar en pareja en menos de 3 minutos | Sin comprobar | No se midió con personas. El formulario suma 4 campos por persona |
| CE-002 – 100 % de reservas en pareja con una cita y sin duplicados | Cumple | Prueba: las 3 combinaciones (existente/nueva, las dos existentes, las dos nuevas) |
| CE-003 – Cada persona recibe su email y una sola copia | Cumple | Prueba y recorrido (ver RF-007) |
| CE-004 – Ningún dato de una ficha en la página | Cumple | Prueba: la respuesta de un rechazo no trae el email ni el apellido de la ficha. La página no completa campos |
| CE-005 – Sin habilitar, 0 % de reservas con varias personas | Cumple | Prueba: 400 con el interruptor apagado |
| CE-006 – Un rechazo no deja pacientes ni citas | Cumple | Prueba: 403, 409 y 429 sin altas |
| CE-007 – Pruebas y 390 px | Cumple | Backend: typecheck y 41 de 41 suites. Front: build y lint sin errores. Recorrido: sin desplazamiento horizontal a 390 px |

**Pruebas automáticas:**
- **Backend:**
  - `npm run typecheck` sin errores;
  - `npm test`: 41 de 41 suites, con `couple-booking` (64), `booking-alert` (32), `reminders` (39) y
    `multi-client-appointments` (59);
  - `cron.test.mjs` también pasa: ya no espera que el aviso de Gmail sea el único (ver «Fuera de la spec»).
- **Front:** `npm run build` y `npm run lint` sin errores.
- **Migración 033:** aplicada sin errores en el PostgreSQL 16 local.

## Cambios respecto al plan

- **Tope de emails a pacientes nuevos (D10):**
  - El plan decía contar los emails cuya dirección es la de un paciente nuevo. Era más estrecho que
    el tope de hoy, y la prueba `public-abuse` lo detectó.
  - Quedó así: cuenta los emails de las citas con algún paciente nuevo, sea el principal o la otra
    persona.
- **`services-page.tsx` del front (T014):** no hizo falta tocarlo. Activar o desactivar un servicio
  no manda el campo, y el backend conserva el que tenía. Lo comprueban la prueba y el recorrido.
- **Confirmación:** cuando hay varias personas, cada bloque lleva una etiqueta visible («Tus datos»,
  «La otra persona»). Se marcó `aria-hidden` para que el lector de pantalla no la lea dos veces.

## Pendientes y riesgos

- **Datos de pago en las citas del panel (decisión 3):** las personas que no son la principal
  dejan de recibirlos. Es un cambio respecto a la fase 1.
- **Límite por persona:** ahora cuenta también las sesiones en las que la persona va como otra
  paciente. Con el límite en 1, quien tiene una sesión de pareja ese día no reserva otra por la
  página.
- **Una página abierta antes de publicar** (servicio en pareja sin el bloque de la otra persona):
  la reserva responde que recargue la página.
- **Formulario de servicios, error que ya existía:** el formulario no envía el formato de historia
  clínica del servicio (`clinicalTemplateId`), así que editar un servicio en el panel se lo quita.
  No es de esta spec; queda para un arreglo aparte si se quiere.

## Fuera de la spec, en los mismos días

- **Aviso por ntfy de cada paciente registrado desde el panel**, pedido por el dueño del producto
  el 2026-10-13. Dice quién lo registró y con qué rol, con el paciente a medias, y va en un commit
  aparte. Los pacientes de la página ya salían en el aviso de su reserva.
- **`cron.test.mjs`:** la prueba del aviso de Gmail ya no exige que sea el único aviso.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 1548885 | Spec 005: servicios en pareja o familia y su reserva online |
| agenda-backend | 758ab2f | Aviso por ntfy de cada paciente registrado desde el panel |
| agenda-front | 0f964c4 | Spec 005: servicios en pareja o familia y su reserva online |

## Cómo publicarlo

1. **Migración primero.** La aplica el dueño del producto en Supabase, antes de publicar el
   backend:
   ```
   npm run db:migrate
   ```
2. **PR `dev` → `main` de agenda-backend.** Incluye la copia de los recordatorios (`acef223`) si aún
   no se publicó.
3. **PR `dev` → `main` de agenda-front.**
4. **Después**, en el negocio habilitado, el profesional marca sus servicios en pareja o familia en
   Servicios → «Personas por sesión». Comprobar sólo leyendo que los despliegues de Vercel estén
   «Ready».

## Texto para el PR

Servicios en pareja o familia y su reserva online (spec 005). Un servicio puede ser para 2 o 3
personas (sólo en negocios habilitados por el super admin). La página de reservas pide los datos de
cada una, las reconoce por su cédula y crea una sola cita. Los datos de pago van sólo a quien
reserva. **Migración 033** (aplicar antes). Reporte: `specs/005-servicios-en-pareja/reporte.md`.
