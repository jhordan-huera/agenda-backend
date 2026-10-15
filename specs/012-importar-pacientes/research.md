# Decisiones técnicas: Importar pacientes desde Excel o CSV

Cada decisión tiene tres partes: qué se eligió, por qué y qué otras opciones se descartaron. Los
números (R1…) se citan en el [plan](./plan.md).

## R1. Quién puede importar: un permiso nuevo

- **Decisión:** permiso nuevo `clients.import` en `src/lib/permissions.ts`, el archivo compartido del
  front que se copia al backend.
  - **Quién lo tiene:** `owner` (lo tiene todo, por `ALL_PERMISSIONS`) y `admin`. `staff` (Recepción)
    y `professional`, no.
  - **El super admin en modo soporte** actúa como `owner` en `authorize` (`context.ts`) y en la sesión
    del front (`session-provider.tsx`), así que lo tiene sin nada más.
  - **La API** lo exige con `authorize(db, ctx, businessId, "clients.import", { lock: true })`. Sin él
    responde 403 «Tu rol no tiene permisos para realizar esta acción.», como hoy.
  - **El front** muestra el botón y la pantalla con `can("clients.import")` (`use-permissions.ts`).
    Quien entra por la dirección sin el permiso ve un aviso y el enlace de vuelta a Clientes.
- **Por qué:** es «una tarea de puesta en marcha» (spec), y el permiso deja claro qué se comprueba en
  los dos lados.
- **Descartado:**
  - **Reutilizar `clients.delete`:** hoy lo tienen los mismos roles, pero significa otra cosa. Si un
    día cambia uno, cambiaría el otro sin querer.
  - **Mirar el rol a mano en la ruta:** se saltaría la tabla única de permisos.

## R2. La pantalla de importar

- **Dónde:** una página propia, `/dashboard/clients/importar`
  (`src/pages/dashboard/client-import-page.tsx`).
  - Se carga como las demás páginas, con `lazyPage` en `router.tsx`.
  - La ruta fija gana a `clients/:id` en React Router.
  - **Los botones de Clientes** (`clients-page.tsx`):
    - «Importar pacientes» (secundario) junto a «Nuevo cliente»;
    - también en el estado vacío «Aún no tienes clientes», que es cuando más sirve.
- **Paso 1, archivo:**
  - `<input type="file" accept=".xlsx,.csv">` con su etiqueta, y en el escritorio también arrastrar y
    soltar;
  - el archivo, de hasta 10 MB;
  - el enlace «Descargar plantilla» (R9);
  - qué datos son obligatorios en este negocio, de `clientRequiredFieldsOf(business)`, por ejemplo:
    «Para tu negocio son obligatorios el nombre, la cédula y el email».
- **Paso 2, hoja y columnas:**
  - **La hoja:** si el Excel tiene varias, un `Select` con su nombre. Por defecto, la primera con
    datos.
  - **La fila de títulos:** la primera de las 10 primeras filas con al menos dos títulos reconocidos;
    si ninguna, la primera fila con datos. Así se salta un título como «Lista de pacientes 2025».
  - **Una tarjeta por columna:** su título, dos valores de ejemplo y un `Select` con el destino:
    - Nombre completo, Nombres, Apellidos;
    - Cédula, Email, Teléfono, Dirección, Notas;
    - «Añadir a las notas»;
    - «No importar».

    Las tarjetas van en una columna en el celular, sin tablas anchas.
  - **El destino sugerido** sale de los nombres habituales (R5, `guessColumns`). Lo que no se reconoce
    queda en «No importar».
  - **«Nombres» + «Apellidos»** en columnas separadas se unen con un espacio. Si además hay una columna
    «Nombre completo», manda esa.
  - **«Añadir a las notas»** se puede elegir en varias columnas. Cada una entra como una línea
    «Título: valor», detrás de la columna Notas. Por ejemplo, «Fecha de nacimiento: 12/03/1990».
  - **Un dato, una columna:** cada uno (salvo «Añadir a las notas») sale de una sola. Si se elige el
    mismo en otra columna, la primera pasa a «No importar».
  - **Hace falta una columna de nombre** (completo, o nombres y apellidos) para seguir.
- **Paso 3, revisión:**
  - **Cinco cifras con su texto:**
    - «Se importarán N»;
    - «Ya existían N»;
    - «Con errores N»;
    - «Repetidas en el archivo N»;
    - «No entran por el tope de tu plan N».
  - **La lista de lo que no entra:** «Fila 12 · La cédula no es válida. Revisa el número.». En «ya
    existía» va el nombre del paciente del negocio, de la lista que ya tiene el panel
    (`useClients`). Se muestran las 50 primeras y un botón para ver todas.
  - **«Descargar las filas con errores»:** un CSV con la fila, el motivo y los datos de la fila, con
    `toCsv` (R4). Queda en el equipo de quien lo descarga; es la lista del propio negocio.
  - **El tope del plan,** de `usePlanUsage`: «Tu plan permite N pacientes más: se importarán los N
    primeros. Para ampliarlo, escríbenos a…» (`PlanLimitContact`, como `plan-limit-banner.tsx`).
  - **«Importar N pacientes»,** desactivado si N es 0 o mientras se envía.
- **Resultado:**
  - **El aviso de `sonner`:** «Se importaron N pacientes».
  - **El resumen de la API** (`ClientImportResult`), con el mismo detalle que la revisión. Si alguien
    creó un paciente entretanto y la cifra cambió, manda la de la API.
  - **«Ver ficha»** en los que ya existían.
  - **«Ver pacientes»** para volver a la lista. La caché se recarga con `queryKeys.clients` y
    `useInvalidateActivity` (uso del plan y actividad).
  - **Accesibilidad:** el resumen va en `role="status"`, para el lector de pantalla.
- **Sin borrador:** nada del archivo ni de las filas se guarda en `localStorage`, `sessionStorage` ni
  IndexedDB. Son datos de pacientes (principio II). Si se cierra la pantalla, se empieza otra vez.
- **Sin conexión o sin respuesta:** si `apiRequest` lanza `network`, la pantalla dice: «No sabemos si
  la importación terminó. Revisa la lista de pacientes o vuelve a importar el mismo archivo: los que
  ya se importaron no se repiten.» (R6).
- **Descartado:**
  - **Un diálogo,** como el de «Nuevo cliente»: la revisión de miles de filas no cabe en el celular.
  - **Una tabla con todas las filas:** obliga a desplazarse de lado a 390 px (CE-004).

## R3. Leer el Excel: `read-excel-file`

**Lo comparado** (consultado el 2026-10-14 en npm y en la base de avisos de seguridad de npm):

| | read-excel-file 9.3.12 | SheetJS CE 0.20.3 | ExcelJS 4.4.0 | Lector propio |
|---|---|---|---|---|
| Licencia | MIT | Apache-2.0 | MIT | — |
| Última versión | 2026-10-07 (12 versiones en 2026) | 2024. Sólo en cdn.sheetjs.com: en npm se quedó en 0.18.5 | 2023-10 | — |
| Avisos de seguridad | Ninguno, tampoco en sus dependencias (fflate, saxen, worker-f, unzipper-esm) | En npm (0.18.5), dos altos: contaminación de prototipos (<0.19.3) y ReDoS (<0.20.2). La 0.20.3, ninguno | El paquete, ninguno. Sus dependencias, sí: `uuid@8` (moderado) y `tmp` (alto) | — |
| Peso comprimido en el navegador | ~14 KB | 86 KB (mini), 335 KB (completo) | 256 KB | ~3 KB |
| Lee | .xlsx | .xlsx, .xls, .ods y más | .xlsx | lo que se programe |

- **Decisión:** `read-excel-file`, sólo para .xlsx, con la versión fija (`"read-excel-file":
  "9.3.12"`, sin `^`) en el front y en la beta.
  - **Cuándo se carga:** con `await import("read-excel-file/browser")` en
    `src/features/clients/import/read-spreadsheet.ts`, sólo al elegir un .xlsx. Es un import dinámico,
    como el mapa.
  - **El trozo de JavaScript:** Vite lo separa en su propio archivo. Ni la carga del panel ni la
    página de importar lo descargan hasta ese momento. El service worker lo guarda con los demás
    archivos de la versión (son unos 15 KB) y no cambia nada de su configuración.
  - **Workers:** la librería lee el archivo en un worker que crea desde un `blob:`, para no congelar
    la pantalla. La CSP del front ya permite `worker-src 'self' blob:` (está por MapLibre), así que
    `vercel.json` no cambia. No usa `eval` ni `new Function` (revisado en el paquete).
  - **Cómo se lee:** `readExcelFile(file)` devuelve `[{ sheet, data }]`, una entrada por hoja, y
    `data` es una fila por cada fila de la hoja.
    - **Fórmulas:** se lee el valor calculado que guardó Excel, que es «el valor que se ve».
    - **Filas vacías:** sólo descarta las del final. Así el número de fila es el que muestra Excel; se
      comprueba con un archivo de prueba que empieza con un título y tiene filas vacías.
- **Cada celda se pasa a texto** (`cellText`):
  - **texto:** igual, ya recortado por la librería;
  - **número:** con `String(n)`; 912345675 → «912345675» (el 0 lo devuelve R5);
  - **fecha (`Date`):** «dd/mm/aaaa», en UTC para que no cambie el día;
  - **sí/no:** «Sí» o «No»;
  - **vacía o error de Excel** (`#N/A`, `#REF!`, `#VALUE!`, `#DIV/0!`, `#NAME?`, `#NUM!`, `#NULL!`): «».
- **Errores del archivo:**
  - un `.xls`, `.ods` o `.numbers` no se lee, y se pide «Guárdalo como .xlsx o .csv desde Excel
    (Archivo → Guardar como)»;
  - un .xlsx con contraseña, o dañado, da «No se pudo leer el archivo. Ábrelo en Excel y guárdalo de
    nuevo como .xlsx.».
- **La cadena de suministro:**
  - versión fija, y `package-lock.json` con su `integrity`;
  - `npm audit` al instalarla, en el front y en la beta;
  - se sube de versión sólo a propósito, con las pruebas de [quickstart.md](./quickstart.md).

  Las dependencias `unzipper-esm`, `graceful-fs` y `node-int64` son sólo para Node: se instalan, pero
  no entran en lo que se descarga en el navegador.
- **Descartado:**
  - **SheetJS:** es el más completo, pero pesa seis veces más. Además, la versión sin avisos sólo se
    instala desde una dirección propia: `npm audit` y Dependabot no la siguen, y no saca versiones
    desde 2024.
  - **ExcelJS:** 256 KB, sin versiones estables desde 2023, y con dependencias con avisos.
  - **Un lector propio** (con `DecompressionStream` y XML a mano): son cientos de líneas y muchos
    casos raros:
    - los textos compartidos y el texto con formato;
    - las fechas según el formato de la celda, y la época de 1904;
    - los archivos «Strict OpenXML» y los acentos.

    El historial de `read-excel-file` de este año muestra cada uno de esos arreglos.

## R4. Leer el CSV: un lector propio en `src/lib/csv.ts`

- **Decisión:** `parseCsv(text): string[][]` y `decodeCsv(bytes): string`, en unas 70 líneas, sin
  dependencias.
  - **Codificación:**
    - primero UTF-8 estricto: `new TextDecoder("utf-8", { fatal: true })`, quitando el BOM;
    - si falla, Windows-1252.

    Excel en Windows guarda «CSV (delimitado por comas)» en Windows-1252, y sólo «CSV UTF-8» en
    UTF-8. Sin esto, «Peña» saldría «PeÃ±a» o con «�».
  - **Separador:** se cuenta en la primera línea (fuera de comillas) cuántos `;`, `,` y tabuladores
    hay, y se usa el que más aparezca; si empatan, `,`. Excel en español usa `;`.
  - **Comillas** (RFC 4180):
    - un campo entre comillas puede tener el separador y saltos de línea;
    - `""` es una comilla.
  - **Fin de línea:** `\r\n`, `\n` o `\r`. Una última línea vacía se ignora.
- **`toCsv(rows)`:** pasa a este archivo desde `features/activity/export-audit.ts`. Usa `;` y BOM
  UTF-8, como lo espera Excel en español, y neutraliza las celdas que empiezan por `= + - @`.
  `export-audit.ts` lo reutiliza, y la revisión lo usa para «Descargar las filas con errores».
- **Por qué:** es poco código, se comprueba con un guion de Node y cubre lo que de verdad sale de
  Excel y de Google Sheets.
- **Descartado:** PapaParse 5.7.0 (MIT, ~7 KB comprimido). Hace mucho más de lo necesario (lectura
  por partes, workers, conversión de tipos), y no resuelve la codificación de Windows: también habría
  que hacerlo aparte.

## R5. Las reglas de cada fila: un módulo compartido

- **Decisión:** `src/lib/validations/client-import.ts`, en el front, copiado al backend con
  `npm run sync:shared`.
  - **Para crear la copia:** `sync-shared.ts` sólo actualiza los archivos que ya existen en
    `src/shared`. Antes de la primera copia se crea vacío
    `agenda-backend/src/shared/lib/validations/client-import.ts`.
  - **Lo usan los dos lados:** la revisión del front y la API ejecutan la misma `classifyImportRows`,
    así que lo que se ve en la revisión es lo que hace la API (principio V).
- **Nombres habituales de las columnas** (`guessColumns`). El título se compara en minúsculas, sin
  tildes, sin signos y con los espacios juntos:

  | Destino | Títulos que se reconocen |
  |---|---|
  | Nombre completo | nombre, nombre completo, nombres y apellidos, apellidos y nombres, paciente, cliente, nombre del paciente |
  | Nombres | nombres |
  | Apellidos | apellidos, apellido |
  | Cédula | cedula, ci, c i, cedula de identidad, numero de cedula, nro cedula, identificacion, documento, dni |
  | Email | email, e mail, correo, correo electronico, mail |
  | Teléfono | telefono, celular, movil, whatsapp, telf, tel, numero de telefono |
  | Dirección | direccion, domicilio |
  | Notas | notas, nota, observaciones, comentarios |

  Si dos columnas sugieren el mismo dato, se queda la primera.
- **Limpieza** (`prepareImportRow`). Se puede aplicar dos veces sin cambiar nada:
  - **Todos los datos:** se recortan, y los espacios seguidos se juntan en uno (en las notas, sólo al
    principio y al final).
  - **Cédula:** `normalizeDocumentId` de hoy, que quita espacios, puntos y guiones («0912-345675» →
    «0912345675»). Las letras quedan, para que la validación las rechace.
    - **El 0 inicial:** si el negocio es de Ecuador y quedan 9 dígitos, se prueba con un 0 delante. Si
      `isValidEcuadorianCedula` la acepta, se usa; si no, queda como estaba y dará su error.
  - **Teléfono:**
    - si la celda trae varios separados por `/`, `,`, `;`, `|` o « y », el primero va al teléfono y
      los demás a las notas («Otros teléfonos: …»);
    - el punto se cambia por un espacio («099.123.4567»), porque `phoneField` no lo admite.

    El resto queda como lo escribió el negocio, como en el formulario. `comparablePhone` (reserva
    online) y `toWhatsAppNumber` ya entienden el número sin el 0 o con el prefijo.
  - **Email:**
    - lo mismo con varios separados por `,`, `;`, espacio o `/` («Otros emails: …»);
    - las minúsculas las pone el esquema de hoy.
  - **Notas:** la columna Notas, después «Otros teléfonos» y «Otros emails», y después las columnas
    «Añadir a las notas», una por línea.
- **Validación:**
  - `clientSchemaFor(clientRequiredFieldsOf(business))` con `isActive: true`;
  - y, si hay cédula, `documentIdError(documentId, business.timezone)`.

  Son exactamente las del formulario (`client-form-dialog.tsx`) y las de `clientService.create`.
  - **El motivo** es el primer mensaje del esquema, que ya nombra el dato: «La cédula es
    obligatoria», «Ingresa un email válido», «La cédula no es válida. Revisa el número.». Los que no
    lo nombran («Máximo 200 caracteres») llevan delante el dato: «Dirección: máximo 200 caracteres».
  - **Nunca repite el valor de la celda.**
- **Clasificación** (`classifyImportRows`), en el orden del archivo. Cada fila acaba en una sola
  categoría:
  1. **Vacía** (todos los datos asignados en blanco): se ignora y no cuenta.
  2. **Con error:** no pasa la validación.
  3. **Ya existía:** su clave está entre los pacientes del negocio. No se cambia nada.
  4. **Repetida:** su clave ya salió en una fila válida anterior del archivo. Se dice cuál.
  5. **Tope del plan:** ya no queda cupo (`remaining`).
  6. **Se crea.**
- **La clave de «el mismo paciente»:**
  - **Con cédula:** la cédula. Además, una fila con cédula «ya existía» si coincide como en el punto
    siguiente con un paciente antiguo **sin** cédula. Así no se duplica a quien se registró antes de la
    cédula. No se le pone la cédula: el negocio la completa en su ficha.
  - **Sin cédula** (sólo donde es opcional): el nombre (en minúsculas y sin tildes), el email y los
    dígitos del teléfono. Deben coincidir los tres; vacío con vacío también coincide.

  Con esto, volver a importar el mismo archivo da siempre «ya existían» (R6), también sin cédula.
- **Por qué en el navegador y en la API:**
  - el navegador da la revisión al momento, sin subir nada;
  - la API no se fía y vuelve a revisarlo todo con el mismo código.

  La lista de pacientes (`useClients`) y el uso del plan (`usePlanUsage`) ya están en el panel: al
  propietario y a los administradores la lista les llega entera.
- **Descartado:**
  - **Hacer la revisión en la API:** la lista viajaría dos veces y gastaría CPU de Vercel sin
    necesidad.
  - **Revisar sólo en el front:** la API nunca se fía del navegador.
  - **Completar con la importación los datos que faltan a un paciente que ya existe:** la spec dice
    que no se cambia.

## R6. Enviar e importar: una sola petición, todo o nada

- **Decisión:** `POST /api/businesses/:businessId/clients/import` con todas las filas no vacías, con
  sus errores incluidos (ver [contracts/api.md](./contracts/api.md)). La API lo hace todo en una
  transacción, en `src/services/client-import-service.ts`:
  1. `authorize(db, ctx, businessId, "clients.import", { lock: true })`: bloquea la fila del negocio
     hasta el final. Las altas del panel y las reservas de ese negocio esperan; así nadie se cuela en
     el último cupo del plan;
  2. lee `timezone` y `client_required_fields` del negocio;
  3. lee los pacientes que pueden coincidir: los que tienen alguna de las cédulas de las filas, y los
     que no tienen cédula. De cada uno, `id`, `document_id`, `name`, `email` y `phone`;
  4. calcula el cupo con `remainingClientSlots(db, businessId)`, nueva en `plan-limits.ts`. Es el
     límite del plan menos `countClients`; `null`, sin límite;
  5. `classifyImportRows`, el mismo código que la revisión (R5);
  6. inserta las nuevas en una sola sentencia:

     ```sql
     insert into clients (business_id, name, document_id, email, phone, address, notes, is_active, created_by, source)
     select $1, r.name, r.document_id, r.email, r.phone, r.address, r.notes, true, $2, 'import'
       from jsonb_to_recordset($3::jsonb) as r(name text, document_id text, email text, phone text, address text, notes text)
     on conflict (business_id, document_id) where document_id <> '' do nothing
     returning id, document_id
     ```

     El `on conflict` usa el índice único de cédula por negocio (migración 006). Con el bloqueo no
     debería saltar nunca, pero si salta, esa fila pasa a «ya existía» en vez de fallar;
  7. si se creó al menos uno, registra la actividad (R7);
  8. responde con `ClientImportResult`.
- **Si se corta la conexión** (RF-008):
  - si la transacción no terminó, no queda nada;
  - si terminó, al repetir la importación todas cuentan como «ya existían», por la cédula o por la
    clave sin cédula (R5);
  - un doble clic o dos pestañas no duplican: el bloqueo pone una importación detrás de la otra, y la
    segunda ve lo que creó la primera.
- **Tamaño:**
  - **Medido:** 5.000 filas con datos normales, y notas de 300 caracteres en un tercio de ellas,
    ocupan 1,33 MB en JSON. Validarlas con `clientSchemaFor` y `documentIdError` tarda 21 ms en este
    equipo.
  - **El front** mide los bytes del JSON con `TextEncoder` antes de enviar. Si pasa de 3,5 MB, pide
    partir el archivo.
  - **La API:**
    - en `app.ts`, el `express.json({ limit: "2mb" })` de todas las rutas se salta esta ruta (un
      `POST` que cumple `^/api/businesses/[^/]+/clients/import$`);
    - la ruta, en `business-routes.ts`, primero exige la sesión (`requireUser(req.ctx)`, para que un
      anónimo no haga leer 4 MB), después aplica `limitRequests` y por último lee el cuerpo con
      `express.json({ limit: "4mb" })`;
    - el límite es `name: "importar-pacientes"`, 20 cada 15 minutos por conexión, con el mensaje
      «Demasiadas importaciones seguidas. Espera unos minutos.».

    Vercel corta en 4,5 MB por petición, y Lambda en 6 MB.
  - **Más de 5.000 filas** en el cuerpo: 400.
- **Por qué una sola petición:**
  - lo que crea una importación queda junto: una entrada en la actividad y un aviso;
  - no hay importaciones «a medias» que haya que cerrar después, ni una tabla para seguirlas;
  - 5.000 filas caben de sobra.
- **Descartado:**
  - **Lotes de 200 a 500 filas:** cada lote sería una transacción, así que un corte dejaría una
    importación a medias. Para dar una sola entrada de actividad haría falta una tabla de
    importaciones, un «terminar» y que el cron cerrara las abandonadas.
  - **Subir el archivo a la API y leerlo allí:** el archivo pasaría por el servidor (la spec dice que
    se lee en el navegador), gastaría CPU de Vercel y la librería entraría también en el backend.
  - **Subir el límite de 2 MB a toda la API:** no lo necesita nadie más.

## R7. Actividad y emails

- **Actividad:** acción nueva `client.imported`, con `entity_type: 'client'` y `entity_id` en
  `null`, porque es de muchos pacientes. El resumen lo arma `importSummary` (compartido):
  - **El texto:** «Importó 200 pacientes (3 ya existían, 5 con errores)».
  - **Las partes:**
    - sólo las que pasan de cero, en este orden: ya existían, con errores, repetidas en el archivo,
      por el tope del plan;
    - en singular cuando es una: «Importó 1 paciente».
  - **Sin nombres.**
  - **El autor** es el de siempre: el usuario, o «Nombre (Super admin)» en modo soporte.
  - **Sólo si se creó al menos uno.** Si todos ya existían, no se registra nada, igual que una
    consulta.
  - **Filtros:** la entrada sale en Actividad con el filtro «Clientes» (`AUDIT_TYPE_LABELS.client`)
    y en la exportación a CSV, sin cambios en el panel.
- **Emails:** ninguno.
  - `clientService.create` no pone emails en cola, y la importación tampoco llama a
    `notifications.ts`.
  - La prueba lo comprueba contando `notifications` antes y después.
- **La importación como entidad:**
  - **Quién y cuándo:** la entrada de actividad.
  - **Qué pacientes:** los de `source = 'import'` con el mismo `created_at`, porque la transacción usa
    un solo `now()`, igual que la entrada.
  - **El archivo y las columnas asignadas** no se guardan (spec, «Supuestos»).

## R8. Avisos por ntfy: uno por importación

- **Los importados no inundan el aviso de «paciente nuevo»:** `findPanelClients`
  (`booking-alerts.ts`) ya filtra `c.source = 'dashboard'`, así que los de `source = 'import'` no
  salen uno por uno.
  - **Sin cambiar esa consulta;** sólo se documenta en su comentario.
  - **Una prueba lo comprueba.**
- **El aviso nuevo:** `findClientImports(db, since, until, limit = MAX_IMPORT_NOTICES)` busca en
  `audit_logs` las acciones `client.imported` en (since, until], igual que `findStatusChanges`. Con
  el negocio y quién la hizo, `clientImportNotice` arma:
  - **Título:** «Agenda360: pacientes importados», sin el negocio.
  - **Mensaje:**
    - el nombre del negocio;
    - el resumen de la actividad, que sólo tiene cifras: «Importó 200 pacientes (3 ya existían, 5 con
      errores)»;
    - «Desde el panel por Ana T. (Propietario)», o «por el super admin (modo soporte)», con `byWhom`.
  - **Prioridad** 3, etiqueta `inbox_tray` y `click` a `/admin/businesses/<id>`.
  - **Tope:** 10 por pasada (`MAX_IMPORT_NOTICES`), y del resto, la cifra: «…y N importaciones más».
- **El cron** (`scheduled-tasks.ts`) suma al informe `clientImports` e `importNotices`.
  - **`buildBookingNotices`** (`scripts/cron.ts`) los añade después de los pacientes nuevos.
  - **La línea del registro** gana «importaciones: N», que sólo es una cifra.
- **Por qué:** la API no manda nada a ntfy (principio VI), igual que el resto de avisos.
- **Descartado:**
  - **Contarlos como «…y N pacientes nuevos más»:** mezclaría dos cosas distintas.
  - **Mandar el aviso desde la API al importar:** pondría el tema de ntfy en Vercel; el dueño ya lo
    descartó el 2026-10-12.

## R9. La plantilla

- **Decisión:** un archivo fijo, `public/plantilla-pacientes.xlsx` (unos 5 KB), en el front y en la
  beta.
  - **Una hoja «Pacientes»** con los títulos en negrita: Nombre, Cédula, Email, Teléfono, Dirección y
    Notas.
  - **Columnas con su ancho.** Las de Cédula y Teléfono, con formato de texto (`numFmtId` 49, «@»),
    para que Excel no borre el 0 inicial al escribir.
  - **Sin filas de ejemplo:** si se dejaran, se importarían. La pantalla muestra al lado un ejemplo de
    fila rellena y qué datos son obligatorios en el negocio.
- **Cómo se hace:**
  - una sola vez, con un guion del scratchpad en Python, sólo con la biblioteca estándar (`zipfile` y
    el XML mínimo de un .xlsx);
  - el archivo se guarda en el repositorio. Este punto deja escrito su contenido para poder rehacerlo;
  - se comprueba leyéndolo con la propia pantalla y abriéndolo en Excel o Numbers.
- **Cómo se sirve:**
  - el service worker no lo guarda, porque `globPatterns` no incluye `.xlsx`;
  - Vercel sirve los archivos de `public/` antes que la regla que manda todo a `index.html`, como
    `early-data.js` o el manifiesto.
- **Descartado:**
  - **Un CSV hecho en el navegador** (con `toCsv`): Excel lo abre en una sola columna si la
    configuración del equipo no usa `;` (por ejemplo, en México), y borra el 0 al escribir la cédula.
  - **Una librería para escribir .xlsx:** sería una dependencia más sólo para un archivo que no
    cambia.

## R10. El origen «importado» y las cifras del Inicio

- **Migración 039** (ver [data-model.md](./data-model.md)): el check de `clients.source` admite
  `'import'`.
- **`Client.source`** (`'dashboard' | 'booking_page' | 'import'`): se añade a `clientColumns`
  (`src/db/columns.ts`) y al tipo compartido `Client`.
  - **En la beta**, el repositorio de prueba lo rellena con `'dashboard'` si falta.
  - **La ficha no muestra ninguna marca nueva,** igual que hoy con los de la página de reservas
    («quedan marcados en su origen», spec).
- **Lo que no cambia:**
  - **Tope del plan:** `countClients` cuenta todos menos los de la página sin citas activas. Los
    importados cuentan, porque son pacientes reales.
  - **Las reglas de la reserva online:** el tope de pacientes nuevos por día y los emails del público
    (`email-limits.ts`) miran `source = 'booking_page'`, así que no les afecta.
- **Pacientes nuevos del mes (pendiente de la pregunta 1 del plan).** Propuesta: los importados no
  cuentan.
  - **Inicio del negocio:** en `getDashboardMetrics` (`features/dashboard/dashboard-metrics.ts`),
    `newClientsThisMonth` pasa a contar con `c.source !== "import"`.
  - **Inicio del super admin:** en `platformGrowth` (`admin-service.ts`), `clientsCurrent`,
    `clientsPrevious` y la serie diaria del gráfico añaden `c.source <> 'import'`.

  El total de pacientes del negocio sigue contándolos.
  - **Si el dueño prefiere que cuenten:** se quitan estos dos cambios y `Client.source`. La migración
    sigue haciendo falta.

## R11. Privacidad y registros

- **El archivo:**
  - lo lee el navegador, y la librería trabaja en el propio navegador;
  - no se sube, no se guarda y no se cachea;
  - la petición lleva sólo los seis datos de cada fila y su número.
- **En la API:**
  - no se registra ninguna fila;
  - `errorForLog` ya omite los datos de PostgreSQL;
  - los motivos de error no repiten valores;
  - la respuesta devuelve números de fila y `id` de pacientes del propio negocio, no datos.
- **El aviso de ntfy y la línea del registro de GitHub Actions** llevan sólo cifras, el nombre del
  negocio en el mensaje (como los demás avisos) y quién lo hizo, a medias.
- **La analítica** ve la ruta `/dashboard/clients/importar`, sin identificadores.
- **Las pruebas** usan archivos inventados en el scratchpad, con cédulas generadas por el algoritmo,
  como `tests/helpers/cedula.mjs`. Nunca listas reales.

## R12. Beta

- **Decisión:** la misma pantalla y las mismas reglas.
  - **Se copian:**
    - `client-import-page.tsx` y `features/clients/import/*`;
    - `lib/csv.ts` y `lib/validations/client-import.ts`;
    - `permissions.ts` y los tipos;
    - la plantilla.

    La beta ya tiene sus copias de `identity.ts` y `validations/client.ts`.
  - **La dependencia:** `read-excel-file` 9.3.12, también con la versión fija.
  - **`mockClientRepository.importMany`** (`lib/data/mock/business-data-repository.ts`) hace lo mismo
    que la API con `classifyImportRows`:
    - los pacientes del negocio y el cupo de `plan-limits.ts` (`countClients`);
    - crea los válidos con `source: "import"` (el tipo `StoredClient` lo admite);
    - registra `client.imported` con `importSummary`.

    En la beta no hay ntfy.
  - **Espacio:** `writeDb` guarda todo en `localStorage`, y si no cabe lanza el error «storage». La
    importación lo convierte en «La demo no tiene espacio para tantos pacientes: prueba con un archivo
    más pequeño.»
- **Por qué:** RF-011, y la beta sirve para las demostraciones de venta.

---

# Ampliación del 2026-10-15: «Importar también los que tienen datos por completar»

Pedida por el dueño del producto antes de publicar. En la prueba con una lista real (pacientes con y
sin cédula, email o teléfono), los datos obligatorios de fábrica dejaban fuera 6 de 10 pacientes.

## R13. «Por completar» se calcula, no se guarda

- **Decisión:** un paciente está «Por completar» si le falta algún dato que el negocio exige **hoy**
  (`client_required_fields`: cédula, email, teléfono o dirección). Lo dice una función compartida,
  `missingRequiredFields(client, required)`, en `src/lib/validations/client.ts`. Devuelve los datos
  que faltan («cédula», «email»…).
- **Por qué:**
  - sin migración ni columna nueva;
  - la marca desaparece sola al completar el paciente;
  - sigue a los datos obligatorios si el super admin los cambia;
  - sirve también para los pacientes que ya estaban incompletos de antes.
- **Descartado:** una columna `incomplete` en `clients`, que habría que mantener en cada edición y en
  cada cambio de los datos obligatorios.

## R14. La importación: una categoría más y una casilla

- **Decisión:**
  - **La categoría nueva:** `classifyImportRows` recibe `allowIncomplete`.
    - Cada fila se valida con las reglas del formulario **sin datos obligatorios** (sólo el nombre).
      Lo que viene se valida igual que hoy, y una cédula, un email o un teléfono mal escritos siguen
      con error.
    - Después se miran los que faltan con `missingRequiredFields`. Las filas a las que les falta algo
      van a la categoría nueva `incomplete`, con `{ row, missing }`.
  - **La casilla:**
    - con `allowIncomplete`, esas filas se crean (cuentan en `created` y siguen listadas en
      `incomplete`);
    - sin él, van a `errors` con el mismo motivo de hoy («La cédula es obligatoria»).
  - **La API** recibe `includeIncomplete` en el cuerpo de `POST …/clients/import`. Si no viene, vale
    `false`, así que una petición de hoy hace lo mismo. Vuelve a clasificar con la misma función: todo
    o nada, como en R6.
  - **La revisión del front** muestra «N con datos por completar», con la fila y lo que falta. La
    casilla «Importar también los que tienen datos por completar» viene **encendida**.
- **Por qué:** RF-012 y RF-013, sin tocar las reglas del formulario (RF-015).

## R15. Basta el nombre

- **Decisión:** con la casilla, una fila con sólo el nombre entra (decisión 2 de la ampliación).
- **Cómo se reconoce a la misma persona:** igual que hoy. Por la cédula si la tiene; si no, por el
  nombre, el email y el teléfono a la vez. Dos personas con el mismo nombre y sin ningún otro dato se
  toman por la misma, y la revisión lo muestra antes de importar.
- **Por qué:** lo eligió el dueño. El riesgo de confundir a dos personas se acepta y queda en los
  casos límite de la spec.

## R16. Clientes y la ficha

- **Decisión:**
  - **Clientes:** el filtro «Por completar» y la marca «Por completar» en cada fila de la lista y en
    las tarjetas del celular. Se calcula en el navegador con los datos obligatorios del negocio, que
    el panel ya tiene.
  - **La ficha del paciente:** el aviso «Faltan datos: cédula y email» con «Completar», que abre el
    formulario de siempre.
  - **El formulario** no cambia: sigue pidiendo los obligatorios al guardar (RF-015).
- **Por qué:** RF-014. Recepción y el rol Profesional también ven el filtro (ven Clientes), aunque no
  importan.

## R17. Actividad y ntfy

- **Decisión:**
  - **El resumen** suma «N por completar»: «Importó 200 pacientes (3 ya existían, 5 con errores,
    12 por completar)». El orden es: ya existían, con errores, repetidas, por completar y tope del
    plan.
  - **ntfy** sigue igual: un aviso con la cifra y sin nombres.
- **Por qué:** todo queda en la actividad (constitución 1.9.0).

## R18. Beta

- **Decisión:** lo mismo:
  - la casilla, el filtro y la ficha;
  - la repo mock usa `classifyImportRows` con `allowIncomplete`.
- **Por qué:** RF-011.
