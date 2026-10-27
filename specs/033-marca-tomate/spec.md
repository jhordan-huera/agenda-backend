# Especificación: La marca de Agenda360 en tomate

**Carpeta**: `specs/033-marca-tomate` (rama de trabajo: `dev`) · **Creada**: 2026-10-22

**Estado**: Publicada (2026-10-22, PR backend #54 y front #40)

**Repos**:
- **agenda-front:** los colores de la marca, el icono, la portada, el acceso y los emails.
- **agenda-backend:** la copia compartida de los emails (`sync:shared`). Sin migración.
- **La beta:** lo mismo.

## Pedido

El dueño del producto, el 2026-10-22, al ver la portada de la spec 032, con el botón principal naranja y lo
demás azul: «el sistema tiene que estar adaptado al tomate de los colores, porque está uno tomate y otro
azul».

Eligió **«Toda la marca en tomate»**:
- el logo y el icono;
- la portada y el login;
- el panel por defecto y los emails.

El azul deja de ser el color de Agenda360. Los negocios que eligieron sus propios colores no cambian.

## Requisitos *(obligatorio)*

- **RF-001**: Los colores de Agenda360 DEBEN ser:
  - el principal, **tomate #c2410c**, el mismo naranja del botón de la spec 032;
  - el resaltado, un **durazno suave** en lugar del lila.

  De ellos salen, con la fórmula de siempre (`brand-theme.ts`), el claro, el oscuro, el marco del panel y
  los gráficos. Todo con contraste 4,5:1 (`check:contrast`).
- **RF-002**: Cambian de color:
  - el icono, en todos sus tamaños: el favicon, el de la app instalable, el del iPhone, el del aviso y el
    del QR;
  - el color de la barra del navegador, en `index.html`, `theme-boot.js` y el manifiesto;
  - los emails.
- **RF-003**: La portada usa un solo color: el botón principal es el principal de la marca y deja de haber un naranja aparte.
- **RF-004**: Los negocios con colores propios, y los super admin con los suyos, no cambian. Los que usan los de Agenda360 pasan al tomate, también en su página de reservas.
- **RF-005**: Las paletas listas suman «Azul clásico» (#4a6cb0 con lila), para quien quiera seguir en azul.
- **RF-006**: La beta lleva lo mismo.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Build, lint y `check:contrast` pasan en el front y la beta. `typecheck` y las pruebas pasan en el backend.
- **CE-002**: Las capturas de la portada, el login, el panel y un email en claro y oscuro no tienen restos del azul de la marca.

## Supuestos

- **En producción** hoy 3 negocios usan los colores de Agenda360 y pasan al tomate. 1 tiene colores
  propios y no cambia.
- **Los colores de los estados de las citas** (pendiente, confirmada…) y **los de cada profesional** no
  cambian: no son de la marca.
- **La constitución** pasa a describir la identidad tomate, en la versión 1.28.0.
