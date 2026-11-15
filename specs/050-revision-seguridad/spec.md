# Especificación: Lo que quedó de la revisión de seguridad

**Carpeta**: `specs/050-revision-seguridad` (rama de trabajo: `dev`)

**Creada**: 2026-11-15

**Estado**: Implementada (2026-11-15)

**Repos**:
- **agenda-backend** (principal): la lista de espera, la ruta antigua, los comprobantes, los enlaces cerrados, las
  contraseñas y el tope de las peticiones.
- **agenda-front:** los tipos y las validaciones compartidas, la página de la lista de espera, la encuesta y las
  cabeceras de la web.
- **GitHub:** los ajustes de Actions y las alertas de Dependabot.

## Pedido

El 2026-11-14 el dueño del producto pidió una revisión de seguridad del sistema. El fallo alto (un nombre enorme que
bloqueaba la API) se arregló primero, aparte (PR backend #79 y front #64, fusionados el 2026-11-15).

El 2026-11-15 el dueño pidió:
- primero, «corrige este pero sin que afecte la funcionalidad»: la lista de espera;
- después, «arregla todos los hallazgos menos este»: todo, menos el token de Gmail con acceso a todo el buzón.

Esta spec recoge esos arreglos. El dueño los aprobó con esas palabras: no se esperó otra aprobación del plan.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - Nadie cambia el teléfono de la espera de otra persona (Prioridad: P1)

Quien se anota desde la página de reservas escribe un email que nadie comprueba. Hoy, con el email de otra persona,
se cambian el nombre y el teléfono de su espera abierta, también la que anotó el equipo. El consultorio llamaría a
quien no es.

**Escenarios de aceptación:**
1. **Dado** que Ana espera con su email, **cuando** alguien se anota con ese email, otro nombre y otro teléfono,
   **entonces** cambian los días, las partes del día y la fecha, pero el nombre y el teléfono de Ana no.
2. **Dado** lo anterior, **entonces** el email «Te anotamos» saluda a Ana y la actividad dice Ana.
3. **Dado** que el equipo anotó a alguien desde el panel, **entonces** la página de reservas tampoco cambia sus datos.
4. **Dado** que el equipo vuelve a anotar a alguien desde el panel, **entonces** sí corrige el nombre y el teléfono.

### Historia 2 - Lo que ya no se usa no muestra datos (Prioridad: P1)

1. **Dado** un miembro del equipo, **cuando** pide `/businesses/:id/professional`, **entonces** recibe 404. Esa ruta
   antigua daba el email, la sala de videollamada y las cuentas bancarias de la primera agenda.
2. **Dado** el enlace de una espera cerrada, **entonces** muestra sólo el negocio, sin el nombre, el email, el
   teléfono ni lo que pidió.
3. **Dado** el enlace de una encuesta vencida, **entonces** muestra sólo el negocio. Una ya respondida muestra sus
   estrellas, sin la cita.

### Historia 3 - El Gmail del negocio no manda enlaces de otros (Prioridad: P2)

1. **Dado** que alguien reserva a domicilio desde la página pública, **cuando** la dirección o la referencia traen un
   enlace o un email, **entonces** la reserva se rechaza con el motivo. Una dirección normal pasa.
2. **Dado** el equipo en el panel, **entonces** sí puede pegar un enlace (por ejemplo, de Google Maps) en la referencia.

### Historia 4 - Un comprobante guardado como otra cosa se rechaza (Prioridad: P2)

1. **Dado** un comprobante que se sube a Supabase con un tipo distinto del indicado (por ejemplo, una foto guardada
   como `text/html`), **cuando** se completa la subida, **entonces** se rechaza y se borran el archivo y su registro.

### Historia 5 - Contraseñas, peticiones, cabeceras y GitHub (Prioridad: P3)

1. **Dado** una contraseña guardada con el costo de antes (10), **cuando** la persona inicia sesión, **entonces**
   entra igual y su contraseña queda guardada con costo 12.
2. **Dado** una petición de más de 100 kB a una ruta sin sesión (`/public`, `/auth`, `/push`), **entonces** se
   rechaza antes de leerla.
3. **Dado** la web, **entonces** manda HSTS, COOP y CORP.
4. **Dado** GitHub Actions, **entonces** exige acciones fijadas por SHA y aprobación para los PR de personas externas.

## Requisitos *(obligatorio)*

- **RF-001**: Desde la página de reservas, anotarse con el email de una espera abierta DEBE actualizar sólo lo que
  pidió (RF-003 de la spec 047), nunca el nombre ni el teléfono. El saludo del email y la actividad DEBEN usar el
  nombre guardado. Desde el panel, el equipo DEBE poder corregirlos.
- **RF-002**: La ruta `GET /businesses/:id/professional` NO DEBE existir.
- **RF-003**: La dirección y la referencia de una visita a domicilio reservada desde la página pública NO DEBEN
  admitir enlaces ni emails. El panel no cambia. La regla NO DEBE tardar con textos enormes.
- **RF-004**: Al completar un comprobante, el tipo con que quedó guardado DEBE ser el indicado. Si no, se rechaza y
  se borra.
- **RF-005**: El enlace de una espera cerrada DEBE devolver sólo el negocio. La encuesta respondida DEBE devolver
  sus estrellas y el nombre de pila, y la vencida sólo el negocio.
- **RF-006**: Las contraseñas nuevas DEBEN guardarse con bcrypt de costo 12. Las anteriores DEBEN rehacerse al
  iniciar sesión.
- **RF-007**: Las rutas sin sesión (`/public`, `/auth`, `/push`) NO DEBEN aceptar cuerpos de más de 100 kB. Las del
  panel siguen en 2 MB y la importación de pacientes en 4 MB.
- **RF-008**: La web DEBE mandar `Strict-Transport-Security`, `Cross-Origin-Opener-Policy: same-origin` y
  `Cross-Origin-Resource-Policy: same-origin`.
- **RF-009**: Los dos repos DEBEN exigir acciones fijadas por SHA y aprobación para los PR de personas externas.
- **RF-010**: Las 2 alertas de Dependabot del front (`minimatch` y `deepmerge`, sólo al compilar) DEBEN quedar
  descartadas con su motivo.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Pasan todas las suites del backend, y en el front la compilación, el lint y todas las `check:*`.
- **CE-002**: Cada arreglo del código tiene su prueba automática. La de la lista de espera falla sin el arreglo.
- **CE-003**: Nada cambia para quien usa la plataforma con sus propios datos: anotarse, reservar, pagar, responder la
  encuesta e iniciar sesión siguen igual.

## Supuestos

- **La espera cerrada** ya no rellena los datos al abrir «Reservar esta hora»: el enlace sólo vale mientras espera.
- **El filtro de enlaces** de la dirección es el mismo que el del nombre (`@`, `://`, `www.` y dominios comunes).
- **HSTS** va sin `includeSubDomains`, para no tocar otros subdominios del dominio.
- **bcrypt 12** tarda unos 200 ms por inicio de sesión (50 ms con 10). Un email que no existe tarda lo mismo.

## Fuera de alcance

- **El token de Gmail con acceso a todo el buzón:** lo dejó fuera el dueño.
- **Saber si alguien es paciente con su cédula y su teléfono** (el aviso «Ya tienes una cita ese día» y el email de
  la confirmación): cerrarlo cambia la regla de la spec 009 que está en la constitución. Queda para que decida el dueño.
- **El identificador del rol de AWS como secreto y borrar los registros antiguos:** el permiso de la herramienta lo
  bloqueó. Lo hace el dueño (los pasos están en el reporte).
- **Limitar los secretos a `main`:** hay que volver a escribir cada valor en un entorno de GitHub.
- **Para decidir, no son fallos:** la base de datos como segunda barrera, el administrador que amplía el acceso a las
  historias y la sala de videollamada fija.
