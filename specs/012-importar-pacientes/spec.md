# Especificación: Importar pacientes desde Excel o CSV

**Carpeta**: `specs/012-importar-pacientes` (rama de trabajo: `dev`)

**Creada**: 2026-10-14

**Estado**: Implementada (2026-10-14)

**Repos**: agenda-backend (principal: validar e importar) y agenda-front (la pantalla de importar,
leer el archivo y la vista previa). La beta, para las demostraciones.

## Pedido

El dueño del producto eligió, entre las ideas de mejora del 2026-10-14, **importar pacientes desde un
archivo**. Sirve al vender: una clínica que ya tiene su lista la carga en un minuto en vez de
escribirla a mano.

**Decisión del dueño del producto (2026-10-14):** se aceptan **Excel (.xlsx) y CSV**. Lo que lee el
Excel se carga sólo en esa pantalla, para no hacer más pesada la app.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - Importar una lista (Prioridad: P1)

En Clientes → «Importar», se sube el archivo, se revisa la vista previa y se importan los válidos.

**Por qué esta prioridad**: es el pedido; quita la barrera de empezar con Agenda360.

**Prueba independiente**: importar un Excel de 200 pacientes con 5 filas con errores y 3 cédulas que
ya existen.

**Escenarios de aceptación**:

1. **Dado** Clientes, **entonces** el propietario, un administrador o el super admin en modo soporte
   ven «Importar pacientes».
2. **Dado** un archivo, **entonces** se reconocen solas las columnas con nombres habituales:
   - Nombre o Nombres y Apellidos;
   - Cédula o CI;
   - Email o Correo;
   - Teléfono o Celular;
   - Dirección;
   - Notas.

   Las que no se reconocen se asignan a mano o se ignoran.
3. **Dado** la vista previa, **entonces** dice cuántos se importarán, cuántos ya existen (por la
   cédula) y cuántos tienen errores, con la fila y el motivo («cédula inválida», «falta el email»…).
4. **Dado** «Importar N pacientes», **entonces** se crean los válidos y un aviso dice cuántos.
5. **Dado** un archivo de ejemplo, **entonces** se puede descargar uno con las columnas, para
   llenarlo.

---

### Historia 2 - Sin sorpresas para los pacientes ni para la ficha (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** una importación, **entonces** no sale ningún email a los pacientes importados.
2. **Dado** un paciente que ya existe con esa cédula, **entonces** no se cambia: se cuenta como «ya
   existía».
3. **Dado** dos filas con la misma cédula en el archivo, **entonces** se importa la primera y la otra
   se marca como repetida.
4. **Dado** los datos obligatorios del negocio (cédula y email por defecto; los fija el super admin),
   **entonces** las filas a las que les falta alguno se marcan con error y no se importan.

---

### Casos límite

- **Tope del plan** (Free: 50 pacientes): la vista previa avisa «tu plan permite N pacientes más» y
  sólo se importan hasta ese número.
- **Archivo grande:** como mucho 5.000 filas por importación; más, se pide partirlo.
- **Excel con varias hojas:** se elige la hoja. Las filas vacías se ignoran.
- **Cédulas con guiones o espacios, o teléfonos en otro formato:** se limpian como en el formulario de
  hoy («0912-345675» → «0912345675»).
- **Fechas, fórmulas o celdas raras:** se lee el valor que se ve.
- **Rol Recepción o Profesional:** no ven «Importar» (es una tarea de puesta en marcha).
- **ntfy:** un solo aviso por importación, con la cifra («se importaron 200 pacientes»), sin nombres.
- **Actividad:** una entrada, «Importó 200 pacientes (3 ya existían, 5 con errores)».

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **RF-001**: Clientes DEBE tener «Importar pacientes» para el propietario, los administradores y el
  super admin en modo soporte.
- **RF-002**: Se DEBEN aceptar archivos .xlsx y .csv, de hasta 5.000 filas.
- **RF-003**: Las columnas DEBEN reconocerse por nombres habituales y poder asignarse a mano.
- **RF-004**: Cada fila DEBE validarse con las mismas reglas del formulario de paciente del negocio:
  la cédula con su dígito verificador, los datos obligatorios del negocio, el email y el teléfono.
- **RF-005**: La vista previa DEBE decir cuántos se importarán, cuántos ya existían y cuáles tienen
  errores, con la fila y el motivo.
- **RF-006**: Importar DEBE crear sólo los válidos y nuevos, sin tocar los que ya existían, respetando
  el tope de pacientes del plan.
- **RF-007**: Importar NO DEBE enviar emails a los pacientes.
- **RF-008**: Si la importación falla a medias (se corta la conexión), NO DEBEN quedar pacientes
  duplicados al repetirla.
- **RF-009**: La actividad DEBE registrar una entrada por importación, y ntfy un solo aviso con la
  cifra.
- **RF-010**: Se DEBE poder descargar un archivo de ejemplo con las columnas.
- **RF-011**: La beta DEBE tener lo mismo con sus datos de prueba.

### Entidades clave

- **Importación**: archivo, columnas asignadas, filas válidas, repetidas y con error, y quién la hizo.
- **Paciente**: los importados quedan marcados como «importado» en su origen, como hoy se marcan los
  de la página de reservas.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Importar 500 pacientes desde un Excel lleva menos de 2 minutos, contando la revisión.
- **CE-002**: Ningún paciente queda duplicado por cédula después de importar, aunque se repita la
  importación (comprobado en pruebas).
- **CE-003**: Ningún paciente importado recibe emails.
- **CE-004**: Las pruebas pasan y la pantalla se usa sin desplazamiento horizontal a 390 px.

## Supuestos

- **Exportar** pacientes no entra (no se pidió).
- **Importar citas o historia clínica** no entra: sólo los datos del paciente.
- **El archivo no se guarda:** se lee en el navegador, se envían los datos de cada fila y se olvida.
