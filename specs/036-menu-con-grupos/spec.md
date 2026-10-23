# Especificación: El menú con grupos y que se encoge

**Carpeta**: `specs/036-menu-con-grupos` (rama de trabajo: `dev`) · **Creada**: 2026-10-22

**Estado**: Implementada (2026-10-22)

**Repos**:
- **agenda-front:** el menú de los dos paneles.
- **agenda-backend:** nada.
- **La beta:** lo mismo.

## Pedido

El dueño del producto, el 2026-10-22, con una captura del menú del super admin: «¿podemos crear submenús
para que se vea bien, y que ese menú se oculte para que se vea más en la pantalla?».

**Sus decisiones (2026-10-22):**
1. **Submenús:** grupos con título, siempre a la vista.
2. **Ocultar:** el menú se encoge a una barra de iconos, con el nombre al pasar el ratón.
3. **Dónde:** en los dos paneles. El del super admin, con grupos y el botón; el de los negocios, sólo con el
   botón, porque tiene pocas páginas.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - El menú del super admin en grupos (Prioridad: P1)

1. **Dado** el /admin, **entonces** el menú tiene tres grupos con su título:
   - **Principal:** Resumen, Calendario y Analítica;
   - **Negocios:** Negocios, Cobros, Planes y Categorías;
   - **Sistema:** Usuarios, Actividad y Configuración.

### Historia 2 - Encoger el menú (Prioridad: P1)

1. **Dado** el computador (desde 1024 px), **cuando** se toca «Ocultar menú», **entonces** el menú queda como
   una barra fina con los iconos y la página se ensancha.
2. **Dado** el menú encogido:
   - el nombre de cada página sale al pasar el ratón o al llegar con el teclado;
   - la página actual sigue marcada;
   - «Mostrar menú» lo devuelve.
3. **Dado** el menú encogido, **cuando** se vuelve a entrar en ese equipo, **entonces** sigue encogido.
4. **Dado** el celular, **entonces** no cambia: el menú sigue detrás de ☰, completo.
5. **Dado** el menú encogido, **entonces** la campana, el usuario y «Cerrar sesión» siguen al alcance,
   como iconos con su nombre.

### Casos límite

- **Claro y oscuro,** con los colores propios del panel, contraste 4,5:1 y foco visible.
- **Con «reducir movimiento»,** encoge sin animación.
- **Al imprimir,** el menú no sale, como hoy.

## Requisitos *(obligatorio)*

- **RF-001**: El menú del super admin DEBE ir en los tres grupos de la Historia 1.
- **RF-002**: Los dos paneles DEBEN poder encoger el menú a iconos en el computador y recordarlo en el equipo.
- **RF-003**: Encogido, cada icono DEBE decir su nombre (al pasar el ratón, con el teclado y para los lectores de pantalla).
- **RF-004**: El celular y la impresión NO DEBEN cambiar.
- **RF-005**: La beta DEBE llevar lo mismo.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Build, lint y `check:contrast` pasan en el front y en la beta.
- **CE-002**: El recorrido, a 1440 y 1024 px y en el celular, en claro y oscuro, encoge y muestra el menú con el ratón y con el teclado, y no deja nada cortado.

## Supuestos

- **Lo encogido se recuerda en el equipo** (localStorage), no en la cuenta.
- **El contenido** conserva su ancho máximo (1280 px): en pantallas de laptop gana unos 175 px; en las muy
  anchas se centra.
