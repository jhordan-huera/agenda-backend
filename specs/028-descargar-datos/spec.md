# Especificación: Descargar los datos del negocio

**Carpeta**: `specs/028-descargar-datos` (rama de trabajo: `dev`) · **Creada**: 2026-10-20

**Estado**: Implementada (2026-10-20)

**Repos**:
- **agenda-backend:** reunir los datos que cada persona puede llevarse, quién puede y la actividad.
- **agenda-front:** el botón y el archivo ZIP, que se arma en el navegador.
- **La beta:** no, porque no tiene datos reales.

## Pedido

El dueño del producto, el 2026-10-20: «si el negocio ya no quiere seguir con nosotros, antes de
eliminarse darle la opción de poder descargar clientes e historias», y «esto no lo puede descargar el
super admin, sólo el propietario del negocio o el profesional».

Hoy no hay ninguna forma de descargar los pacientes, las citas ni las historias clínicas. La política
de privacidad dice que la portabilidad se atiende por soporte. Además, el profesional debe conservar
sus historias clínicas según la normativa de salud.

**Decisiones del dueño del producto (2026-10-20):**
1. **Quién descarga:**
   - **el propietario,** todo el negocio;
   - **cada profesional** (rol Profesional), sólo lo suyo;
   - **el super admin, nada,** tampoco en modo soporte.
2. **Cuándo:** siempre, en cualquier momento. No sólo al dejar el servicio.
3. **Las historias clínicas:** una página por paciente, como «Imprimir / PDF», que se abre en el
   navegador y se guarda como PDF.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - El propietario descarga todo su negocio (Prioridad: P1)

**Prueba independiente**: el propietario de un negocio con pacientes, citas, historias y archivos
descarga sus datos y abre el ZIP.

**Escenarios de aceptación**:

1. **Dado** Configuración → Negocio, **entonces** el propietario ve la tarjeta «Descargar los datos
   del negocio», con lo que trae el archivo y el botón «Descargar».
2. **Dado** que lo toca, **entonces** ve el avance («Preparando… 120 de 340 pacientes») y al terminar
   se descarga `agenda360-<negocio>-<fecha>.zip` con:
   - **`pacientes.xlsx`:** nombre, cédula, email, teléfono, dirección, notas, activo y fecha de alta,
     con las columnas de la importación de pacientes, para poder volver a subirlo;
   - **`citas.xlsx`:** fecha, hora de inicio y fin, pacientes, servicio, profesional, estado,
     modalidad, precio, si se pagó y notas;
   - **`historias-clinicas/`:** una página por paciente con historia (por ejemplo «Benítez Lucía -
     0912345678.html»), con sus antecedentes, el consentimiento y todas sus evoluciones con sus
     aclaraciones, igual que «Imprimir / PDF»;
   - **`historias-clinicas/archivos/<paciente>/`:** los archivos adjuntos originales (PDF y fotos);
   - **`LEEME.html`:** qué trae cada archivo, cómo guardar una historia como PDF y la fecha de la
     descarga.
3. **Dado** un negocio sin historia clínica, **entonces** el ZIP sólo trae los pacientes, las citas y
   el LEEME.
4. **Dado** la descarga, **entonces** queda en la actividad: «Descargó los datos del negocio (340
   pacientes, 1.250 citas y 85 historias clínicas)».

### Historia 2 - Cada profesional descarga lo suyo (Prioridad: P1)

**Prueba independiente**: en una clínica con varias agendas, un profesional descarga sus datos y no
aparece nada de los demás.

**Escenarios de aceptación**:

1. **Dado** un miembro con el rol Profesional, **entonces** ve la tarjeta en su Perfil: «Descargar mis
   datos».
2. **Dado** que la descarga, **entonces** el ZIP trae sólo:
   - **sus pacientes:** los de su agenda, con la misma regla de «sólo sus pacientes»;
   - **sus citas:** las de su agenda;
   - **las historias de esos pacientes,** tal como las ve en el panel, sólo si tiene acceso clínico.
3. **Dado** un profesional sin acceso clínico, **entonces** el ZIP no trae historias ni archivos, y la
   tarjeta lo dice.
4. **Dado** la descarga, **entonces** queda en la actividad, con su nombre.

### Historia 3 - Nadie más (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** el super admin, en modo soporte o desde /admin, **entonces** no ve el botón, y la API
   rechaza la descarga con «Por privacidad, sólo el propietario y cada profesional descargan sus
   datos».
2. **Dado** un administrador o la recepción, **entonces** no ven la tarjeta, y la API también se lo
   rechaza.
3. **Dado** un intento rechazado, **entonces** no se entrega ningún dato.

### Historia 4 - Cuando un negocio se va (Prioridad: P2)

**Escenarios de aceptación**:

1. **Dado** la confirmación de «Eliminar negocio» en /admin, **entonces** recuerda: «Antes de
   eliminarlo, pídele al propietario que descargue sus datos en Configuración → Negocio. Después ya no
   se pueden recuperar». Muestra también la fecha de su última descarga, o «Nunca descargó sus
   datos».
2. **Dado** la política de privacidad, **entonces** dice que el propietario y cada profesional pueden
   descargar sus datos en cualquier momento desde su panel, en lugar de «se atiende por soporte».

### Casos límite

- **Un negocio grande:** miles de citas o cientos de archivos. Se descarga por partes, con el avance a
  la vista, y nunca se cuelga la página. Si un archivo adjunto falla, el ZIP se completa igual y el
  LEEME lista los que no se pudieron incluir.
- **Si se cierra la página a mitad,** no queda nada a medias en el servidor.
- **Nombres repetidos o con caracteres raros:** cada archivo lleva el nombre del paciente y su cédula,
  sin caracteres que los sistemas no acepten.
- **Un negocio suspendido** no puede descargar, porque no entra al panel. Antes de suspender a uno que
  se va, el dueño del producto le pide que descargue.
- **En el celular** también funciona: el ZIP queda en Archivos o Descargas.
- **Los pacientes «Por verificar»** van en el Excel de pacientes, marcados.
- **El email de un paciente** se entrega completo, no a medias: es el negocio llevándose sus propios
  datos.

## Requisitos *(obligatorio)*

- **RF-001**: El propietario DEBE poder descargar en cualquier momento un ZIP con los pacientes y las
  citas (Excel), las historias clínicas (una página por paciente) y sus archivos adjuntos.
- **RF-002**: Un profesional (rol Profesional) DEBE poder descargar sólo sus pacientes, sus citas y,
  con acceso clínico, sus historias y archivos.
- **RF-003**: El super admin, también en modo soporte, el administrador y la recepción NO DEBEN poder
  descargar nada: la API lo rechaza y la pantalla no lo ofrece.
- **RF-004**: El Excel de pacientes DEBE tener las columnas de la importación, para volver a subirlo.
- **RF-005**: Cada descarga DEBE ir a la actividad, con quién y cuánto.
- **RF-006**: DEBE funcionar con negocios grandes, por partes y con el avance a la vista, sin cargar el
  servidor de más.
- **RF-007**: «Eliminar negocio» DEBE recordar la descarga y mostrar la última. La política de
  privacidad DEBE decirlo.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Un propietario descarga todo su negocio en menos de un minuto (con cientos de pacientes,
  sin contar los archivos grandes) y lo abre sin programas especiales: Excel y el navegador.
- **CE-002**: El Excel de pacientes descargado se puede volver a importar sin cambios.
- **CE-003**: Un profesional no recibe ningún paciente, cita ni historia de otro profesional. Lo
  comprueban las pruebas.
- **CE-004**: El super admin no obtiene nada, ni en modo soporte. Lo comprueban las pruebas.
- **CE-005**: Las pruebas pasan, y la pantalla se ve bien en los dos modos y a 390 px.

## Supuestos

- **El ZIP se arma en el navegador:** el servidor entrega los datos por partes y los archivos con
  enlaces de pocos minutos, como ya se abren hoy.
- **Ver los datos para descargarlos no cuenta como «Consultó la historia clínica»** de cada paciente.
  La descarga queda en un solo registro de actividad.
- **No hace falta migración,** salvo que el plan lo pida para guardar la fecha de la última descarga.
  Se puede tomar de la actividad.
- **La beta no lo lleva.**
