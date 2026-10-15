# Plan de implementación: Importar pacientes desde Excel o CSV

**Rama**: `dev` · **Fecha**: 2026-10-14 · **Spec**: [spec.md](./spec.md)

**Documentos**: [research.md](./research.md) (decisiones R1–R12) · [data-model.md](./data-model.md) ·
[contracts/api.md](./contracts/api.md) · [quickstart.md](./quickstart.md)

## Resumen

**Lo que ve el negocio:**
- En Clientes, el propietario, los administradores y el super admin en modo soporte tienen el botón
  «Importar pacientes» (R1). Recepción y el rol Profesional no lo ven.
- El botón abre una pantalla de tres pasos (R2):
  1. **Archivo:** se elige un Excel (.xlsx) o un CSV de hasta 5.000 filas, o se descarga la plantilla.
  2. **Columnas:** se reconocen solas (Nombre, Cédula o CI, Email o Correo…) y se pueden cambiar a
     mano. Si el Excel tiene varias hojas, se elige la hoja.
  3. **Revisión:** cuántos se importarán, cuántos ya existían (por la cédula), cuáles tienen errores
     con la fila y el motivo, cuáles están repetidas en el archivo y cuántos no entran por el tope del
     plan. El botón dice «Importar N pacientes».
- Al terminar, un aviso con la cifra y el detalle de lo que no entró.

**Cómo funciona por dentro:**
- **El archivo se lee en el navegador y no se guarda.** El lector de Excel (`read-excel-file`, R3)
  se descarga sólo al elegir un .xlsx. El CSV lo lee un lector propio pequeño (R4).
- **Las mismas reglas que el formulario del paciente (R5).** Un módulo compartido revisa cada fila
  con la validación de hoy: la cédula con su dígito verificador, los datos obligatorios del negocio,
  el email y el teléfono. La API vuelve a revisar con el mismo código.
- **Todo o nada, en una sola petición (R6).** La API crea los pacientes en una sola operación. Si se
  corta la conexión, o se importaron todos o ninguno. Repetir la importación no duplica: los que ya
  están cuentan como «ya existían».
- **Sin emails a los pacientes (R7).**
- **Una entrada en la actividad y un solo aviso por ntfy (R7, R8).** Los importados no salen uno por
  uno en el aviso de «paciente nuevo».

**Migración 039:** los importados quedan con origen «importado». No hay tablas nuevas.

**Beta:** lo mismo, con su repositorio de prueba (R12).

**Constitución:** esta spec añade una decisión al principio III. Sube una sola vez a 1.7.0, junto con
las specs 010 y 011.

## Contexto técnico

**Lenguaje/versión**: TypeScript. Node ejecuta `.ts` en el backend; el front y la beta usan React 19
y Vite 8.

**Dependencias:**
- **Una nueva, sólo en el front y la beta:** `read-excel-file` 9.3.12, con la versión fija. Tiene
  licencia MIT, pesa unos 15 KB comprimidos y no tiene avisos de seguridad conocidos (R3).
- **En el backend, ninguna.**

**Almacenamiento**: la migración 039 (ver [data-model.md](./data-model.md)). La importación no tiene
tabla propia: queda en la actividad y en el origen de cada paciente.

**Variables nuevas**: ninguna.

**Pruebas**:
- **Backend:** `npm test` y `npm run typecheck`, con la suite nueva `tests/client-import.test.ts` y
  las que se actualizan (ver [quickstart.md](./quickstart.md)).
- **Front y beta:** `npm run build` y `npm run lint`.
- **Recorrido con Playwright** con archivos de prueba inventados: escritorio y 390 px, y la CSP con
  un servidor estático local.

**Restricciones**:
- **CPU de Vercel:** revisar 5.000 filas tarda unos 20 ms (medido con la validación de hoy). El
  aviso por ntfy lo manda el cron.
- **Tamaño de la petición:** 5.000 filas normales ocupan cerca de 1 MB. La ruta de importar acepta
  hasta 4 MB y el front no manda más de 3,5 MB. Vercel corta en 4,5 MB.

## Comprobación contra la constitución (1.6.0 → 1.7.0)

| Principio | Cumple | Cómo |
|---|---|---|
| I. Español | Sí | La pantalla, los motivos de error, la plantilla, la actividad y el aviso, en español. |
| II. Privacidad | Sí | El archivo no se guarda ni se sube: sólo viajan los datos de cada fila, como en el formulario. Nada queda en el navegador al salir. La API no registra filas ni valores, y los motivos de error no repiten los datos. El aviso de ntfy lleva sólo cifras, sin nombres. Las pruebas usan datos inventados. |
| III. Decisiones | Sí | La cédula sigue siendo sólo números y única por negocio. Los datos obligatorios son los que fija el super admin (`client_required_fields`): la importación los lee y no los cambia. «Por verificar» (spec 009) no cambia. ntfy, a medias y sin el negocio en el título. Un paciente que ya existe no se toca. El aviso del tope habla del plan como los mensajes de hoy, sin nombres de planes ni precios. |
| IV. Local | Sí | Todo se comprueba en local, con archivos inventados. |
| V. Compartido | Sí | Las reglas de la importación, el permiso nuevo y los tipos se escriben en el front y se copian con `sync:shared`. La vista previa y la API usan el mismo código. |
| VI. Barato | Sí, con una excepción justificada | Una dependencia nueva en el front (ver abajo). El CSV y la plantilla no necesitan ninguna. Sin servicios externos y la CSP no cambia. ntfy, por el cron. |
| VII. Diseño | Sí | Los pasos son listas y tarjetas, sin tablas anchas, y se revisan a 390 px. Cada campo tiene su etiqueta, el resultado se anuncia al lector de pantalla y se usan los tokens del tema. |
| Restricciones | Sí | La migración 039 la aplica el dueño antes de publicar el backend, como paso aparte. |

**Excepción justificada (principio VI): la dependencia `read-excel-file`.**
- **Por qué hace falta:** el dueño decidió aceptar Excel, y nada del proyecto lee .xlsx.
- **Por qué no algo más sencillo:**
  - un lector propio son cientos de líneas llenas de casos raros (acentos, fechas, formatos);
  - SheetJS pesa seis veces más y ya no se publica en npm;
  - ExcelJS no saca versiones desde 2023 y arrastra dependencias con avisos de seguridad.
- **Cómo se acota:**
  - se descarga sólo al elegir un .xlsx;
  - va con la versión fija, y `npm audit` se revisa al instalarla;
  - si algún día falla, el CSV sigue funcionando sin ella.

**Texto que esta spec añade al principio III** (la 1.7.0 se aplica una sola vez con las specs 010 y
011, en los dos repos):

> - Importar pacientes desde un Excel (.xlsx) o un CSV es del propietario, los administradores y el
>   super admin en modo soporte; Recepción y el rol Profesional no lo ven. Cada fila pasa las mismas
>   reglas que el formulario del negocio. Un paciente cuya cédula ya existe no se cambia, los
>   importados no reciben emails y quedan con origen «importado». El archivo se lee en el navegador y
>   no se guarda, y lo que lee el Excel se carga sólo en esa pantalla. La actividad registra una
>   entrada por importación y ntfy avisa una vez, con la cifra y sin nombres (2026-10-14).

## Cambios respecto a la spec

Hay que aprobarlos con el plan:

1. **Todo o nada (R6).** La spec pide que, si la importación «falla a medias», repetirla no duplique.
   - Aquí no puede quedar a medias: la importación es una sola operación.
   - Repetirla nunca duplica: lo que ya entró cuenta como «ya existía».
2. **Tope de tamaño además del de filas (R6).** Si los datos pasan de 3,5 MB, se pide partir el
   archivo aunque tenga menos de 5.000 filas. Pasa sólo con notas muy largas.
3. **El 0 que quita Excel (R5).** Excel borra el 0 inicial de las cédulas («0912345675» →
   «912345675»).
   - En los negocios de Ecuador, a una cédula de 9 dígitos se le vuelve a poner el 0;
   - sólo si así es una cédula válida. Si no, queda como error.
4. **Dos teléfonos o dos emails en una celda (R5).** El primero va a su campo y los demás, a las
   notas. Así no se pierde nada.
5. **Más formas de asignar columnas (R2).**
   - «Nombres» y «Apellidos» en columnas separadas se unen en el nombre.
   - Cualquier otra columna se puede «Añadir a las notas» con su título, por ejemplo «Fecha de
     nacimiento: 12/03/1990».
6. **«Ya existía» sin cédula (R5).** La spec sólo habla de la cédula. Además:
   - donde el super admin dejó la cédula opcional, una fila sin cédula ya existe si coinciden el
     nombre, el email y el teléfono. Así repetir la importación tampoco duplica esas filas;
   - en cualquier negocio, una fila con cédula cuenta como «ya existía» si coincide así con un
     paciente antiguo que no tiene cédula.

   En los dos casos no se cambia nada: la cédula del paciente antiguo se completa en su ficha.
7. **La actividad y ntfy, sólo si se creó al menos un paciente (R7).** Si todos ya existían, no queda
   entrada ni aviso, como cuando sólo se consulta.
8. **La plantilla (R9).** Es un .xlsx sólo con los títulos de las columnas, con la cédula y el
   teléfono en formato de texto para que Excel no borre el 0. No lleva filas de ejemplo, para que no
   se importen por error.
9. **«Pacientes nuevos del mes» (R10, pregunta 1).** Los importados no cuentan como nuevos del mes en
   el Inicio del negocio ni en el del super admin. Sí cuentan para el tope del plan y en el total.
10. **Descargar las filas con errores (R2).** Un CSV con la fila, el motivo y los datos, para
    corregirlas en Excel y volver a importar.
11. **Formatos aceptados (R3).** Un .xls (Excel antiguo) o un .ods no se leen: se pide guardarlo como
    .xlsx o .csv.

## Estructura

```text
specs/012-importar-pacientes/   spec, plan, research, data-model, contracts/api.md, quickstart (tasks y reporte, después)

agenda-backend
  db/migrations/039_client_import.sql           NUEVO: origen 'import' (data-model)
  src/app.ts                                    la ruta de importar no pasa por el lector JSON de 2 MB (R6)
  src/routes/business-routes.ts                 POST …/clients/import: sesión, JSON de 4 MB, límite de peticiones (R6)
  src/services/client-import-service.ts         NUEVO: importar en una transacción (R6, R7)
  src/services/plan-limits.ts                   cupo que queda de pacientes (remainingClientSlots)
  src/db/columns.ts                             Client.source
  src/services/booking-alerts.ts                findClientImports y clientImportNotice (R8)
  src/jobs/scheduled-tasks.ts, scripts/cron.ts  el aviso de cada importación y la línea del registro (R8)
  src/services/admin-service.ts                 los importados no cuentan como nuevos del mes (R10, si se aprueba)
  README.md                                     la ruta y la función
  src/shared/**                                 sólo con npm run sync:shared (el archivo nuevo se crea vacío antes, R5)
  tests/client-import.test.ts                   NUEVA
  tests/booking-alert.test.ts, cron.test.mjs    actualizadas

agenda-front
  package.json, package-lock.json              read-excel-file 9.3.12 (versión fija)
  public/plantilla-pacientes.xlsx               NUEVO: la plantilla (R9)
  src/lib/validations/client-import.ts          NUEVO, compartido: columnas, limpieza, reglas y esquema (R5)
  src/lib/csv.ts                                NUEVO: leer y escribir CSV (R4); export-audit.ts lo reutiliza
  src/lib/permissions.ts                        permiso clients.import (R1)
  src/types/index.ts                            ClientSource, Client.source, ClientImportRow, ClientImportResult
  src/features/clients/import/read-spreadsheet.ts   NUEVO: Excel (import dinámico) o CSV → hojas de texto (R3)
  src/features/clients/import/*-step.tsx        NUEVOS: archivo, columnas, revisión y resultado (R2)
  src/pages/dashboard/client-import-page.tsx    NUEVA: /dashboard/clients/importar
  src/app/router.tsx                            la ruta nueva
  src/pages/dashboard/clients-page.tsx          botón «Importar pacientes», también cuando aún no hay pacientes
  src/lib/data/repository.ts, api-repository.ts, src/hooks/queries/use-clients.ts   clients.importMany
  src/features/activity/export-audit.ts         usa src/lib/csv.ts
  src/features/dashboard/dashboard-metrics.ts   los importados no cuentan como nuevos del mes (R10, si se aprueba)

agenda-beta: los mismos archivos del front (sin el proxy ni la CSP), la dependencia fija, la plantilla
y clients.importMany en su repositorio de prueba
```

## Publicación

**El orden importa:** la migración va antes del backend, y el backend antes del front. Si el front
saliera primero, el botón llamaría a una ruta que todavía no existe.

1. **Migración 039,** como paso aparte, antes del PR del backend. Si se publica junto con las specs
   010 y 011, el mismo comando aplica también la 037 y la 038:

   ```
   cd ~/Documentos/Proyectos/Backend/agenda-backend
   npm run db:migrate
   ```

2. **Comprobar que quedó aplicada.** Es una consulta de sólo lectura en el editor SQL de Supabase:

   ```
   begin read only;
   select name, applied_at from schema_migrations order by name desc limit 3;
   rollback;
   ```

   Debe aparecer `039_client_import.sql`.
3. **PR `dev` → `main` del backend.** Al publicarse, abrir `/api/health`.
4. **PR `dev` → `main` del front.** Al publicarse, mirar sin importar nada:
   - Clientes muestra «Importar pacientes»;
   - la plantilla se descarga.
5. **Constitución 1.7.0** en los dos repos, una sola vez con las specs 010 y 011.
6. **Beta:** sólo en local; no se publica.

No hay variables nuevas en Vercel ni en GitHub.

## Riesgos

- **Archivos raros:**
  - un .xlsx hecho por otro programa puede traer fórmulas sin el valor calculado, y esas celdas se
    leen vacías;
  - un CSV con otra codificación puede mostrar letras raras.

  En los dos casos se ve en la revisión antes de importar, y se puede volver a guardar desde Excel.
- **Datos viejos en la lista del negocio.** Si un paciente importado reserva online con otro email y
  otro teléfono, su reserva queda «Por verificar» (spec 009). Es lo esperado.
- **Una importación grande ocupa el negocio cerca de un segundo.** Mientras tanto, una reserva de ese
  negocio espera ese segundo. Es lo mismo que ya pasa con dos reservas a la vez.
- **Tope de Vercel (4,5 MB por petición).** El front no manda más de 3,5 MB y la API no acepta más de
  4 MB.
- **La dependencia nueva** tiene un solo autor y saca versiones a menudo (12 en 2026).
  - Va con la versión fija y se revisa con `npm audit`.
  - Se actualiza sólo a propósito, y comprobando la importación con los archivos de prueba.
- **Otros países:** a las cédulas de 9 dígitos sólo se les vuelve a poner el 0 en Ecuador, el único
  país en el que la app comprueba el dígito verificador. En los demás, el 0 que quitó Excel se pierde.
- **Beta:** guarda los datos en el navegador. Con miles de pacientes puede llenarse, y entonces lo
  dice claramente.
- **Las specs 010 y 011** también tocan los avisos del cron, los tipos y la constitución. Se
  implementan una detrás de otra en `dev`, sin mezclar los cambios.

## Ampliación del 2026-10-15: «Importar también los que tienen datos por completar»

Las decisiones R13–R18 están en [research.md](./research.md). Antes de publicar, el dueño pidió:
- que las filas a las que les falta un dato obligatorio entren marcadas «Por completar»;
- que baste el nombre.

**Qué cambia para quien importa:**
- **La revisión** cuenta aparte «N con datos por completar», con la fila y lo que falta («falta la
  cédula y el email»).
- **La casilla** «Importar también los que tienen datos por completar» viene encendida. Con ella,
  entran con lo que traen.
- **Lo mal escrito** (una cédula que no es válida, un email o un teléfono mal escritos) sigue con
  error.
- **En Clientes** hay un filtro «Por completar» y una marca en cada paciente al que le falta algo. Su
  ficha dice «Faltan datos: cédula y email», con «Completar».
- **Los datos obligatorios del negocio no cambian:** el formulario los sigue pidiendo al guardar, y la
  marca desaparece sola al completarlos.

**Sin migración:** «Por completar» se calcula con los datos obligatorios de hoy (R13).

**Constitución 1.11.0 (MENOR), en los dos repos.** En el principio III, la frase «Cada fila pasa las
mismas reglas que el formulario del negocio» pasa a decir:
> Cada fila pasa las mismas reglas que el formulario del negocio, salvo que se elija «Importar también
> los que tienen datos por completar». Entonces basta el nombre, lo que viene se valida igual y el
> paciente queda «Por completar» hasta que se completa en su ficha (2026-10-15).

**Archivos:**
```text
agenda-front (y su copia en agenda-backend/src/shared con sync:shared)
  src/lib/validations/client.ts          missingRequiredFields (R13)
  src/lib/validations/client-import.ts   allowIncomplete, la categoría incomplete, importSummary y
                                         el cuerpo con includeIncomplete (R14, R17)
  src/types/index.ts                     ClientImportResult.incomplete
  src/features/clients/import/review-step.tsx, result-step.tsx, import-data.ts
                                         la cifra, la lista con lo que falta y la casilla (R14)
  src/pages/dashboard/clients-page.tsx   el filtro y la marca (R16)
  src/pages/dashboard/client-detail-page.tsx   «Faltan datos…» con «Completar» (R16)
agenda-backend
  src/services/client-import-service.ts  includeIncomplete (R14)
  tests/client-import.test.ts            la casilla encendida y apagada, sólo el nombre, lo mal escrito,
                                         el tope del plan, repetir la importación y el resumen
agenda-beta
  lo mismo, con la repo mock (R18)
```

**Comprobación:**
- `npm test`, `npm run build` y `npm run lint`;
- el recorrido de la importación con el archivo de la prueba del 2026-10-15: diez pacientes con y sin
  cédula, email y teléfono.

**Riesgos:**
- **Dos personas con el mismo nombre y ningún otro dato** se toman por la misma (R15).
- **Un importado sin cédula que reserva online** queda en ficha aparte si no coinciden el nombre, el
  email y el teléfono (spec 009). Por eso conviene completarlos.

## Decisiones del dueño del producto (2026-10-14)

El dueño aprobó el plan con esta respuesta, que manda sobre lo que diga la pregunta de abajo:
1. **Los importados no cuentan como «pacientes nuevos del mes»** en el Inicio del negocio ni en el del
   super admin. Sí cuentan en el total y en el tope del plan.

## Preguntas para el dueño

1. **¿Los pacientes importados cuentan como «pacientes nuevos del mes»?** Hablamos del Inicio del
   negocio y del Inicio del super admin.
   - **Propuesta: no.** Son la lista que el negocio ya tenía, y una clínica que importa 500 vería «500
     nuevos» su primer mes.
   - **Sí cuentan** para el tope del plan y en el total de pacientes.
   - Si prefieres que cuenten, esos dos cambios salen del plan (R10). La migración sigue haciendo
     falta.
