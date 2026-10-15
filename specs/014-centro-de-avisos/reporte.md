# Reporte final: Centro de avisos en el panel

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada en dev, con la beta · **Fecha**: 2026-10-15

**Repos**: los dos (agenda-backend y agenda-front) y la beta · **Migración**: Sí:
`041_panel_notices.sql`

## Resumen

El panel del negocio y el de /admin tienen una campana con el número de avisos sin leer. Al tocarla,
se ven los últimos 20 y desde ahí se abre la cita.

Cada persona del equipo ve lo suyo:
- el propietario, todo el negocio;
- Recepción y los administradores, las reservas, los comprobantes, las confirmaciones y las
  cancelaciones;
- el rol Profesional, lo de su agenda.

No hace falta activar nada: llega aunque nadie haya activado los avisos en el celular. «Ver todos»
abre la página con los de 30 días. La beta lleva lo mismo, con avisos de ejemplo.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – La campana con lo nuevo | P1 | Hecha | En el menú lateral (computadora) y en la barra de arriba (celular); «Marcar todo como leído» |
| H2 – Cada uno ve lo suyo | P1 | Hecha | La tabla de la spec, decidida al leer con el rol de hoy |
| H3 – La página «Avisos» | P2 | Hecha | `/dashboard/notices`: agrupada por día, «Sólo los no leídos», «Cargar más» |
| H4 – El super admin tiene la suya | P2 | Hecha | `/admin/notices`, con sus cuatro avisos |
| Beta (RF-013) | — | Hecha | Avisos de ejemplo y los de cada suceso de la demo |

## Comprobación

Todo en local: la base desechable de `npm test` y la de prueba del puerto 54400, la API en el 4180,
el front compilado en el 5199 y la beta en el 3199. Nunca en Vercel ni contra Supabase.

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – La campana en los dos paneles | Cumple | Recorrido del front (57 de 57): junto al logo en la computadora y en la barra a 390 px; «9+»; también en /admin. Beta: 89 de 89 |
| RF-002 – Cada aviso a quien dice la tabla, y a nadie más | Cumple | `panel-notices` en la Clínica Dental Sonrisa, con Ricardo, Sofía (administradora), Elena (Recepción), Valeria (Profesional) y la agenda sin usuario del Dr. Vega: cada aviso («Nueva reserva», «Comprobante», «El paciente confirmó», «Cancelada por el paciente», «Cita nueva», «Cita por cerrar», los dos resúmenes) lo ven exactamente los de la tabla. La consulta sale de `NOTICE_AUDIENCE`, y la beta la compara con `noticeVisibleTo` |
| RF-003 – Llega sin activar el celular | Cumple | `panel-notices`: nadie tiene el celular activado y los avisos llegan igual, también los del cron |
| RF-004 – La lista: los últimos 20; tocar abre y marca leído | Cumple | Recorrido del front: al tocar «Nueva reserva» se abre la cita y baja el número; `panel-notices`: la URL abre la cita |
| RF-005 – «Marcar todo» y el leído propio | Cumple | `panel-notices`: leer uno le baja el contador a Elena y no a Ricardo; «Marcar todo» deja a Ricardo en 0 sin cambiar a Elena; lo que llega después vuelve a contar |
| RF-006 – La página de 30 días por día, «Sólo los no leídos» | Cumple | Recorrido del front y de la beta («Hoy», «Ayer», «Mar 13 oct», «Cargar más»); `panel-notices`: `unread=1` |
| RF-007 – Se borran a los 30 días | Cumple | `panel-notices`: uno de hace 31 días no aparece y el cron lo borra; `cron`: la línea del borrado |
| RF-008 – Aparece sin recargar | Cumple | El contador se pide al volver a la pestaña, cada 3 minutos con la pestaña visible y con `agenda360:aviso`; el recorrido simuló ese mensaje por CDP y el número cambió al momento |
| RF-009 – Nombre completo; nunca contacto ni datos clínicos | Cumple | `panel-notices`: «Rosa Elvira Real Montes» en la campana y «Rosa E.» en el celular para la misma reserva; en los 465 avisos que leyeron las campanas, ni cédula, ni email, ni teléfono, ni notas |
| RF-010 – El rol de hoy; quien sale; el paciente borrado | Cumple | `panel-notices`: quien entra hoy no ve lo de antes; quien sale deja de ver; de Recepción a Profesional sólo ve su agenda; la cita movida la ve la nueva agenda; el propietario anterior sólo ve lo de su agenda; al borrar al paciente desaparecen sus avisos y su nombre no queda guardado |
| RF-011 – Si falla, lo demás sigue | Cumple | `panel-notices`: sin la tabla (como sin la migración 041), la reserva responde 200, la cita y sus emails quedan y el celular sale igual. El registro sólo dice el tipo y el código |
| RF-012 – Leer no va a la actividad | Cumple | `panel-notices`: ver la campana, leer y «Marcar todo» no escriben en `audit_logs` |
| RF-013 – La beta | Cumple | Build y lint. Recorrido `beta-verificar-014.mjs`, 89 de 89: ejemplos al cargar; reserva, comprobante, «Confirmo que voy» y cancelación desde la bandeja simulada; cada rol; /admin; una base guardada de antes recibe los ejemplos sin perder nada; 390 px |
| CE-001 – En menos de 3 minutos (30 s con el celular) | Cumple (por diseño) | El intervalo es de 3 minutos con la pestaña visible y se pide también al volver a la pestaña. Con el celular, al instante (mensaje del service worker). El servicio real de Google no se probó con la campana |
| CE-002 – Cada rol ve exactamente lo de la tabla | Cumple | `panel-notices` (los cuatro roles y la agenda sin usuario) y el recorrido de la beta con los botones Clínica, Profesional y Recepción |
| CE-003 – Ningún aviso con datos de contacto ni clínicos | Cumple | `panel-notices` sobre 465 avisos leídos |
| CE-004 – El panel no tarda más | Cumple | El contador es una consulta con índices y sin textos; la lista sólo se pide al abrir la campana. En el recorrido, el número aparece junto con el panel |
| CE-005 – Pruebas y 390 px | Cumple | Ver abajo. Front y beta a 390 px sin desplazamiento horizontal |

**Pruebas automáticas:**
- **Backend:** `npm run typecheck` sin errores y `env -u DATABASE_URL npm test`: 54 de 54 suites.
  - `panel-notices` es nueva: 88 comprobaciones.
  - `push-notices` pasa sin cambiar ninguna expectativa: los textos del celular son los mismos.
  - `cron` pasa con la línea nueva.
- **Front:** `npm run build` (con los 2 avisos de Vite de siempre) y `npm run lint` sin errores.
- **Beta:** `npm run build` y `npm run lint` sin errores.

**Recorridos con Playwright:**
- `verificar-014.mjs`: 57 de 57, con el front compilado, en escritorio y a 390 px.
- `beta-verificar-014.mjs`: 89 de 89.

## Cambios respecto al plan

**Backend y front:**
- **El cursor de «Cargar más»** lleva microsegundos. Con milisegundos se podía saltar avisos creados
  en el mismo milisegundo.
- **`addAppointmentNotice`** guarda también el resumen de las 8 (sin cita, con la agenda). Comprueba
  ahí mismo las condiciones de «Cita nueva»: la agenda tiene usuario, no la agendó él y la cita está
  Pendiente o Confirmada.
- **Claves para no repetir:** además de las del plan, `serie:<primera cita>` y `plan:<solicitud>`.
- **La migración es algo más estricta:** los avisos del negocio no guardan texto y los de la
  plataforma lo exigen. Tiene índices para borrar rápido una cita, un paciente o una agenda.
- **«Marcar todo»** borra las lecturas sueltas anteriores de esa persona, que ya no hacen falta.
- **El service worker** manda `agenda360:aviso` a la vez que muestra el aviso, no después. Así la
  campana se pone al día aunque mostrar el aviso falle.
- **El tope de 100 citas por cerrar por pasada** cuenta ahora las de todos los negocios.
- **Quien deja el equipo** deja de ver sus avisos al momento, por la regla al leer. Sus filas de
  «leído» caducan con los avisos a los 30 días.
- **El título del resumen de las 8** sigue diciendo «…de hoy sin cerrar», aunque se lea al día
  siguiente.
- **`noticeVisibleTo`** (la misma regla en TypeScript) está en `src/lib/notices.ts`, para la beta y las
  pruebas.

**Beta:**
- **Sin aviso al instante:** no tiene avisos al celular. Se actualiza al volver a la pestaña, cada
  3 minutos y tras cada cambio del propio panel.
- **Sin modo soporte,** porque la beta no lo tiene.
- **`NoticeKind`** es la lista de los 11 tipos escrita a mano, porque la beta no tiene los tipos del
  celular de la spec 013.
- **«Negocio nuevo» y dos avisos de seguridad de ejemplo,** para que la campana de /admin tenga
  contenido en las demostraciones.
- **Limitaciones de los ejemplos:**
  - el de «Comprobante de pago» no crea un comprobante real (los de la demo viven en IndexedDB);
  - la cita por cerrar de ejemplo puede estar ya completada, porque los ejemplos no cambian citas.

## Pendientes y riesgos

- **Sin comprobar:** el servicio real de Google con la campana, Safari y el iPhone. El recorrido simula
  el mensaje del service worker.
- **CPU de Vercel:** el contador cada 3 minutos por pestaña abierta está calculado en unos 10 minutos
  al mes (R6).
  - Conviene mirar la CPU después de publicar.
  - Si sube, se alarga `NOTICE_REFRESH_MS`.
- **Tu `dev:local`:** hay que reiniciarlo (Ctrl+C y `npm run dev:local`) para que aplique la migración
  041 en tu base local. Hasta entonces la campana no funciona, pero las reservas sí.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 5357be8 | Spec 014: spec, plan y tareas del centro de avisos (constitución 1.10.0) |
| agenda-front | 986f441 | Constitución 1.10.0: la campana de avisos del panel (spec 014) |
| agenda-backend | 017c9ce | Spec 014: centro de avisos en el panel (backend) |
| agenda-front | be1f6bb | Spec 014: centro de avisos en el panel (front) |
| agenda-backend | (el de este reporte) | Spec 014: reporte final y tareas cerradas |

La beta queda actualizada en su carpeta (sin git), con una copia previa en `beta-src-antes-014.tgz`.

## Cómo publicarlo

1. **Las specs 010 a 013 salen antes o juntas con ésta.** Sus migraciones (037 a 040) y las claves
   VAPID de la 013 van antes, como dicen sus reportes.
2. **La migración 041,** como paso aparte, antes del PR del backend. El mismo comando aplica también
   las de la 037 a la 040 si aún faltan:

   ```
   cd ~/Documentos/Proyectos/Backend/agenda-backend
   npm run db:migrate
   ```

3. **Comprobar que quedó aplicada,** en el editor SQL de Supabase (sólo lectura):

   ```
   begin read only;
   select name, applied_at from schema_migrations order by name desc limit 5;
   rollback;
   ```

   Debe aparecer `041_panel_notices.sql`.
4. **Los PR `dev` → `main`:**
   - **Si salen juntas con la 010:** primero el front y en seguida el backend (como pide la 010).
     Mientras se despliega el backend, la campana no se muestra y nada da error.
   - **Si la 010 ya está publicada:** primero el backend y después el front.
5. **Al publicarse el backend,** abrir esta dirección y ver `"ok":true`:

   ```
   https://agenda-backend-lemon.vercel.app/api/health
   ```

6. **No hay variables nuevas.** La beta ya está actualizada.

## Texto para el PR

Spec 014, centro de avisos en el panel. El panel del negocio y /admin tienen una campana con los
avisos de los últimos 30 días, sin activar nada:
- cada persona del equipo ve lo suyo y lleva su propio leído;
- los avisos van con el nombre completo del paciente;
- tiene la página «Avisos».

**Migración:** sí, `041_panel_notices.sql`, aplicada antes del backend.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/014-centro-de-avisos/reporte.md
