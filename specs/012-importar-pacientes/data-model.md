# Modelo de datos: Importar pacientes desde Excel o CSV

## Migración 039 (`db/migrations/039_client_import.sql`)

Es una sola migración, que el dueño aplica antes de publicar el backend. Va con el número 039: la 037
es de la spec 010 y la 038 de la 011. `migrate.ts` aplica cada archivo pendiente por su nombre, así
que la 039 no depende de que las otras dos estén aplicadas.

1. **Origen «importado».** Los pacientes que crea una importación quedan con `source = 'import'`,
   como hoy quedan con `'booking_page'` los de la página de reservas.

   ```sql
   -- Importar pacientes (spec 012): los que crea una importación desde un Excel o un CSV.
   alter table clients
     drop constraint clients_source_check,
     add constraint clients_source_check check (source in ('dashboard', 'booking_page', 'import'));
   ```

   - **El nombre del check:** lo puso PostgreSQL al crear la columna en la migración 029, con su regla
     `<tabla>_<columna>_check`. `npm test` aplica todas las migraciones en una base nueva y lo
     comprueba.
   - **El bloqueo:** comprobar el check nuevo recorre `clients` con un bloqueo breve. Con los pacientes
     de hoy son milisegundos.
   - **Las filas de hoy no cambian:** todas son `'dashboard'` o `'booking_page'`.
   - **Sin índices nuevos:**
     - el aviso de ntfy busca en `audit_logs` con el índice `audit_logs_entity_created_idx`, por
       `entity_type` y `created_at`;
     - las cifras del Inicio ya recorren `clients` por fecha.

No hay más cambios de esquema. La importación no tiene tabla propia (ver abajo).

## Entidades

### Paciente (`clients`, tipo `Client`)

- **`source` admite `'import'`.**
- **Gana `source: ClientSource`** (`'dashboard' | 'booking_page' | 'import'`). La lista y la ficha
  lo devuelven a quien ya puede ver al paciente, y lo usan las cifras del Inicio (R10).
- **Un paciente importado tiene:**
  - `is_active = true`;
  - `created_by`: quien importó, o el super admin en modo soporte;
  - `claimed_client_id = null`: es un paciente normal, no «Por verificar»;
  - `created_at`: el mismo instante en toda la importación.
- **Cuenta para el tope del plan** (`countClients`), como los del panel.
- **No le llega ningún email** por importarlo.

### Importación (sin tabla)

La spec la describe con el archivo, las columnas asignadas, las filas válidas, repetidas y con error,
y quién la hizo. Así queda cada parte:

| Parte | Dónde |
|---|---|
| Quién, cuándo y las cifras | Una entrada en `audit_logs` (abajo). |
| Qué pacientes creó | `clients` con `source = 'import'`, del negocio, y `created_at` igual al de la entrada: la transacción usa un solo `now()`. |
| El archivo, la hoja y las columnas asignadas | Sólo en el navegador mientras dura la pantalla. No se guardan (spec, «Supuestos»). |
| Las filas con error, repetidas y que ya existían | En la respuesta de la API y en la pantalla. No se guardan: la entrada guarda sólo las cifras. |

**Ciclo de vida:**

```text
elegir el archivo (navegador) ─► hoja y columnas ─► revisión (classifyImportRows en el navegador)
        │
        ▼  «Importar N pacientes»: una petición con todas las filas no vacías
 API, en una transacción: bloquea el negocio · vuelve a clasificar con el mismo código · crea los nuevos
        │                                         (source = 'import', sin emails)
        ├─ si creó al menos uno: una entrada client.imported en la actividad
        ▼
 respuesta con el resultado ─► aviso en pantalla
        │
        ▼  siguiente pasada del cron (cada 10 min)
 un aviso por ntfy por importación (con la cifra, sin nombres)
```

**Si se corta la conexión:**
- **La transacción no terminó:** no queda nada.
- **Terminó:** al repetir la importación todo cuenta como «ya existía».

### Fila de la importación (`ClientImportRow`, sólo en tránsito)

Lo que manda el front por cada fila no vacía, ya con las columnas asignadas:

| Campo | Tipo | Notas |
|---|---|---|
| `row` | entero ≥ 2 | El número de fila en la hoja, como lo muestra Excel. Único en la petición. |
| `name` | texto | El nombre completo, o «Nombres Apellidos». |
| `documentId` | texto | Como viene; la limpieza la hacen los dos lados (R5). |
| `email`, `phone`, `address` | texto | Como vienen. |
| `notes` | texto | La columna Notas más las columnas «Añadir a las notas», una por línea. |

**Topes de forma:**
- cada texto, de hasta 5.000 caracteres;
- hasta 5.000 filas;
- hasta 4 MB por petición.

Lo que pase de un tope rechaza la petición entera (400). Un dato demasiado largo para la ficha (por
ejemplo, una dirección de 300 caracteres) es un error de esa fila, no de la petición.

### Clasificación de cada fila (`classifyImportRows`)

Cada fila acaba en una sola categoría, en este orden:

| Categoría | Cuándo | Qué pasa |
|---|---|---|
| Vacía | Todos los datos asignados en blanco | Se ignora y no cuenta. |
| Con error | No pasa `clientSchemaFor(datos obligatorios del negocio)` o `documentIdError` | No se importa. Se dice la fila y el motivo. |
| Ya existía | Su cédula es de un paciente del negocio, o coincide sin cédula (abajo) | No se importa y el paciente no se cambia. |
| Repetida | Su clave ya salió en una fila válida anterior del archivo | No se importa. Se dice la fila anterior. |
| Tope del plan | Ya no queda cupo de pacientes en el plan | No se importa. |
| Se crea | El resto, en el orden del archivo | Se crea con `source = 'import'`. |

**«El mismo paciente»:**
- **Una fila con cédula** coincide con el paciente que tiene esa cédula. También coincide con un
  paciente antiguo sin cédula si el nombre, el email y el teléfono son los mismos.
- **Una fila sin cédula** (sólo donde la cédula es opcional) coincide si el nombre, el email y el
  teléfono son los mismos.

**Cómo se comparan:**
- el nombre, en minúsculas, sin tildes y con los espacios juntos;
- el email, en minúsculas;
- del teléfono, sólo los dígitos;
- vacío con vacío también coincide.

### Resultado (`ClientImportResult`)

| Campo | Tipo | Qué es |
|---|---|---|
| `created` | entero | Pacientes creados. |
| `existing` | `{ row, clientId }[]` | Filas que ya existían, con la ficha. |
| `repeated` | `{ row, firstRow }[]` | Filas repetidas, con la fila que se usó. |
| `errors` | `{ row, reason }[]` | Filas con error y el motivo, sin el valor. |
| `overLimit` | `number[]` | Filas que no entraron por el tope del plan. |

### Registro de actividad (`audit_logs`)

**Acción nueva:**

| Acción | Tipo de entidad | Entidad | Cuándo |
|---|---|---|---|
| `client.imported` | `client` | `null` | Una importación creó al menos un paciente. |

**El resumen:** «Importó 200 pacientes (3 ya existían, 5 con errores)». Lleva sólo las partes que pasan
de cero, en este orden:
- ya existían;
- con errores;
- repetidas en el archivo;
- por el tope del plan.

No lleva nombres ni `changes`. El autor es el de siempre: el usuario, o «Nombre (Super admin)».

### Permiso (`permissions.ts`)

| Permiso | owner | admin | staff (Recepción) | professional |
|---|---|---|---|---|
| `clients.import` (nuevo) | Sí | Sí | No | No |

El super admin en modo soporte actúa como `owner`.

## Límites

| Límite | Valor | Dónde |
|---|---|---|
| Filas por importación | 5.000 | `MAX_IMPORT_ROWS`, compartido: el front avisa y la API rechaza. |
| Tamaño del archivo | 10 MB | Front, antes de leerlo. |
| Datos que manda el front | 3,5 MB | `MAX_IMPORT_BYTES`, compartido: medido con `TextEncoder`. |
| Cuerpo de la petición | 4 MB | Sólo en esta ruta; el resto de la API sigue en 2 MB. |
| Importaciones por conexión | 20 cada 15 minutos | `limitRequests` con el nombre `importar-pacientes`. |
| Avisos de ntfy por pasada | 10 y la cifra del resto | `MAX_IMPORT_NOTICES`. |

## Configuración nueva

Ninguna. No hay variables nuevas en Vercel, en Lambda ni en GitHub.
