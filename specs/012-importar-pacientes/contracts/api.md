# Contratos: Importar pacientes desde Excel o CSV

Lo que cambia en la API, en el código compartido, en la actividad y en los avisos. Lo que no está aquí
sigue igual.

## Rutas nuevas

### `POST /api/businesses/:businessId/clients/import`

Crea en una sola transacción los pacientes válidos y nuevos de una importación (R6). Los que ya
existían no se tocan, y no se envían emails.

**Antes de leer el cuerpo:**
- **La sesión:** sin ella, 401 sin leer nada.
- **El límite de peticiones:** 20 cada 15 minutos por conexión (`importar-pacientes`).
- **El cuerpo:** JSON de hasta 4 MB. El resto de la API sigue en 2 MB.
- **CSRF:** la cabecera `X-Requested-With: fetch`, como todas las escrituras.

**Cuerpo:**

```json
{
  "rows": [
    {
      "row": 2,
      "name": "María Fernanda López",
      "documentId": "0912-345675",
      "email": "mafer@example.com",
      "phone": "099 123 4567 / 042 345 678",
      "address": "Av. 9 de Octubre 123",
      "notes": "Fecha de nacimiento: 12/03/1990"
    }
  ]
}
```

- **`rows`:** de 1 a 5.000 filas. Son todas las filas no vacías de la hoja, también las que la
  revisión marcó con error, para que la API cuente lo mismo.
- **`row`:** entero, el número de fila en la hoja; no se repite en la misma petición.
- **Los demás campos:** texto de hasta 5.000 caracteres cada uno, y pueden ir vacíos. La API los
  limpia y los valida con las reglas de R5: las mismas que la revisión del front.

**Respuesta 200** (`ClientImportResult`):

```json
{
  "created": 192,
  "existing": [{ "row": 14, "clientId": "5b0c…" }],
  "repeated": [{ "row": 88, "firstRow": 31 }],
  "errors": [{ "row": 40, "reason": "La cédula no es válida. Revisa el número." }],
  "overLimit": []
}
```

- **Los números de fila** son los del cuerpo.
- **`reason`** nunca repite el valor de la celda.
- **`created` puede ser 0**, si todas ya existían, tenían error o no entraban por el tope. Entonces no
  queda entrada en la actividad ni aviso por ntfy.

**Errores:**

| Código | Cuándo |
|---|---|
| 400 `validation` | `rows` vacío, con más de 5.000 filas, con un número de fila repetido o con un campo de otro tipo o demasiado largo. |
| 400 `validation` | El cuerpo pasa de 4 MB, con el mensaje de hoy de `fromBodyParserError`. No debería verse: el front no manda más de 3,5 MB y avisa antes. |
| 401 `unauthorized` | Sin sesión. |
| 403 `forbidden` | Rol Recepción o Profesional, sin `clients.import`: «Tu rol no tiene permisos para realizar esta acción.». También si el negocio está suspendido o no es del usuario, como hoy. |
| 403 `two_factor_required` | Super admin sin la verificación en dos pasos, como en el resto de `/businesses`. |
| 429 `rate_limited` | «Demasiadas importaciones seguidas. Espera unos minutos.». |

El tope del plan no es un error: las filas que no entran van en `overLimit`.

## Rutas que cambian

### `GET /api/businesses/:id/clients` y `GET /api/businesses/:id/clients/:clientId`

- Cada paciente gana `source`: `"dashboard"`, `"booking_page"` o `"import"` (R10).

### `GET /api/businesses/:id/audit-logs` (Actividad)

- Puede traer la acción nueva `client.imported`, de tipo `client` y con `entityId: null`. Sale con el
  filtro «Clientes».

### `GET /api/admin/stats` (Inicio del super admin)

- Si se aprueba la pregunta 1 del plan: los pacientes nuevos del mes y su gráfico no cuentan los de
  `source = 'import'` (R10).

## Código compartido

`src/lib/validations/client-import.ts` en el front, copiado a
`agenda-backend/src/shared/lib/validations/client-import.ts` con `npm run sync:shared`:

| Exporta | Qué hace |
|---|---|
| `MAX_IMPORT_ROWS` (5.000), `MAX_IMPORT_BYTES` (3.500.000) | Los topes de la importación. |
| `IMPORT_COLUMNS` | Los destinos de una columna, con su etiqueta y sus nombres habituales (R5). |
| `normalizeHeader(text)` | El título en minúsculas, sin tildes ni signos. |
| `guessColumns(headers)` | El destino sugerido de cada columna, o `"ignore"`. |
| `findHeaderRow(rows)` | La fila de títulos dentro de las 10 primeras. |
| `rowFromCells(cells, headers, columns, row)` | Una `ClientImportRow` desde las celdas: une «Nombres» y «Apellidos» y las columnas «Añadir a las notas». |
| `prepareImportRow(row, timezone)` | La limpieza: cédula, el 0 en Ecuador, varios teléfonos o emails, puntos del teléfono. Se puede aplicar dos veces sin cambiar nada. |
| `classifyImportRows(rows, { required, timezone, existing, remaining })` | La clasificación (ver [data-model.md](../data-model.md)): qué se crea, qué ya existía, qué está repetido, qué tiene error y qué no entra por el tope. |
| `importSummary(counts)` | «Importó 200 pacientes (3 ya existían, 5 con errores)». |
| `clientImportSchema` | El cuerpo de la petición (zod). |

**Tipos nuevos** en `src/types/index.ts`:
- `ClientSource`;
- `Client.source`;
- `ClientImportRow`;
- `ClientImportResult`.

**El permiso nuevo:** `clients.import`, en `src/lib/permissions.ts`.

**Del front, sin compartir:**
- `src/lib/csv.ts`: `decodeCsv`, `parseCsv` y `toCsv`, que pasa aquí desde `export-audit.ts`;
- `src/features/clients/import/read-spreadsheet.ts`: `readSpreadsheet(file)` devuelve
  `{ sheets: { name, rows: string[][] }[] }`.

## Repositorio de datos del front

- **`ClientRepository.importMany(businessId, input): Promise<ClientImportResult>`.**
  - **La API:** `api-repository.ts` hace `POST …/clients/import`.
  - **La beta:** lo hace su repositorio de prueba (R12).
- **`useImportClients()`** (`use-clients.ts`): al terminar, recarga `queryKeys.clients` y llama a
  `useInvalidateActivity`, que recarga el uso del plan y la actividad.

## Pantalla

- **Ruta:** `/dashboard/clients/importar`, sólo con `clients.import`. Sin el permiso, un aviso y el
  enlace a Clientes.
- **La plantilla:** `/plantilla-pacientes.xlsx`, un archivo fijo de `public/` (R9).
- **Mensajes del archivo:**

  | Cuándo | Mensaje |
  |---|---|
  | Más de 10 MB | «El archivo pesa más de 10 MB. Guarda sólo la hoja de los pacientes y vuelve a intentarlo.» |
  | .xls, .ods u otro formato | «Guárdalo como .xlsx o .csv desde Excel (Archivo → Guardar como) y vuelve a intentarlo.» |
  | No se puede leer | «No se pudo leer el archivo. Ábrelo en Excel y guárdalo de nuevo como .xlsx.» |
  | Más de 5.000 filas | «El archivo tiene N filas con datos: el máximo es 5.000 por importación. Pártelo en dos archivos.» |
  | Más de 3,5 MB de datos | «Los datos son demasiado grandes para importarlos de una vez (por ejemplo, notas muy largas). Pártelo en dos archivos.» |
  | Sin conexión o sin respuesta | «No sabemos si la importación terminó. Revisa la lista de pacientes o vuelve a importar el mismo archivo: los que ya se importaron no se repiten.» |

## Emails

Ninguno. La importación no pone nada en la cola de `notifications`.

## Avisos por ntfy (cron)

- **Nuevo: uno por importación.**
  - **Título:** «Agenda360: pacientes importados», sin el negocio.
  - **Mensaje, una línea por dato:**
    - el nombre del negocio;
    - el resumen de la actividad, sólo con cifras: «Importó 200 pacientes (3 ya existían, 5 con
      errores)»;
    - «Desde el panel por Ana T. (Propietario)», o «por el super admin (modo soporte)».
  - **Prioridad** 3, etiqueta `inbox_tray` y `click` a `/admin/businesses/<id>`.
  - **Tope:** 10 por pasada, más «Agenda360: más importaciones» con «…y N importaciones más de
    pacientes (detalle en la actividad de cada negocio)».
- **«Agenda360: nuevo paciente» no cambia,** y no incluye a los importados: sólo `source =
  'dashboard'`.
- **Registro del cron:** suma «importaciones: N» detrás de «cambios de cuenta: N».

## Actividad

| Acción | Resumen | Autor |
|---|---|---|
| `client.imported` | «Importó 200 pacientes (3 ya existían, 5 con errores)». Sólo las partes que pasan de cero; «1 paciente» en singular. | Quien importó, o «Nombre (Super admin)» en modo soporte. |
