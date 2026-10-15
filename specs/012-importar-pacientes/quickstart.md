# Cómo comprobarlo en local: Importar pacientes desde Excel o CSV

Todo en local, con la base de demostración y archivos inventados. Nunca en Vercel, contra Supabase ni
con listas reales de pacientes. Los servidores de prueba van en puertos propios (por ejemplo 4180,
5199 y 3199) y se detienen por puerto o PID.

## 0. Archivos de prueba (scratchpad)

Un guion de Python del scratchpad, sólo con la biblioteca estándar (`zipfile`, `csv`), crea estos
archivos. Lleva nombres inventados y cédulas generadas con el algoritmo del dígito verificador, como
`tests/helpers/cedula.mjs`:

| Archivo | Qué tiene |
|---|---|
| `pacientes-200.xlsx` | Ver el detalle debajo de la tabla. |
| `pacientes-500.xlsx` | 500 filas válidas, para medir el tiempo (CE-001). |
| `pacientes-windows.csv` | Separador `;`, codificación Windows-1252, nombres con tildes y eñes («Peña», «José Núñez»). |
| `pacientes-utf8.csv` | Separador `,`, con BOM UTF-8, campos entre comillas con comas, comillas dobles y un salto de línea dentro de las notas. |
| `pacientes-6000.csv` | 6.000 filas: pasa el tope. |
| `notas-largas.csv` | 3.000 filas con notas de 1.500 caracteres: pasa los 3,5 MB. |
| `antiguo.xls` | Cualquier contenido con esa extensión: formato no aceptado. |
| `sin-cedula.csv` | Para un negocio con la cédula opcional: filas sin cédula, dos idénticas, y una que coincide con un paciente antiguo sin cédula. |

**`pacientes-200.xlsx`** tiene dos hojas: «Resumen», con dos celdas, y «Pacientes». En «Pacientes»:
- **arriba:** un título en la fila 1 y los títulos de las columnas en la 3;
- **las columnas:** Nombres, Apellidos, CI, Correo, Celular, Dirección, Observaciones, Fecha de
  nacimiento (celdas de fecha) y una columna con fórmula;
- **algunas CI son números** sin el 0 inicial;
- **algunos celulares traen dos números** («0991234567 / 042345678»);
- **hay dos filas vacías** en medio;
- **los casos a revisar:**
  - 5 filas con error: dígito verificador mal, sin email, email inválido, teléfono con letras y una
    cédula con letras;
  - 3 cédulas de pacientes de la clínica demo;
  - 2 cédulas repetidas dentro del archivo.

## 1. Pruebas automáticas

```
cd ~/Documentos/Proyectos/Backend/agenda-backend
npm run typecheck
npm test
```

```
cd ~/Documentos/Proyectos/Frontend/agenda-front
npm run build
npm run lint
npm audit
```

### Suite nueva: `tests/client-import.test.ts`

**Permisos:**
- el propietario y un administrador importan (200);
- Recepción y el rol Profesional reciben 403;
- sin sesión, 401, sin leer el cuerpo;
- el super admin en modo soporte importa, y la actividad lo nombra «(Super admin)».

**El caso de la spec:** 200 filas con 5 errores, 3 cédulas que ya existen y 2 repetidas.
- **La respuesta:** `created: 190`, 3 en `existing` con su `clientId`, 2 en `repeated` con su
  `firstRow` y 5 en `errors`. Cada motivo es el esperado y ninguno contiene el valor de la celda.
- **En la base:**
  - 190 pacientes nuevos con `source = 'import'`, `created_by` de quien importó y el mismo
    `created_at`;
  - los 3 que ya existían, sin ningún cambio (se comparan fila por fila antes y después).
- **Ningún email:** `notifications` tiene las mismas filas antes y después.
- **Actividad:** una sola entrada `client.imported` con «Importó 190 pacientes (3 ya existían, 5 con
  errores, 2 repetidas en el archivo)».

**Repetir la misma petición:**
- `created: 0`, con 195 filas en `existing` (las 190 creadas, las 3 de antes y las 2 repetidas, que
  ahora ya existen) y las 5 con error;
- ni un paciente más y ninguna entrada nueva en la actividad.

**Cortes y dobles envíos:** dos peticiones iguales a la vez dejan los mismos 190 pacientes, sin
duplicados (el bloqueo del negocio).

**Limpieza:**
- «0912-345675» y «0912 345 675» quedan «0912345675»;
- una cédula de 9 dígitos que con el 0 es válida se crea con el 0. Una que no, da «La cédula no es
  válida. Revisa el número.»;
- un negocio de otro país no le pone el 0;
- «099.123.4567» se acepta. Con dos teléfonos o dos emails en una celda, el primero va a su campo y
  los otros a las notas;
- volver a limpiar una fila ya limpia no cambia nada.

**Datos obligatorios del negocio** (cambiados por el super admin con `PUT
/admin/businesses/:id/client-required-fields`):
- **Con el teléfono obligatorio:** las filas sin teléfono dan «El teléfono es obligatorio».
- **Con la cédula opcional:**
  - las filas sin cédula se crean;
  - dos filas iguales sin cédula: una se crea y la otra es «repetida»;
  - repetir la importación no crea ninguna más;
  - una fila con cédula y el mismo nombre, email y teléfono que un paciente antiguo sin cédula cuenta
    como «ya existía», y ese paciente sigue sin cédula.

**Tope del plan** (negocio Free con 45 pacientes y 20 filas válidas):
- `created: 5` y 15 en `overLimit`;
- `GET …/subscription/usage` dice 50.

**Topes de la petición:**
- 5.001 filas, un número de fila repetido o un campo de 6.000 caracteres: 400;
- un cuerpo de 3 MB se acepta en esta ruta, y el mismo tamaño en `PUT …/clients/:id` sigue dando 400;
- más de 4 MB: 400 `validation`;
- la petición 21 en 15 minutos desde la misma conexión: 429.

**ntfy, contra la base de prueba:**
- `findPanelClients` no devuelve ninguno de los 190 importados, y sí un paciente creado con el
  formulario a la vez;
- `findClientImports` devuelve una importación;
- `clientImportNotice`:
  - el título no nombra al negocio;
  - el mensaje lleva el resumen y quién la hizo a medias, sin nombres, emails ni teléfonos de
    pacientes.

**Código compartido:**
- `guessColumns` reconoce «Nombres y Apellidos», «CI», «C.I.», «Correo electrónico», «Celular»,
  «Teléfono», «Dirección», «Observaciones» y «E-mail», también en mayúsculas y sin tildes;
- deja en «No importar» lo que no conoce («Seguro médico»);
- `importSummary` usa el singular («Importó 1 paciente») y sólo las partes que pasan de cero.

**Inicio del super admin** (si se aprueba la pregunta 1): los 190 importados no cambian los pacientes
nuevos del mes en `GET /admin/stats`.

### Suites que se actualizan

| Suite | Qué cambia |
|---|---|
| `booking-alert.test.ts` | El aviso de una importación, y «…y N importaciones más» con más de 10. |
| `cron.test.mjs` | La línea del registro, con «importaciones: N». |

### El lector de CSV (sin servidor)

Un guion de Node del scratchpad importa `agenda-front/src/lib/csv.ts`, que no usa los alias `@/`, y
comprueba:
- `;`, `,` y tabulador;
- comillas con separadores, `""` y saltos de línea;
- BOM;
- `\r\n` y `\n`;
- bytes en Windows-1252: «Peña» y «José» salen bien;
- `toCsv` produce lo mismo que la exportación de la actividad de hoy.

## 2. Recorrido con Playwright (local, escritorio y 390 px)

**API, front y datos:**
- la API local en el 4180;
- el front con Vite en el 5199, con `API_PROXY_TARGET=http://localhost:4180`;
- la demo.

**Pasos:**
1. **Como propietario,** en Clientes aparece «Importar pacientes». Como Recepción, no aparece, y
   `/dashboard/clients/importar` muestra el aviso con el enlace a Clientes.
2. **«Descargar plantilla»** baja `plantilla-pacientes.xlsx`.
   - Al importarla sin rellenar, dice que no hay filas con datos.
   - Rellenada por el guion con 3 filas, importa 3.
3. **`pacientes-200.xlsx`:**
   - se elige la hoja «Pacientes»;
   - la fila de títulos detectada es la 3;
   - Nombres, Apellidos, CI, Correo, Celular, Dirección y Observaciones quedan asignadas solas;
   - la fecha de nacimiento y la fórmula, en «No importar».
4. **«Fecha de nacimiento» → «Añadir a las notas».** La revisión dice:
   - 190 se importarán, 3 ya existían (con el nombre de cada paciente), 5 con errores y 2 repetidas;
   - los números de fila coinciden con los de Excel.
5. **«Descargar las filas con errores»** baja un CSV con las 5 filas y su motivo.
6. **«Importar 190 pacientes»:**
   - el aviso «Se importaron 190 pacientes» y el resumen;
   - la lista de Clientes tiene 190 más;
   - la ficha de uno trae «Fecha de nacimiento: dd/mm/aaaa» y el segundo teléfono en las notas;
   - la actividad tiene una entrada.
7. **Repetir con el mismo archivo:** 0 se importarán, 195 ya existían y 5 con errores. El botón
   queda desactivado.
8. **Cortes de conexión:**
   - con `page.route` que corta la petición antes de llegar, sale «No sabemos si la importación
     terminó…» y reintentar importa todo;
   - con `route.fetch()` y después `route.abort()` (la API terminó, pero la respuesta se pierde),
     reintentar da todo «ya existía», sin duplicados.
9. **Los CSV:**
   - `pacientes-windows.csv` y `pacientes-utf8.csv` muestran bien las tildes y las notas con saltos de
     línea;
   - `pacientes-6000.csv`, `notas-largas.csv` y `antiguo.xls` dan cada uno su mensaje
     ([contracts/api.md](./contracts/api.md)).
10. **CE-001:** `pacientes-500.xlsx`, desde elegir el archivo hasta el aviso, revisando la revisión:
    menos de 2 minutos. La lectura y el envío, cada uno en pocos segundos.
11. **Modo soporte:** el super admin, en «Gestionar negocio», importa, y la actividad dice
    «(Super admin)».
12. **Inicio del negocio** (si se aprueba la pregunta 1): «Clientes nuevos este mes» no sube con la
    importación.
13. **A 390 px,** en cada paso y en el resultado: sin desplazamiento horizontal
    (`scrollWidth <= innerWidth`). Con el teclado se llega a todo y el foco se ve.
14. **El Excel se carga sólo al usarlo:**
    - al abrir el panel y la página de importar, no se descarga el trozo de `read-excel-file`
      (pestaña de red de Playwright);
    - se descarga al elegir un .xlsx, y no con un .csv.

## 3. CSP y versión de producción

1. `npm run build`.
2. Servir `dist/` con un servidor estático del scratchpad, en el 5199, que:
   - aplique las cabeceras de `vercel.json`;
   - reenvíe `/api` a la API local.
3. Importar `pacientes-200.xlsx` y `pacientes-utf8.csv`.
   - La consola no muestra errores de CSP: el worker `blob:` de la librería está permitido por
     `worker-src`.
   - El resultado es el mismo que con Vite.
4. `/plantilla-pacientes.xlsx` se sirve como archivo, no como `index.html`.

## 4. Beta (puerto 3199)

1. `npm run build`, `npm run lint` y `npm audit`.
2. Importar `pacientes-200.xlsx` con la clínica de prueba:
   - el mismo resultado de la revisión y de la importación;
   - la entrada en la actividad.
3. Repetir: todo «ya existía».
4. Un archivo de 5.000 filas con notas largas, hasta llenar el almacenamiento del navegador: sale «La
   demo no tiene espacio para tantos pacientes…» y los datos de antes siguen intactos.
