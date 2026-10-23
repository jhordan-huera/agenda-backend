# Reporte final: El menú con grupos y que se encoge

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada en dev · **Fecha**: 2026-10-22

**Repos**: agenda-front y la beta · **Migración**: No

## Resumen

- **El menú del super admin** va en tres grupos con su título:
  - **Principal:** Resumen, Calendario y Analítica;
  - **Negocios:** Negocios, Cobros, Planes y Categorías;
  - **Sistema:** Usuarios, Actividad y Configuración.
- **Los dos paneles** tienen abajo «Ocultar menú». En la computadora, el menú queda como una barra de
  iconos de 64 px:
  - el nombre de cada página sale al pasar el ratón o con el teclado;
  - la página actual sigue marcada;
  - la campana, la cuenta, «Instalar» y «Cerrar sesión» siguen a mano;
  - «Mostrar menú» lo devuelve.
- **Se recuerda en el equipo.** En el celular no cambia nada: el menú sigue completo detrás de ☰.

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – Los tres grupos | Cumple | Recorrido: los grupos, sus títulos y sus páginas, en orden |
| RF-002 – Encoger y recordarlo | Cumple | Recorrido: de 240 a 64 px, sigue encogido al recargar, y al mostrarlo no queda nada guardado. El contenido gana 176 px a 1024 px y 108 px a 1440 px, hasta su máximo de 1280 |
| RF-003 – Cada icono dice su nombre | Cumple | Recorrido: `aria-label` en cada icono, el nombre al pasar el ratón y al llegar con el teclado. Enter muestra el menú |
| RF-004 – El celular y la impresión | Cumple | Recorrido en WebKit a 390 px: el cajón completo, con nombres y sin el botón, aunque en la computadora esté encogido. La impresión sigue con `print:hidden` |
| RF-005 – La beta | Cumple | Build, lint y `check:contrast`. Recorrido: los dos paneles encogen, se recuerda y se vuelven a mostrar (10 de 10). Su menú sólo lleva las páginas que tiene |
| CE-001 – Las comprobaciones | Cumple | Front y beta: build, lint y `check:contrast` sin errores |
| CE-002 – El recorrido | Cumple | 80 de 80: el panel del negocio y el del super admin, a 1440 y 1024 px, en claro y oscuro, y el celular. Iconos de 40 × 40 px, nada sale de la barra, sin desplazamiento horizontal y contraste de 4,5 o más |

## Cambios respecto al plan

- **El contexto va en su propio archivo** (`sidebar-collapse-context.ts`), y los componentes (la ayuda con el
  nombre y el botón) en `sidebar-collapse.tsx`, como pide el lint para la recarga rápida.
- **Los enlaces del menú marcan la página actual con `aria-current`,** que pone `NavLink`, y no con una
  clase calculada. La ayuda con el nombre (Slot de Radix) sólo junta clases de texto, y con la función se
  perdían el tamaño y la marca.
- **El botón no lleva `aria-expanded`:** el estilo del botón lo pintaba como pulsado. Su nombre ya cambia
  («Ocultar menú» / «Mostrar menú»).
- **Encogido, la cuenta del negocio** se abre a la derecha de la barra.
- **El logotipo** (`Logo`) suma `markOnly`, y «Instalar aplicación» y la cuenta suman `compact`.
- **El título «Menú» del panel del negocio** pasa al gris completo, sin transparencia.
- **La beta** recibe también el armazón actual del front, con el menú como tarjeta flotante: tenía el
  anterior, y el menú que se encoge depende de él.

## Pendientes y riesgos

- **La página actual del menú y las iniciales del avatar** dan 4,42:1 en el modo claro. Es la excepción de
  la spec 007 que ya anota `check:contrast`, que exige 4,5 sólo en el oscuro. Viene de antes y no cambió.
- **En pantallas anchas** el contenido conserva su máximo de 1280 px. Desde unos 1550 px de ancho, encoger
  el menú sólo lo centra.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-front | 3bdeeaa | Spec 036: el menú del super admin en grupos (Principal, Negocios, Sistema) y el menú de los dos paneles que se encoge a iconos, con el nombre al pasar el ratón y recordado en el equipo |
| agenda-backend | COMMIT_BACKEND | Spec 036: documentos y reporte del menú con grupos |

La beta no tiene git. Su respaldo previo está en
`~/Documentos/Proyectos/Betas/agenda-beta-respaldo-antes-de-menu-036-2026-10-22.tar.gz`.

## Cómo publicarlo

1. **Sin migración ni backend.** El PR del front.
2. **Después:** en producción, encoger y mostrar el menú en el panel de un negocio y en el del super admin.

## Texto para el PR

Spec 036: el menú del super admin en grupos, y el menú de los dos paneles que se encoge a una barra de
iconos (con el nombre al pasar el ratón), recordado en el equipo.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/036-menu-con-grupos/reporte.md
