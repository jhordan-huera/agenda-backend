# Plan de implementación: El menú con grupos y que se encoge

**Rama**: `dev` · **Fecha**: 2026-10-22 · **Spec**: [spec.md](./spec.md)

## Diseño

1. **Los grupos:**
   - en `front/src/components/layout/nav-items.ts`, `ADMIN_NAV_ITEMS` pasa a `ADMIN_NAV_GROUPS`
     (`{ label, items }[]`);
   - `SidebarNav` acepta grupos. Cada uno es una lista con su título pequeño, en el gris del menú, y el
     título se asocia a la lista para los lectores de pantalla.
2. **Lo encogido:**
   - **El estado:** un contexto `SidebarCollapse` en `AppShell`, guardado en
     `localStorage` («agenda360:menu-encogido»). Sólo actúa desde `lg` (1024 px).
   - **El ancho:** el `aside` pasa de `w-60` a `w-16` y el contenido de `lg:pl-[16.75rem]` a
     `lg:pl-[5.5rem]`, con una transición de 200 ms (ninguna con «reducir movimiento»).
   - **Encogido:**
     - `SidebarNav` muestra sólo los iconos, cada uno con el `Tooltip` de siempre y su `aria-label`;
     - los títulos de los grupos se vuelven una línea fina;
     - el logotipo queda en su marca;
     - la caja del panel o del negocio se oculta;
     - el usuario queda en su avatar;
     - la campana, «Instalar» y «Cerrar sesión» quedan como iconos con su nombre.
   - **El botón:** «Ocultar menú» / «Mostrar menú», con los iconos `PanelLeftClose` y `PanelLeftOpen`,
     abajo del menú y con `aria-expanded`.
3. **Los dos menús:** `admin-sidebar.tsx` y `sidebar-content.tsx` leen el contexto. El cajón del celular
   los pinta siempre completos.
4. **La beta:** los mismos archivos. Antes, una copia de `src`.

**Migración:** ninguna. **Backend:** nada.

## Comprobación contra la constitución

| Principio | ¿Cumple? | Cómo |
|---|---|---|
| III. Decisiones | Sí | Lo que eligió el dueño el 2026-10-22 |
| VI. Barato | Sí | Sin dependencias nuevas: `Tooltip` y los iconos ya están |
| VII. Diseño | Sí | Tokens de la marca, foco visible, teclado, 390 px sin cambios y movimiento reducido |

## Pruebas

- **Front y beta:** build, lint y `check:contrast`.
- **El recorrido,** en Chromium a 1440 y 1024 px y en WebKit a 390 px, en claro y oscuro, en el panel de un
  negocio y en el del super admin:
  - los grupos;
  - encoger y mostrar, con el ratón y con el teclado, y que se recuerde al recargar;
  - el nombre al pasar el ratón;
  - la página actual marcada;
  - el contenido más ancho;
  - nada cortado.
