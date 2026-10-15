# Plan de implementación: Centro de avisos en el panel

**Rama**: `dev` · **Fecha**: 2026-10-15 · **Spec**: [spec.md](./spec.md)

**Documentos**:
- [research.md](./research.md) (decisiones R1–R14)
- [data-model.md](./data-model.md)
- [contracts/api.md](./contracts/api.md)
- [quickstart.md](./quickstart.md)

## Resumen

**Cómo funciona para el equipo:**
- **La campana** va arriba del menú lateral en la computadora y a la derecha de la barra en el celular.
  Lleva el número de avisos sin leer («9+» si son más de 9).
- **Al tocarla** se abren los últimos 20:
  - título, texto con el nombre completo del paciente y hace cuánto;
  - los no leídos, resaltados.
- **Tocar un aviso** abre su cita (o la agenda del día, en el resumen) y lo marca leído.
- **«Marcar todo como leído»** deja la campana en cero.
- **«Ver todos»** lleva a `/dashboard/notices`:
  - los de los últimos 30 días, agrupados por día;
  - «Sólo los no leídos» y «Cargar más».
- **Cada persona ve lo suyo,** según la tabla de la spec: el propietario todo, Recepción y los
  administradores lo de las reservas, y el rol Profesional lo de su agenda.
- **El super admin** tiene lo mismo en /admin, con sus cuatro avisos.

**Backend** (lo principal):
- **Migración 041:** tres tablas:
  - `panel_notices`, un aviso por suceso;
  - `panel_notice_reads`, quién leyó cada uno;
  - `panel_notice_state`, «Marcar todo» (R1).
- **Quién ve qué se decide al leer,** con el rol, la agenda y la cita de hoy (R2). La regla va como
  constante compartida, `NOTICE_AUDIENCE`.
- **Los textos se arman al leer** con los mismos constructores del celular, movidos a un archivo
  compartido (`describeNotice`). Llevan el nombre completo en la campana y a medias en el celular
  (R3).
- **Los avisos se crean en los mismos puntos que los del celular** (`push-notices.ts`), haya o no
  aparatos, en su propio punto de guardado (R4).
- **El cron:**
  - mira todos los negocios activos para las citas por cerrar y el resumen de las 8, que ahora va
    también por agenda (R5);
  - borra lo de más de 30 días (R9).
- **Ocho rutas:** cuatro del negocio y cuatro de /admin (contador, lista, leer uno y leer todos),
  sin escribir en la actividad (R6–R8).

**Front:**
- **La campana va en `AppShell`,** que es común a los dos paneles.
- **La lista** se abre en un `Popover`.
- **Las páginas** `/dashboard/notices` y `/admin/notices`.
- **El contador** se pide al abrir, al volver a la pestaña y cada 3 minutos con la pestaña visible.
- **Al instante** con el mensaje del service worker cuando llega un aviso al celular (R10, R11).

**Beta:**
- **La misma campana,** con avisos de ejemplo de la clínica al cargar la demo.
- **Cada reserva, «Confirmo que voy», cancelación desde «Tu cita», comprobante o cita del panel** de
  la demo suma su aviso, con la misma regla y los mismos textos (R12).

**Constitución 1.10.0:** el texto propuesto está abajo.

## Contexto técnico

**Lenguaje/versión**: TypeScript. En el backend, Node ejecuta los `.ts` directamente. El front y la
beta usan React 19, Vite y TanStack Query.

**Dependencias**: ninguna nueva. El `Popover`, el `Badge` y el `Sheet` ya están en `components/ui`
del front y de la beta.

**Almacenamiento**: la migración 041 (data-model). La beta usa una colección nueva en su base de
`localStorage`.

**Variables nuevas**: ninguna.

**Pruebas**:
- la suite nueva `tests/panel-notices.test.ts`;
- las que se actualizan (`push-notices`, `cron`);
- los recorridos del [quickstart.md](./quickstart.md);
- todo con `npm test` contra una base desechable.

**Restricciones**:
- **CPU de Vercel Hobby** (4 h al mes): el contador es una consulta con índices, y el refresco va cada
  3 minutos y sólo con la pestaña visible (R6).
- **La migración 041** la aplica el dueño antes del backend, como paso aparte.
- **Nunca rompe lo que provoca el aviso** (RF-011).

## Comprobación contra la constitución (1.9.0 → 1.10.0)

| Principio | Cumple | Cómo |
|---|---|---|
| I. Español | Sí | La campana, la página, los avisos, los mensajes de error y la documentación, en español. |
| II. Privacidad | Sí, con una ampliación | El paciente va con su nombre completo **sólo dentro del panel** (decisión 4 del dueño): el equipo ya lo ve así en la agenda, y el rol Profesional sólo ve su agenda. Nunca la cédula, el email, el teléfono ni datos clínicos (CE-003). El celular y ntfy siguen a medias. Al borrar un paciente se borran sus avisos (R3). |
| III. Decisiones | Sí | Las seis decisiones del 2026-10-15. Modo soporte: el super admin no ve la campana del negocio. Los negocios siguen sin ver planes: la solicitud de plan sólo aparece en /admin. Leer no va a la actividad (decisión 5), de acuerdo con la 1.9.0 («las consultas no se registran»). |
| IV. Local | Sí | Todo se comprueba en local ([quickstart.md](./quickstart.md)), sin Vercel ni Supabase. |
| V. Compartido | Sí | Los tipos, `NOTICE_AUDIENCE`, `describeNotice` y la validación se editan en el front y se copian con `sync:shared`. Los archivos nuevos se crean primero en el backend, como en las specs 011 a 013. La beta usa las mismas copias. |
| VI. Barato | Sí | Sin dependencias ni servicios de pago. Sin conexiones abiertas: un contador barato cada 3 minutos (unos 10 minutos de CPU al mes en una cuenta generosa, R6). El trabajo pesado va por el cron de GitHub. |
| VII. Diseño | Sí | La campana y la lista usan los tokens del tema y los componentes de hoy. A 390 px, la lista ocupa el ancho sin desplazamiento horizontal. El botón anuncia «Avisos, 3 sin leer» al lector de pantalla. |
| Restricciones | Sí | La migración 041 la aplica el dueño antes del backend, como paso aparte. Sin variables nuevas. |

**Única ampliación: el principio II.** El nombre completo del paciente dentro del panel lo pidió el
dueño (decisión 4) y queda escrito en la constitución.

**Constitución 1.10.0 (MENOR), en los dos repos.** Texto propuesto:

- **Principio II**, después de la línea de los avisos de ntfy y del celular:
  > En la campana del panel (spec 014) el paciente va con su nombre completo, porque está dentro del
  > panel, donde el equipo ya lo ve. Nunca su contacto, su cédula ni nada de la historia clínica
  > (2026-10-15).
- **Principio III**, una línea nueva:
  > El panel del negocio y el de /admin tienen una campana con los avisos de los últimos 30 días, sin
  > tener que activar nada. Cada persona ve lo suyo y lleva su propio leído:
  > - el propietario, todo el negocio, y «Cita nueva» y el resumen de su agenda;
  > - Recepción y los administradores, las reservas, los comprobantes, las confirmaciones y las
  >   cancelaciones del paciente de todas las agendas;
  > - quien tiene una agenda, lo de su agenda (también «Cita nueva», si la agendó otra persona, y las
  >   citas por cerrar);
  > - el super admin, sus cuatro avisos en /admin, y en modo soporte no ve la del negocio.
  >
  > Leer no se registra en la actividad (2026-10-15).

## Cambios respecto a la spec

1. **Las fechas se calculan al leer** (R3). «Nueva reserva · Mañana 16:00» de ayer se lee hoy «Hoy
   16:00». Así el texto nunca se queda viejo, y si la cita se movió, dice la hora nueva.
2. **«Cita nueva en tu agenda»** le llega a quien tenga la agenda de la cita, sea cual sea su rol (por
   ejemplo, una administradora que también atiende). La spec dice «al profesional de esa agenda».
3. **El resumen por agenda** no le llega al propietario, que ya recibe el del negocio entero: así no
   recibe dos el mismo día.
4. **Quien entra al equipo** sólo ve los avisos desde que entró, no los 30 días anteriores (R2).
5. **En la ventana de publicación,** si la ruta todavía no existe (404), la campana no se muestra y
   no da error (R10).
6. **En la beta no hay cron:** las citas por cerrar y el resumen sólo están en los avisos de ejemplo.

## Estructura

```text
specs/014-centro-de-avisos/   spec, plan, research, data-model, contracts/api.md, quickstart (tasks y reporte, después)

agenda-backend
  .specify/memory/constitution.md               1.10.0
  db/migrations/041_panel_notices.sql           NUEVO (data-model)
  src/services/panel-notices.ts                 NUEVO: addAppointmentNotice y addPlatformNotice (con punto de guardado),
                                                listNotices, countUnread, markRead, markAllRead (la consulta de R2),
                                                cleanupPanelNotices (R9)
  src/services/push-notices.ts                  cada notify* añade su aviso del panel; los textos pasan a describeNotice;
                                                queueUnclosedNotices y queueEveningSummaries para todos los negocios
                                                activos, y el resumen por agenda (R4, R5)
  src/routes/business-routes.ts                 /:businessId/notices (unread, lista, leer, leer todos)
  src/routes/platform-routes.ts                 /admin/notices (lo mismo, con la verificación en dos pasos)
  src/jobs/scheduled-tasks.ts, scripts/cron.ts  el informe y la línea del registro con «avisos del panel: N»; el borrado
  src/db/seed.ts                                las tablas nuevas en TABLES
  src/shared/…                                  copias (sync:shared): lib/notices.ts, lib/constants/notices.ts,
                                                lib/validations/notices.ts, types
  tests/panel-notices.test.ts                   NUEVO (quickstart §1)
  tests/push-notices.test.ts, tests/cron.test.mjs   textos del celular sin cambios; la línea del cron
  README.md                                     la campana

agenda-front
  .specify/memory/constitution.md               1.10.0
  src/types/index.ts                            NoticeKind, PanelNotice, PanelNoticePage
  src/lib/constants/notices.ts                  NUEVO: NOTICE_AUDIENCE, NOTICE_DAYS (30), NOTICE_LIST_SIZE (20),
                                                NOTICE_REFRESH_MS (3 min)
  src/lib/notices.ts                            NUEVO: describeNotice (los textos del celular y de la campana)
  src/lib/validations/notices.ts                NUEVO: los parámetros de la lista
  src/lib/data/repository.ts, api-repository.ts las rutas del negocio y de /admin
  src/hooks/queries/query-keys.ts, use-notices.ts   NUEVO: contador (refetchInterval sólo visible, al volver a la
                                                pestaña), lista, leer y leer todos; escucha agenda360:aviso
  src/features/notices/                         NUEVO: notice-bell.tsx (botón, número y Popover), notice-list.tsx,
                                                notice-item.tsx
  src/pages/dashboard/notices-page.tsx          NUEVO: /dashboard/notices
  src/pages/admin/admin-notices-page.tsx        NUEVO: /admin/notices
  src/components/layout/app-shell.tsx           la campana en la barra del celular (prop nueva)
  src/components/layout/sidebar-content.tsx, admin-sidebar.tsx   la campana junto al logo (computadora)
  src/components/layout/dashboard-layout.tsx, admin-layout.tsx   sin campana en modo soporte
  src/app/router.tsx                            las dos páginas
  src/sw.ts                                     agenda360:aviso a las ventanas abiertas (R11)
  README.md                                     la campana

agenda-beta (sin git; copia previa en beta-src-antes-014.tgz)
  types, lib/constants/notices.ts, lib/notices.ts   las copias del front
  lib/data/mock/store.ts, seed.ts               la colección nueva (migrateData) y los avisos de ejemplo (demoUpgrades)
  lib/data/mock/notices-repository.ts           NUEVO: la misma regla (NOTICE_AUDIENCE) y los mismos textos
  lib/data/mock/public-booking-repository.ts, business-data-repository.ts   cada suceso suma su aviso
  features/notices/, pages, layout, router      la campana y las páginas, adaptadas a su layout
```

## Publicación

**El orden importa:** la migración va antes del código que la usa.

1. **Constitución 1.10.0,** al aprobar este plan, en los dos repos.
2. **Las specs 010 a 013 tienen que estar publicadas o salir juntas con ésta.** Sus migraciones (037 a
   040) van antes que la 041.
3. **La migración 041,** como paso aparte, antes del PR del backend. Si salen juntas, el mismo comando
   aplica también las de la 037 a la 040:

   ```
   cd ~/Documentos/Proyectos/Backend/agenda-backend
   npm run db:migrate
   ```

4. **Comprobar que quedó aplicada,** en el editor SQL de Supabase (sólo lectura):

   ```
   begin read only;
   select name, applied_at from schema_migrations order by name desc limit 5;
   rollback;
   ```

   Debe aparecer `041_panel_notices.sql`.
5. **Los PR `dev` → `main`:**
   - **Si la 010 ya está publicada:** primero el backend y después el front.
   - **Si salen juntas con la 010:** primero el front y en seguida el backend, como pide la 010. Mientras
     se despliega el backend, la campana no se muestra (R10) y nada da error.
6. **Al publicarse el backend,** `https://agenda-backend-lemon.vercel.app/api/health` debe decir
   `"ok":true`.
7. **No hay variables nuevas.**
8. **La beta** queda actualizada en su carpeta, sin git.

## Riesgos

- **CPU de Vercel:** cada pestaña abierta del panel pide el contador cada 3 minutos. Está calculado en
  unos 10 minutos al mes en una cuenta generosa (R6).
  - Si la CPU sube, se alarga el intervalo con una sola constante (`NOTICE_REFRESH_MS`).
  - Al publicar conviene mirar la CPU en Vercel, como con la Lambda.
- **Mover los textos del celular a `describeNotice`:** toca código de la spec 013. Lo cubre
  `push-notices` (106 comprobaciones de textos), que tiene que seguir igual.
- **El cron para todos los negocios:** son más consultas por pasada. Con los negocios de hoy son
  milisegundos, y corre en GitHub, no en Vercel.
- **Una clínica muy activa:** cientos de avisos al mes. Los índices por negocio y fecha, y los 30 días,
  lo mantienen pequeño.
- **El espacio de la beta** (`localStorage`): se guardan como mucho los últimos 200 avisos.

## Decisiones del dueño del producto (2026-10-15)

1. **Todo el equipo,** cada uno lo suyo (la tabla de la spec).
2. **Campana con lista** (los últimos 20) y la página «Avisos» (30 días).
3. **El super admin** también tiene su campana en /admin.
4. **El paciente con su nombre completo** en la campana. El celular y ntfy siguen a medias.
5. **Leer o marcar como leído** no va a la actividad.
6. **La beta** lleva la campana con avisos de prueba.

## Preguntas para el dueño del producto

Ninguna: las seis decisiones cubren el diseño. Los «Cambios respecto a la spec» (arriba) son detalles
para que lo apruebes junto con el plan.
