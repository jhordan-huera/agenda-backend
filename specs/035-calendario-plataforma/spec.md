# Especificación: El calendario de la plataforma, sólo con cifras

**Carpeta**: `specs/035-calendario-plataforma` (rama de trabajo: `dev`) · **Creada**: 2026-10-22

**Estado**: Publicada (2026-10-22, PR backend #54 y front #40)

**Repos**:
- **agenda-backend:** el endpoint con las cifras del calendario y su prueba. Sin migración.
- **agenda-front:** la página «Calendario» del /admin.
- **La beta:** no la lleva, porque su /admin tampoco tiene la Analítica (valor por defecto; confirmar al aprobar).

## Pedido

El dueño del producto, el 2026-10-22: «¿puedo yo como super admin ver un calendario con todas las citas de
los profesionales? ¿Es ético hacer eso?».

Se le explicó que **no es ético** ver las citas de todos los negocios con sus pacientes:
- las citas son de cada negocio y Agenda360 las guarda para prestarle el servicio;
- una cita ya es un dato de salud («Psicología, martes 10:00»);
- la política de privacidad dice que el soporte entra al panel de un negocio «para darle asistencia».

La alternativa recomendada fue **un calendario de la plataforma sólo con cifras**, y el dueño respondió: «dame
haciendo lo que me recomiendas».

**Lo que sí ve:** cuántas citas hay cada día y cada hora, en qué negocios, en qué estado y de qué
profesional. **Lo que nunca ve aquí:**
- el paciente;
- el servicio, porque también puede delatar, como «Terapia de pareja»;
- las notas;
- la cita suelta.

Las citas de un negocio se siguen viendo en modo soporte, como hoy.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - Ver la carga de la plataforma en el mes (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** /admin → **Calendario**, **entonces** se ve el mes actual. Cada día lleva:
   - sus citas, sin contar las canceladas;
   - en cuántos negocios;
   - un fondo más intenso cuantas más citas tiene.
2. **Dado** un día pasado con citas que siguen Pendientes o Confirmadas, **entonces** lleva la marca
   «N sin cerrar».
3. **Dado** las flechas y «Hoy», **entonces** se cambia de mes. Arriba está el total del mes.
4. **Dado** los filtros «Tipo de negocio» y «Negocio», **entonces** las cifras son sólo de esos negocios.
5. **Dado** un negocio suspendido, **entonces** no cuenta. El calendario lleva sólo los activos, como la
   Analítica.

### Historia 2 - Ver las horas de más carga en la semana (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** la vista **Semana**, **entonces** se ve un mapa de los 7 días por horas:
   - cada casilla, las citas que empiezan en esa hora, con su número y un fondo más intenso cuantas más
     hay;
   - el total de cada día y de cada hora.
2. **Dado** las horas, **entonces** son las de cada negocio y sólo se muestran las que tienen citas esa
   semana, de las 7:00 a las 20:00 como mínimo.

### Historia 3 - Ver el detalle de un día o de una hora (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** un día del mes o una casilla de la semana, **cuando** se toca, **entonces** se abre un panel con
   cada negocio que tiene citas ese día, o a esa hora:
   - su nombre y su tipo;
   - sus citas por estado, con los nombres del tablero de la spec 034: Por confirmar, Confirmadas,
     Atendidas, Pagadas, No asistió y Canceladas;
   - cuántas llegaron por la reserva online y cuántas siguen sin cerrar;
   - sus profesionales, cada uno con su número de citas;
   - el enlace «Ver ficha del negocio».
2. **Dado** el panel, **entonces** no lleva ni pacientes, ni servicios, ni notas, ni horas de citas sueltas.

### Casos límite

- **Un día sin citas:** la casilla queda vacía y tocarla no abre nada.
- **Muchos negocios en un día:** el panel los ordena de más a menos citas y se desplaza por dentro.
- **A 390 px:** el mes y la semana caben en 7 columnas, sin desplazamiento horizontal ni nada cortado por el
  borde. El panel sube desde abajo.
- **Claro y oscuro,** con contraste 4,5:1, foco visible, y el número siempre escrito: el color nunca va solo.
- **Si falla la carga,** se ve el error con «Reintentar».

## Requisitos *(obligatorio)*

- **RF-001**: El /admin DEBE tener la página «Calendario», con las vistas Mes y Semana, las flechas, «Hoy» y los filtros «Tipo de negocio» y «Negocio».
- **RF-002**: Las cifras DEBEN contar sólo los negocios activos. El total del día y de la hora no cuenta las canceladas, y «sin cerrar» son las de días pasados que siguen Pendientes o Confirmadas.
- **RF-003**: El panel de un día o de una hora DEBE dar, por negocio, las cifras de la Historia 3.
- **RF-004**: La API y la página NO DEBEN llevar nada del paciente ni de la cita suelta. Prohibido: el nombre, el contacto, el servicio, las notas, el identificador de la cita y su hora exacta. Sólo cifras por día, hora, negocio, profesional y estado.
- **RF-005**: Sólo el super admin DEBE poder verlo, con la verificación en dos pasos, como el resto del /admin. Mirarlo no va a la actividad, porque es una consulta.
- **RF-006**: La constitución DEBE decir que el super admin no tiene un calendario con las citas de los negocios, sólo con cifras.

## Criterios de éxito *(obligatorio)*

- **CE-001**: La prueba del backend comprueba:
  - las cifras de un caso conocido;
  - los filtros;
  - que los suspendidos no cuentan;
  - que la respuesta no lleva nada del paciente ni del servicio;
  - que un usuario sin rol de super admin recibe 403.
- **CE-002**: Las comprobaciones pasan: build, lint y `check:contrast` en el front; `typecheck` y `npm test` en el backend.
- **CE-003**: El recorrido funciona en el computador y en el celular (390 px), en claro y oscuro, sin desplazamiento horizontal de la página.

## Supuestos

- **Las horas son las de cada negocio.** Hoy todos están en Ecuador, así que coinciden.
- **Se calcula al abrir la página.** No hay foto diaria del cron: el periodo es corto y las cuentas son
  pocas. Se limita a 42 días por consulta.
- **No lleva cifras de dinero.** Los ingresos estimados ya están en la Analítica.
- **El menú:** «Calendario» va después de «Analítica».
