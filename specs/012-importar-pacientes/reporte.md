# Reporte final: Importar pacientes desde Excel o CSV

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada en dev, con la beta y la ampliación del 2026-10-15 · **Fecha**: 2026-10-14 (la beta y la ampliación, 2026-10-15)

**Repos**: los dos (agenda-backend y agenda-front) y la beta · **Migración**: Sí: `039_client_import.sql`

## Resumen

En Clientes hay un botón nuevo, **«Importar pacientes»**, para el propietario, los administradores y
el super admin en modo soporte. Se elige un Excel o un CSV (o se descarga la plantilla), se revisa a
qué dato va cada columna y la pantalla dice, antes de importar, cuántos pacientes se crearán, cuántos
ya existían, cuáles tienen errores (con la fila y el motivo) y cuáles están repetidos. Al pulsar
«Importar N pacientes» se crean sólo los nuevos y válidos, sin tocar los que ya estaban y sin mandar
ningún email. El archivo se lee en el navegador y no se guarda.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – Importar una lista | P1 | Hecha | Tres pasos (archivo, columnas y revisión) y el resultado; plantilla descargable |
| H2 – Sin sorpresas para los pacientes ni para la ficha | P1 | Hecha | Sin emails; los que ya existían no se tocan; las repetidas y los datos obligatorios del negocio |
| Beta (RF-011) | — | Hecha | La misma pantalla con los datos de prueba. Se hizo al final, después de fusionar la spec en `dev`: la beta no tiene git, y así los agentes que trabajaban en paralelo no chocaban en ella |

## Comprobación

Todo en local: PostgreSQL desechable para `npm test`; para el recorrido, un PostgreSQL propio en el
54412 con los datos de demostración, la API en el 4182 y el front en el 5212 (con Vite) y en el 5213
(el build con las cabeceras de `vercel.json`); la beta, en el 3199 con sus datos de prueba. Archivos de
prueba inventados, con cédulas generadas por el algoritmo del dígito verificador. Nunca en Vercel ni
contra Supabase.

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – «Importar pacientes» para propietario, administradores y modo soporte | Cumple | `client-import`: el propietario y una administradora importan; Recepción y el rol Profesional, 403; sin sesión, 401 sin leer un cuerpo de más de 4 MB; el super admin importa en modo soporte y la actividad dice «(Super admin)». Recorrido: el botón en Clientes (también a 390 px), Recepción no lo ve y por la dirección ve el aviso con el enlace a Clientes; el super admin importa desde «Gestionar negocio» |
| RF-002 – .xlsx y .csv, hasta 5.000 filas | Cumple | `client-import`: 5.001 filas, 400. Recorrido: un Excel de dos hojas, un CSV en Windows-1252 con `;` y otro UTF-8 con BOM, `,`, comillas y saltos de línea; `pacientes-6000.csv` da «El archivo tiene 6.000 filas con datos: el máximo es 5.000…»; `antiguo.xls` da «Guárdalo como .xlsx o .csv…» |
| RF-003 – Columnas por nombre habitual y a mano | Cumple | `client-import`: `guessColumns` con «Nombres y Apellidos», «CI», «C.I.», «Correo electrónico», «Celular», «Teléfono», «Dirección», «Observaciones» y «E-mail», en mayúsculas y sin tildes; «Seguro médico» queda en «No importar». Recorrido: Nombres, Apellidos, CI, Correo, Celular, Dirección y Observaciones asignadas solas; la fecha de nacimiento y la fórmula, en «No importar»; «Añadir a las notas» lleva la fecha a la ficha |
| RF-004 – Las reglas del formulario del negocio | Cumple | `client-import`: dígito verificador, sin email, email y teléfono inválidos y cédula con letras, cada uno con el motivo del formulario; con el teléfono obligatorio, «El teléfono es obligatorio»; con la cédula opcional, las filas sin cédula se crean. La limpieza: guiones y espacios de la cédula, el 0 que quita Excel (sólo en Ecuador y si así es válida), «099.123.4567», dos teléfonos o dos emails; limpiar dos veces no cambia nada |
| RF-005 – La revisión dice qué pasará | Cumple | Recorrido con `pacientes-200.xlsx`: 190 se importarán, 3 ya existían (con el nombre del paciente), 5 con errores y 2 repetidas, con los números de fila de Excel (títulos en la fila 3 y dos filas vacías en medio); «Descargar las filas con errores» baja un CSV con las 5 filas y su motivo. `client-import`: la revisión del panel y la API dan lo mismo (es el mismo código) |
| RF-006 – Sólo los válidos y nuevos, con el tope del plan | Cumple | `client-import`: 190 creados con origen «import», de quien importó y con el mismo instante; los 3 que ya existían, idénticos antes y después; negocio Free con 45 pacientes y 20 filas: se crean 5, 15 en `overLimit` y el uso dice 50 |
| RF-007 – Sin emails | Cumple | `client-import`: `notifications` tiene las mismas filas antes y después |
| RF-008 – Un corte no duplica | Cumple | `client-import`: repetir la importación da 0 creados y 195 «ya existían»; dos peticiones iguales a la vez crean 40 en total, sin cédulas repetidas. Recorrido: con la petición cortada antes de llegar, «No sabemos si la importación terminó…» y reintentar importa todo; con la respuesta perdida después de que la API terminó, el mismo aviso y reintentar da todo «ya existía», sin duplicados |
| RF-009 – Una entrada en la actividad y un aviso de ntfy | Cumple | `client-import`: una entrada `client.imported` («Importó 190 pacientes (3 ya existían, 5 con errores, 2 repetidas en el archivo)»), sólo si se creó alguno; `findPanelClients` no devuelve los importados y sí el del formulario; con un ntfy falso, el cron manda un aviso por importación (10 por pasada y «…y N importaciones más»), sin nombres ni emails, y la línea del registro dice «importaciones: N». `booking-alert` y `cron` |
| RF-010 – Plantilla descargable | Cumple | Recorrido: «Descargar plantilla» baja `plantilla-pacientes.xlsx`; sin rellenar, «Esta hoja no tiene filas con datos…»; rellenada con 3 filas, importa 3. Con el build, el archivo se sirve como `.xlsx`, no como `index.html` |
| RF-011 – La beta | Cumple | Build, lint y `npm audit`. Recorrido `beta-verificar-012.mjs`: 72 de 72, en dos pasadas (el botón para el propietario y una administradora, no para Recepción ni el rol Profesional; un CSV y un .xlsx con la revisión, los errores, una cédula demo y una repetida; sólo los válidos y nuevos con origen «import»; repetir no duplica; el tope de un negocio Free; la plantilla; ningún email en la bandeja simulada; una entrada de actividad por importación; el Inicio del super admin; 390 px; y «La demo no tiene espacio…» con `localStorage` lleno) |
| CE-001 – 500 pacientes en menos de 2 minutos | Cumple (medido) | Recorrido con `pacientes-500.xlsx`: de elegir el archivo al aviso, 0,3 s con Vite y 0,1 s con el build (leer el Excel, 0,2 s; enviar e importar, 0,05 s). Falta sólo el tiempo de mirar la revisión |
| CE-002 – Nunca duplicados por cédula | Cumple | `client-import`: al repetir y con dos a la vez, ninguna cédula repetida en el negocio (además del índice único de la migración 006) |
| CE-003 – Ningún email a los importados | Cumple | Igual que RF-007 |
| CE-004 – Pruebas y 390 px | Cumple | Ver abajo; a 390 px, cada paso y el resultado sin desplazamiento horizontal |

**Pruebas automáticas**:
- **Backend:**
  - `npm run typecheck` sin errores;
  - `env -u DATABASE_URL npm test`: 50 de 50 suites y 1757 comprobaciones;
  - la suite nueva `client-import`: 66;
  - las actualizadas: `booking-alert` (58) y `cron` (29).
- **Front:** `npm run build` y `npm run lint` sin errores y sin avisos nuevos (los 2 avisos de siempre
  del build); `npm audit`, 0 vulnerabilidades.
- **Beta:** `npm run build` (con los mismos 2 avisos de siempre: un trozo de más de 500 kB e
  `inlineDynamicImports`) y `npm run lint` sin errores ni avisos; `npm audit`, 0 vulnerabilidades. El
  lector de Excel queda en su propio trozo (`browser-….js`, 52 KB), como en el front.
- **Lector de CSV** (`importar-012/scripts/probar-csv.ts` en el scratchpad, sin servidor): 12 de 12
  (`;`, `,`, tabulador, comillas, `""`, saltos de línea, BOM, `\r\n`, Windows-1252 y que `toCsv` da lo
  mismo que la exportación de la actividad de antes).
- **Recorridos** (`shot/verificar-012.mjs` en el scratchpad):
  - con Vite: 55 de 55, en escritorio y a 390 px;
  - con el build y las cabeceras de `vercel.json`: 59 de 59. Además: sin errores de CSP (el lector de
    Excel trabaja en un worker `blob:`, que `worker-src` ya permite), y el lector de Excel no se
    descarga al abrir el panel ni la página de importar ni con un CSV, sólo al elegir un .xlsx (un
    trozo de 16 KB comprimido);
  - la beta (`shot/beta-verificar-012.mjs`, con Vite en el 3199): 72 de 72, en dos pasadas, en
    escritorio y a 390 px.

## Cambios respecto al plan

- **La hoja que se propone** es la primera con títulos reconocidos (si ninguna, la primera con datos).
  El plan decía «la primera con datos»: con un Excel que empieza por una hoja «Resumen», así se propone
  directamente la de los pacientes. Se puede cambiar igual.
- **«Nombre» junto a «Apellido(s)»** se toma como la columna de los nombres y se une con los apellidos.
  Con la tabla de R5 tal cual, «Nombre» sería el nombre completo y los apellidos se perderían.
- **El orden de las notas:** «Otros teléfonos» y «Otros emails» van al final, después de las columnas
  «Añadir a las notas». La API recibe las notas ya unidas en un solo dato y la limpieza la hacen los
  dos lados.
- **Una cédula de 9 dígitos que no vale con el 0** da el motivo del formulario, «La cédula debe tener
  10 dígitos.», y no «La cédula no es válida…» como decía el quickstart: R5 manda dejarla como estaba
  y que dé su error.
- **«Ya existía» sin cédula:** una fila sin cédula sólo coincide con pacientes que tampoco tienen
  cédula (los que lee la API según R6). Así la revisión del panel, que tiene la lista entera, y la API
  dan siempre lo mismo.
- **Pacientes nuevos del mes en el Inicio del negocio:** la cifra ya se calcula sin los importados
  (`dashboard-metrics.ts`), pero hoy el Inicio del negocio no la muestra (sólo «Clientes activos», que
  sí los cuenta). En el Inicio del super admin sí se ve, y se comprobó en `client-import`.
- **`downloadCsv`** está en `src/lib/csv.ts` junto a `toCsv`: la usan la exportación de la actividad y
  «Descargar las filas con errores».
- **La dependencia en la copia del front:** `npm install read-excel-file@9.3.12 --save-exact` cambió el
  enlace de `node_modules` por una carpeta propia de la copia de trabajo (no tocó la del repositorio).
  Al fusionar en `dev`, hay que hacer `npm install` en agenda-front.
- **Beta** (R12; copia previa del código en `beta-src-antes-012.tgz`):
  - se hizo al final, el 2026-10-15, después de fusionar la spec en `dev`. No fue una decisión del
    dueño del producto (como decía antes este reporte): la beta no tiene git, y dejarla para el final
    evitó que los agentes que trabajaban en paralelo chocaran en ella;
  - `Client.source` también es obligatorio en la beta: los pacientes demo y los del formulario guardan
    `'dashboard'`, los de la página de reservas `'booking_page'` y una base ya guardada en un navegador
    rellena con `'dashboard'` los que no lo tenían (R10). `StoredClient` deja de llevar su propio
    `source`;
  - el cupo sale de `remainingClientSlots`, que se añade a `mock/plan-limits.ts` como en la API (en vez
    de usar `countClients` directamente);
  - su Inicio del super admin tampoco cuenta los importados como pacientes nuevos, como
    `admin-service.ts` (R12 no lo nombraba);
  - no se copian `export-audit.ts` ni `api-repository.ts`: la beta no exporta la actividad ni habla con
    la API. `downloadCsv` sólo la usa «Descargar las filas con errores»;
  - la beta no tiene modo soporte: allí importan el propietario y los administradores;
  - al abrir el panel, la beta corre su trabajo de recordatorios de las citas demo (puede dejar emails
    de recordatorio en la bandeja simulada). La importación no deja ninguno: se comprobó justo antes y
    justo después de importar, y que ningún email va a un importado;
  - el recorrido usa sus propios archivos (`beta012/scripts/hacer-archivos-beta.py` en el scratchpad:
    un CSV y un .xlsx con los mismos casos, con las cédulas demo de la beta) en vez de
    `pacientes-200.xlsx`, cuyas cédulas «ya existían» son las de la base demo del backend;
  - el aviso de espacio se comprobó como pasaría en una demo: una lista de 4.500 pacientes con notas
    largas cabe (los datos pasan de 0,73 M a 4,94 M caracteres; el tope de `localStorage` en Chrome es
    5,24 M) y una segunda igual da «La demo no tiene espacio…», con todo lo de antes intacto.

## Pendientes y riesgos

- **Beta:** guarda todo en `localStorage` (unos 5,24 M caracteres en Chrome). Con unos 4.500 pacientes
  con notas largas ya no cabe otra lista igual, y lo dice; para seguir con la demo, un archivo más
  pequeño o «Restablecer datos demo» (Configuración del super admin).
- **Archivos raros:** un .xlsx con fórmulas sin el valor calculado las lee vacías, y un CSV en otra
  codificación puede mostrar letras raras. Se ve en la revisión antes de importar.
- **Otros países:** a una cédula de 9 dígitos sólo se le vuelve a poner el 0 en Ecuador.
- **La dependencia nueva** (`read-excel-file`: un solo autor y versiones frecuentes): versión fija y
  `npm audit` sin avisos; subirla sólo a propósito, repitiendo el recorrido.
- **No probado en producción:** la migración 039 sobre la base real. Se aplicó limpia sobre la base
  local con los datos demo y en cada `npm test`.
- **Spec 011:** se hace en otra copia y toca los mismos archivos (tipos compartidos, avisos del cron,
  `columns.ts`, `seed-data.ts`, `business-routes.ts`). Al fusionar, revisar esos archivos y volver a
  pasar `npm run sync:shared`, `npm run typecheck` y `npm test`.

## Ampliación del 2026-10-15: «Importar también los que tienen datos por completar»

Antes de publicar, el dueño probó qué pasaba con una lista real: pacientes con y sin cédula, email o
teléfono. Con los datos obligatorios de fábrica (cédula y email), de 10 pacientes entraban 3. Pidió que
los incompletos entren marcados «Por completar» y que baste el nombre (constitución 1.11.0, R13–R18).

**Qué cambia:**
- **La revisión** cuenta aparte «N con datos por completar», con la fila y lo que falta.
- **La casilla** «Importar también los que tienen datos por completar» viene encendida.
- **El resultado** tiene «Ver los por completar».
- **En Clientes** hay un filtro «Por completar» (con su estado vacío «Nadie por completar»), y la
  marca en la lista y en las tarjetas.
- **La ficha** dice «Faltan datos: cédula y email», con «Completar».
- **El formulario** no cambia. Al guardar el paciente completo, la marca desaparece.

| Requisito | Resultado | Cómo se comprobó |
|---|---|---|
| RF-012 – La revisión cuenta aparte los incompletos y ofrece la casilla | Cumple | Recorrido del front y de la beta (79 de 79 cada uno): «5 con datos por completar», con la fila y lo que falta, y la casilla encendida |
| RF-013 – Basta el nombre; lo mal escrito sigue con error | Cumple | `client-import`: con la casilla entran 9 de los 10 del archivo de prueba (la cédula mal escrita, no); una fila sin nombre no entra; lo mal escrito sigue con error |
| RF-014 – «Por completar» en Clientes y en la ficha; desaparece al completar | Cumple | Recorrido: el filtro y la marca; en las fichas de Carla y Elena, al completar el email o la cédula y el email, desaparecen el aviso y la marca |
| RF-015 – Los datos obligatorios no cambian | Cumple | Recorrido: el formulario sigue pidiendo el email de Carla al guardar; `client-import`: sin la casilla (y sin `includeIncomplete` en la petición) el resultado es el de antes |

Además, `client-import` comprueba:
- dos filas con el mismo nombre y nada más: la segunda sale «repetida»;
- repetir la importación no duplica, tampoco a los que no tienen cédula;
- el tope del plan cuenta a los por completar;
- el resumen de la actividad («… 5 por completar»);
- no sale ningún email.

En total, 27 comprobaciones nuevas (la suite tiene 93).

**Cambios respecto al plan:**
- **`missingRequiredFields`** devuelve las claves (`documentId`, `email`…). Los textos («Falta la
  cédula y el email») los arma el front.
- **Sin la casilla** se usa exactamente el esquema de antes, así que los motivos son idénticos.
- **Los pacientes «Por verificar»** (spec 009) no se marcan «Por completar» aunque no tengan cédula. La
  tienen vacía a propósito, y lo que toca con ellos es unirlos a su ficha.
- **Añadidos pequeños:** la cifra «Por completar» en la revisión, «Ver los por completar», una frase en
  el paso del archivo y el estado vacío del filtro.

**Sin comprobar:** Clientes con los roles Recepción y Profesional (es la misma página).

**Commits:** «Spec 012: importar también los que tienen datos por completar» en el backend y en el
front. La beta queda en su carpeta, con la copia previa `beta-src-antes-012b.tgz`.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 7e429cb | Spec 012: importar pacientes desde Excel o CSV (backend) |
| agenda-front | 551f93e | Spec 012: importar pacientes desde Excel o CSV |

Este reporte, `tasks.md` y el estado de la spec van en un commit aparte del backend. Todo en la rama
local `trabajo-012` de cada copia, para fusionarlo en `dev`. La beta no tiene git: sus cambios están en
su carpeta (y la copia de antes, en `beta-src-antes-012.tgz`); su cierre en este reporte y en
`tasks.md` va en otro commit del backend.

## Cómo publicarlo

**El orden importa:** la migración va antes del backend, y el backend antes del front. Si el front
saliera primero, el botón llamaría a una ruta que todavía no existe.

1. **Migración 039,** como paso aparte, antes del PR del backend. Si se publica junto con las specs
   010 y 011, el mismo comando aplica también la 037 y la 038:

   ```
   cd ~/Documentos/Proyectos/Backend/agenda-backend
   npm run db:migrate
   ```

2. **Comprobar que quedó aplicada,** con una consulta de sólo lectura en el editor SQL de Supabase:

   ```
   begin read only;
   select name, applied_at from schema_migrations order by name desc limit 3;
   rollback;
   ```

   Debe aparecer `039_client_import.sql`.
3. **PR `dev` → `main` del backend.** Al publicarse, abrir esta dirección y ver `"ok":true`:

   ```
   https://agenda-backend-lemon.vercel.app/api/health
   ```

4. **PR `dev` → `main` del front.** Al publicarse, mirar sin importar nada: Clientes muestra
   «Importar pacientes» y la plantilla se descarga.
5. **Constitución:** ya está en 1.7.0 con el texto de esta spec; no cambia.
6. **Beta:** ya está actualizada en su carpeta (sin git).

No hay variables nuevas en Vercel ni en GitHub.

## Texto para el PR

**Backend:**

> Spec 012: importar pacientes desde Excel o CSV. Ruta nueva `POST /businesses/:id/clients/import`
> (propietario, administradores y modo soporte; JSON de hasta 4 MB y 20 importaciones cada 15 min):
> crea en una transacción los pacientes válidos y nuevos con origen «import», sin emails, con una
> entrada en la actividad y un aviso de ntfy por importación. **Migración 039** (aplicarla antes).
> Reporte: `specs/012-importar-pacientes/reporte.md`.

**Front:**

> Spec 012: «Importar pacientes» en Clientes. Se elige un Excel o un CSV (o la plantilla), se asignan
> las columnas y se revisa qué se importará antes de importar. El archivo se lee en el navegador; el
> lector de Excel (`read-excel-file` 9.3.12, versión fija) se descarga sólo en esa pantalla. Publicar
> después del backend. Reporte: `agenda-backend/specs/012-importar-pacientes/reporte.md`.
