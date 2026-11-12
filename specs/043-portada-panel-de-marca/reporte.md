# Reporte final: Portada nueva «Panel de marca»

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada (2026-11-11), falta que el dueño del producto apruebe las capturas · **Fecha**: 2026-11-11

**Repos**: agenda-front (y la spec y la constitución en agenda-backend) · **Migración**: No

## Resumen

La portada se rehízo entera con la vista previa que eligió el dueño del producto («Panel de marca»), y las páginas
por especialidad pasaron al mismo estilo con sus mismos textos.

**La portada, en este orden:**
1. la barra;
2. el bloque tomate con «Tu consulta, ordenada desde la primera reserva.», los dos botones y la agenda de la semana
   de ejemplo;
3. «Hecho para»;
4. las 8 funciones con sus ilustraciones;
5. «Tus datos»;
6. las 7 preguntas;
7. el cierre tomate;
8. el pie.

**El estilo:**
- una sola familia de letra (Schibsted Grotesk) en vez de tres;
- la gama de la marca (tomate, durazno y grises);
- sin mayúsculas espaciadas, letra monoespaciada ni palabras sueltas en cursiva;
- un solo movimiento al cargar, la semana que aparece. Las ilustraciones quedan quietas.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – Un profesional entiende Agenda360 en el primer vistazo | P1 | Hecha | El panel de marca, en claro y en oscuro, también con el registro cerrado |
| H2 – El resto de la portada con el mismo estilo | P1 | Hecha | Los mismos textos de hoy |
| H3 – Las páginas por especialidad con el mismo estilo | P2 | Hecha | Con la semana de ejemplo con los servicios de cada especialidad |

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – El panel de marca | Cumple | Recorrido: el título aprobado, los dos botones y la semana con «Ejemplo», sin salirse de la pantalla ([captura](./capturas/portada-1440-claro-inicio.png)) |
| RF-002 – Las secciones en orden | Cumple | Recorrido: `#especialidades`, `#funciones`, `#tus-datos`, `#preguntas` y `#empezar`; 8 funciones, 3 promesas y 7 preguntas. `check:landing` |
| RF-003 – Los textos y sus reglas | Cumple | `check:landing` y `check:specialties`: sin precios, porcentajes, testimonios, la LOPDP ni funciones paradas. Se comprobó que detecta un precio y la LOPDP si se agregan |
| RF-004 – Lo que se quita | Cumple | `check:landing`: sin mayúsculas, letras espaciadas, monoespaciada, cursivas ni las piezas de antes. Recorrido: nada en mayúsculas forzadas en la página |
| RF-005 – Una gama y una familia | Cumple | `check:landing` y el recorrido: los títulos en Schibsted Grotesk; sólo se cargan sus letras |
| RF-006 – Celular y computador, claro y oscuro | Cumple | Recorrido en Chromium a 1440 px en claro, en WebKit a 390 px en oscuro y a 320 px: sin desbordes ni errores. Las preguntas se abren con el teclado; con menos movimiento, la semana no se anima. `check:contrast` |
| RF-007 – Registro cerrado | Cumple | Recorrido: con el registro cerrado, «Quiero mi agenda» abre WhatsApp |
| RF-008 – Título y descripción para Google | Cumple | No cambian: `index.html` y los HTML de las especialidades (`check:specialties`) |
| RF-009 – No pesa más | Cumple | Las letras de la portada bajan de unos 135 KB (las tres familias) a 47 KB. El código de la portada pasa de 1.452 a 460 líneas, y su CSS de 361 a 25 |
| RF-010 – Las páginas por especialidad | Cumple | Recorrido: las tres con sus 6 casillas y sus 3 pasos, sin desbordes ni errores; desde una, «Funciones» del pie vuelve a la portada |
| RF-011 – La constitución | Cumple | 1.42.0 en los dos repos |
| CE-001 – Recorrido con capturas | Cumple | 61 comprobaciones, todas bien ([capturas](./capturas/)) |
| CE-002 – Las comprobaciones del front | Cumple | Build, lint, `check:contrast`, `check:specialties`, `check:data-export`, `check:board` y `check:landing` (nueva) |
| CE-003 – El peso en el celular | Cumple | Ver RF-009 |
| CE-004 – El visto bueno del dueño del producto | Pendiente | Las capturas se le pasan antes de abrir el PR |

## Cambios respecto al plan

- **Las páginas por especialidad llevan en el panel la agenda de la semana con sus servicios**, por ejemplo
  «Limpieza dental» y «Control de ortodoncia» en odontólogos. El plan decía la ilustración de su primera
  casilla, pero esa misma ilustración salía otra vez justo debajo. Los servicios de cada una están en
  `specialties.ts` (`week`).
- **La agenda de la semana** es una tabla con su título para los lectores de pantalla, como decía el plan. Las
  horas libres dicen «Libre».
- **En las pantallas de 320 px,** la barra muestra sólo el símbolo, sin el nombre: con el botón y el menú no cabía.
- **Las ilustraciones** marcan lo hecho en durazno, no en el verde de «confirmada»: una sola gama.

## Pendientes y riesgos

- **Que el dueño del producto apruebe las capturas** antes de publicar.
- **Al traer estos cambios al equipo del dueño del producto,** hay que correr `npm install` en el front:
  cambian las fuentes.
- **La vista previa de WhatsApp** de las páginas por especialidad no cambia: el título y la descripción son los
  mismos.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | d95383f | Spec 043, aprobada |
| agenda-backend | 707a5a7 | Spec 043: plan de implementación |
| agenda-backend | (este commit) | Spec 043: tareas, capturas, reporte y constitución 1.42.0 |
| agenda-front | 31ebd35 | Spec 043: la portada «Panel de marca», las páginas por especialidad, `check:landing` y constitución 1.42.0 |

## Cómo publicarlo

1. **Sin migración ni cambios en el backend.**
2. **El PR `dev` → `main` del front** (y el del backend con la spec y la constitución).
3. **Después:** abrir la portada y las tres páginas por especialidad en el celular y en el computador.

## Texto para el PR

Spec 043: la portada nueva «Panel de marca», que eligió el dueño del producto entre tres vistas previas.
- Arriba, el bloque tomate con el título, los botones y la agenda de la semana de ejemplo.
- Debajo, «Hecho para», las funciones, «Tus datos», las preguntas y el cierre, con los mismos textos.
- Una sola familia de letra, sin mayúsculas espaciadas ni cursivas.
- Las páginas por especialidad, con el mismo estilo.
- Sin migración.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/043-portada-panel-de-marca/reporte.md
