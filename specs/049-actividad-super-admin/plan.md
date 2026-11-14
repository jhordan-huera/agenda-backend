# Plan de implementación: La pantalla Actividad del super admin, rediseñada

**Rama**: `dev` · **Fecha**: 2026-11-13 · **Spec**: [spec.md](./spec.md)

**Sin migración ni cambios en la API.** Sólo agenda-front. El diseño es la propuesta A del lienzo
(https://claude.ai/artifact/Sw7D9ak998YowLcKtGmft7). El dueño del producto aprobó la spec, el plan y las tareas el
2026-11-13 («apruebo todo planes y todo»).

## Decisiones que salen del código

1. **Las pestañas de la página** son las de línea (`TabsList variant="line"`), las mismas de Analítica y de la ficha
   del negocio en /admin. Para Super admin / Todo y Hoy / Fallidos / Todos quedan las de pastilla de hoy: dos niveles,
   dos estilos.
2. **Cada pestaña pide sus datos sólo cuando se abre.** Cada panel llama a sus consultas (`useAdminAuditFeed`,
   `useAdminEmails`). Los filtros viven en la página, así que no se pierden al cambiar de pestaña.
3. **El panel del negocio no cambia.** `AuditFeed`, `AuditEntry`, `AuditFiltersBar` y `EmailOutboxCard` siguen como
   están para él. Sólo se agregan opciones que, si no se pasan, dejan todo igual:
   - **`AuditFiltersBar`:**
     - `leading`, para poner Super admin / Todo antes del buscador;
     - `dates={false}`, para quitar los dos campos de fecha cuando la pantalla pone su propio botón.
   - **`audit-entry.tsx`:** «Ver cambios» pasa a un componente exportado (`AuditChanges`), que usan las dos listas.
   - **`email-outbox.tsx`:** se exportan `TYPE_LABELS`, el diálogo del contenido (`EmailPreviewDialog`) y
     `DeliveryDetail`, para no copiarlos.
4. **Los colores salen de los tokens del tema** (principio VII: cada super admin elige los de su panel):
   - superficies `bg-card`, `bg-muted`, `border`;
   - textos `text-muted-foreground`;
   - el rojo es `text-destructive` y `bg-destructive/7`;
   - el resumen sin problemas usa `bg-accent` y `text-ink`.
5. **La dirección:**
   - cambiar de pestaña escribe `?ver=acciones|seguridad|emails` con `replace: false` (el botón Atrás vuelve) y borra
     `?emails=`;
   - el filtro de Emails no va en la dirección salvo al llegar con `?emails=…`, como hoy;
   - como hoy, un enlace nuevo con la pantalla abierta se aplica al render (el patrón `seenRequest` de la página
     actual), sin efectos.

## Diseño

1. **Lo que se puede probar sin navegador** (`front/src/features/admin/activity/`, archivos `.ts` sin JSX):
   - **`activity-url.ts`:**
     - `type ActivityTab = "actions" | "security" | "emails"`;
     - `readActivityUrl(params)` → `{ tab, emailFilter }`: `?ver=seguridad` da Seguridad; `?emails=hoy|fallidos|todos`
       da Emails con ese filtro; `?ver=emails` da Emails; lo demás, Acciones;
     - `tabParam(tab)`, la palabra de cada pestaña en la dirección.
   - **`today-summary.ts`:**
     - `summarizeToday(health)` → `{ tone, title, action, emails, security }`:
       - `tone`: `"ok"` o `"alert"`;
       - `title`: «Todo en orden hoy», «1 email falló hoy», «2 emails fallaron hoy», «1 cuenta en alerta»… o los
         dos juntos;
       - `action`: «Ver los fallidos» (Emails, Fallidos), «Ver la seguridad» (Seguridad, sólo intentos fallidos) o
         ninguna;
       - `emails`: la frase de los emails, en singular o plural y sin «en cola» si no hay;
       - `security`: la frase de seguridad, en trozos, con el de los intentos fallidos marcado como enlace.
     - `tabBadges(health)`: la cifra de Seguridad y la de Emails («N fallidos» en rojo o «N en cola»).
   - **`date-range.ts`:**
     - `DATE_PRESETS` (Hoy, Últimos 7 días, Últimos 30 días) y `presetRange(preset, today)` → `{ from, to }`;
     - `describeRange({ from, to }, today)`: «Cualquier fecha», el nombre del atajo, «Desde 3 nov», «Hasta 12 nov» o
       «3 nov – 12 nov» (con el año si no es este).
   - **`email-status.ts`:**
     - `emailStatusOf(email)` → `{ key, label, detail }`;
     - `key` es `sent`, `queued`, `failed` o `discarded`;
     - `detail`: el motivo del fallido (o «Sin motivo registrado») y el del descartado.

2. **Las piezas de la pantalla** (`front/src/features/admin/activity/`, nuevas):
   - **`today-summary-card.tsx`:**
     - el icono, con el escudo en el color de la marca o la alerta en rojo;
     - el título y la frase;
     - el enlace de los intentos fallidos y el botón de la acción.

     Si las cifras no cargan, no sale.
   - **`activity-ledger.tsx`:** la lista de Acciones y Seguridad, con `groupItemsByDay`.
     - **En el computador,** una cuadrícula por día. El día va a la izquierda (`bg-muted`, «Hoy» y la fecha corta
       debajo) y sus filas a la derecha: la hora, la frase, quién (con «Tú»), el navegador y la IP si hay,
       `AuditChanges` y el negocio como enlace a `/admin/businesses/:id`.
     - **En el celular,** el día arriba y el negocio debajo de la frase.
     - Además: los intentos fallidos en rojo, el esqueleto, el error con «Reintentar», «Sin actividad con estos
       filtros» y «Cargar más».
   - **`date-range-button.tsx`:**
     - un `Popover` con los tres atajos, Desde y Hasta (`input type="date"` con su etiqueta) y «Cualquier fecha»
       para quitarlas;
     - el botón muestra `describeRange`.
   - **`admin-email-list.tsx`:** los emails por día, con el estado primero (`emailStatusOf`).
     - **En el computador** (`md:` y más), filas en cuadrícula: Hora, Estado, Email (el asunto y el destinatario),
       Negocio y Tipo, con la cabecera de las columnas.
     - **En el celular,** varias líneas sin cortar el asunto.
     - La fila del fallido lleva `bg-destructive/7`. Cada fila es un botón que abre `EmailPreviewDialog`.
     - Arriba, Hoy / Fallidos (N) / Todos y «Los 200 más recientes. Toca uno para ver lo que decía.». Abajo, el
       vacío de cada filtro (los textos de hoy).

3. **La página** (`front/src/pages/admin/admin-activity-page.tsx`, se rehace):
   - **Arriba:** el título, `TodaySummaryCard` y las pestañas (`Tabs` de línea, con `tabBadges`).
   - **«Exportar»:** a la derecha de las pestañas, en Acciones y Seguridad, como hoy (`exportAuditCsv`).
   - **Acciones:** `AuditFiltersBar` con:
     - `leading`, Super admin / Todo;
     - `types`;
     - el negocio y `DateRangeButton` como `children`;
     - `dates={false}`.

     Debajo, `ActivityLedger`.
   - **Seguridad:** lo mismo sin el tipo, con «Sólo intentos fallidos» (`Switch`).
   - **Emails:** `AdminEmailList`.
   - **«Tú»:** `useCurrentUser()`, comparando con el `actorId` de la acción.
   - **Lo que se quita:** `StatGrid` en esta pantalla y el salto con `scrollIntoView` hasta los emails (ya no hace
     falta). `StatGrid` se sigue usando en otras pantallas.

4. **La comprobación** `front/scripts/check-admin-activity.ts` (`npm run check:admin-activity`), con el gancho del
   alias de `check-surveys.ts`:
   - `summarizeToday`: sin problemas; con 1 y con 2 fallidos; con una cuenta en alerta; con las dos cosas; con 0
     enviados o 0 en cola; los intentos como enlace sólo si hay;
   - `tabBadges`;
   - `readActivityUrl`, con cada enlace de hoy y con valores desconocidos;
   - `presetRange` y `describeRange` (el mismo año, otro año, sólo Desde, sólo Hasta);
   - `emailStatusOf` en los cuatro estados, con y sin motivo.

**No se hace:**
- cambios en la API, en el Inicio o en la campana;
- cambios en la actividad o la bandeja del panel del negocio;
- un calendario nuevo: las fechas siguen siendo campos del navegador dentro del botón;
- filtros nuevos en Emails (sólo los tres de hoy).

## Comprobación contra la constitución

| Principio | ¿Cumple? | Cómo |
|---|---|---|
| I. En español | Sí | Todos los textos y la comprobación |
| II. Privacidad | Sí | Muestra lo mismo que hoy, a los mismos super admins; no hay datos nuevos |
| III. Decisiones de producto | Sí | El panel sigue en tarjetas; Super admin / Seguridad / Todo y los filtros de emails se conservan |
| IV. Se comprueba en local | Sí | Build, lint, todas las `check:*` y el recorrido en Chromium (1440, claro) y WebKit (390, oscuro) en local |
| V. Código compartido | Sí | No toca tipos ni validaciones compartidas |
| VI. Barato de operar | Sí | Sin dependencias nuevas; cada pestaña pide sus datos sólo al abrirse |
| VII. Diseño | Sí | Tokens del tema (los colores de cada super admin), claro y oscuro, `grid-cols-1` de base, 390 px sin desbordes, pestañas y botones con su nombre y el foco visible |

La constitución no cambia: no hay decisiones nuevas de producto, datos, permisos ni excepciones.

## Pruebas

- **Front:**
  - `npm run build`, `npm run lint` sin avisos y todas las `check:*`, con la nueva `check:admin-activity`;
  - `check:contrast` sigue pasando: no se agregan colores.
- **Backend:** no cambia. Se corre `npm run typecheck` (sólo cambia la carpeta de la spec).
- **Recorrido en el navegador** (`front` 5229 contra la API 4199 y la base de prueba 55441, con datos demo y un email
  fallido puesto a mano en la base de prueba):
  - **Chromium a 1440, claro:**
    - el resumen «Todo en orden» y, con un fallido, en rojo con «Ver los fallidos»;
    - las tres pestañas y la dirección;
    - `?ver=seguridad` y `?emails=fallidos`;
    - Super admin / Todo, el negocio y las fechas (un atajo y Desde/Hasta);
    - «Ver cambios» y «Exportar»;
    - Seguridad con «Sólo intentos fallidos»;
    - un email fallido con su motivo, y abrirlo.
  - **WebKit a 390, oscuro:** lo mismo, en lo esencial.
  - **En las dos:** sin desplazamiento horizontal ni errores en la consola.
  - **La altura de la pantalla en el celular,** comparada con la de hoy (CE-005).
  - **El panel del negocio** (Configuración → Actividad) se ve igual que antes.
  - **Capturas** en `specs/049-actividad-super-admin/capturas/`.

## Riesgos

- **Quien estaba acostumbrado a bajar hasta los emails** ahora los tiene en su pestaña. El Inicio ya lleva directo
  ahí con «Ver emails».
- **Los campos de fecha dentro del botón** dependen del navegador, como hoy. Los atajos cubren lo más común.
