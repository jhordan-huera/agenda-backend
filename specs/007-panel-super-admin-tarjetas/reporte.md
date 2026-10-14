# Reporte final: Panel del super admin con tarjetas y colores propios

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada en dev · **Fecha**: 2026-10-14

**Repos**: los dos (agenda-front y agenda-backend) y la beta · **Migración**: Sí: `035_panel_colors.sql`

## Resumen

El panel del super admin se ve como un solo producto:
- todas las pantallas tienen el mismo encabezado y, donde corresponde, una fila de cifras con su
  ícono;
- Negocios, Usuarios y Categorías van en tarjetas (Negocios y Usuarios, con botón para pasar a
  lista);
- la ficha de cada negocio tiene una cabecera con el color del panel, 4 cifras y pestañas.

Cada super admin puede elegir los colores de su panel en Configuración. Se guardan en su cuenta y no
cambian nada del panel de los negocios.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – Ver los negocios en tarjetas | P1 | Hecha | Cifras, filtros con su número, tarjetas y lista recordada |
| H2 – La ficha del negocio ordenada en pestañas | P1 | Hecha | Cabecera, 4 cifras y Resumen, Equipo, Ajustes y Actividad |
| H3 – El resto del panel con el mismo estilo | P1 | Hecha | Usuarios, Categorías, Actividad, Planes, Configuración e Inicio |
| H4 – Los colores de mi panel | P2 | Hecha | Paletas de los negocios o dos colores, guardados en la cuenta |

## Comprobación

Todo en local: base de prueba, API local y datos de demostración. El recorrido con Playwright
(`panel-007.mjs`) hace cada acción de verdad en la base local, salvo donde se indica.

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – Mismo encabezado | Cumple | Las 8 pantallas usan el mismo encabezado. Capturas en escritorio y a 390 px |
| RF-002 – Fila de cifras | Cumple | Negocios, Usuarios, Categorías, Actividad y la ficha. Recorrido: «Cerca del límite», «Intentos fallidos (24 h)», las 4 de la ficha |
| RF-003 – Filtros con su número | Cumple | Recorrido: «Pro 3» deja 3 tarjetas; con «fisio», 1; «Propietarios» deja 6 |
| RF-004 – Tarjeta de negocio | Cumple | Recorrido: 6 tarjetas. Las de Business muestran «ilimitado» sin barra |
| RF-005 – Tarjetas o lista | Cumple | Recorrido: «Lista» muestra la tabla y se recuerda al recargar; en el celular siempre tarjetas y sin botón |
| RF-006 – Tarjeta de cuenta | Cumple | Recorrido: el menú cambia la contraseña y desactiva o reactiva; el super admin, sin menú |
| RF-007 – Ficha con pestañas | Cumple | Recorrido: 4 pestañas, `?pestana=equipo` sigue al recargar, lo escrito en Ajustes sigue al cambiar de pestaña |
| RF-008 – Categorías en tarjetas | Cumple | Recorrido: crear, editar y eliminar; una en uso no se puede eliminar |
| RF-009 – Actividad por día | Cumple | Recorrido: «Hoy» y fechas, con filtros y exportación |
| RF-010 – Planes, Configuración e Inicio | Cumple | «Más usado» en Pro; Configuración en dos columnas; Inicio con su estilo |
| RF-011 – Nada se pierde | Cumple | Ver CE-001 |
| RF-012 – Colores del panel | Cumple | Recorrido: elegir Eucalipto y guardar |
| RF-013 – En la cuenta, sólo la propia | Cumple | `panel-colors.test.ts`: otro super admin conserva los suyos; un id ajeno en el pedido no cambia nada. Recorrido: siguen en otro navegador |
| RF-014 – En todo el panel | Cumple | Recorrido: el color cambia en todas las pantallas. Capturas: menú, cabecera y gráficos en verde |
| RF-015 – No en los negocios | Cumple | Recorrido: «Gestionar negocio» usa los colores del negocio. Prueba: un propietario recibe 403 y su sesión trae `null` |
| RF-016 – Sin datos de pacientes nuevos | Cumple | Las pantallas usan los mismos datos de hoy; la ruta nueva sólo guarda colores |
| RF-017 – Celular y accesible | Cumple | Las 8 pantallas sin desplazamiento horizontal a 390 px. Las 4 pestañas caben a 390 px. Filtros y vista como grupos de radio con flechas |
| RF-018 – Beta | Cumple | Build y lint. Recorrido en el 3199 (`beta-007.mjs`), 22 de 22: las pantallas en escritorio y a 390 px, la ficha con 4 pestañas, «No disponible en la beta» en Actividad y los colores guardados en la cuenta, que siguen al recargar |
| CE-001 – Todas las acciones siguen | Cumple | Recorrido, una por una. **Se hicieron de verdad:** suspender y reactivar, cambiar plan y agendas, guardar datos obligatorios y varios pacientes, eliminar un negocio creado para la prueba, categorías (crear, editar, eliminar), rechazar una solicitud de plan, exportar la auditoría, ajustes de soporte, desactivar y reactivar una cuenta. **Sólo se abrieron**, para no cambiar datos de demostración: crear negocio, agregar miembro, cambiar contraseñas, agregar super admin y «Activar» la verificación en dos pasos |
| CE-002 – Ajustes a un toque | Cumple | Cada sección está a una pestaña; Ajustes cabe en una pantalla de escritorio |
| CE-003 – Colores al momento y en otro equipo | Cumple | Recorrido y `panel-colors.test.ts` |
| CE-004 – Contraste con cualquier paleta | Cumple | Las mismas paletas y el mismo cálculo de los negocios (`resolveBrandPalette`, que ajusta los tonos). No se midió paleta por paleta |
| CE-005 – 390 px | Cumple | Capturas de las 8 pantallas, desplazamiento 0 |
| CE-006 – Pruebas | Cumple | `panel-colors.test.ts`: 20 comprobaciones |

**Panel de los negocios sin cambios:** capturas de Configuración → Colores, Notificaciones y
Actividad de un negocio, antes y después, en escritorio y a 390 px, con el mismo servidor y los
mismos datos. Salen **iguales píxel por píxel**.

**Pruebas automáticas:**
- backend: `npm run typecheck` y `npm test`, 43 de 43, con `panel-colors` (20);
- front y beta: `npm run build` y `npm run lint` sin errores ni avisos nuevos;
- recorrido con Playwright: `panel-007.mjs` 54 de 54 y, en la beta, `beta-007.mjs` 22 de 22;
- la migración 035 se aplicó sin errores en el PostgreSQL 16 local.

## Cambios respecto al plan

- **Configuración en dos columnas desde `xl`, no desde `lg`.** A 1024 px, con el menú, cada columna
  quedaba demasiado angosta para el formulario de contraseña y las paletas.
- **Paletas en 3 columnas** en la tarjeta del super admin cuando va en dos columnas. Las de los
  negocios siguen igual.
- **La pestaña de la ficha cambia al momento** y la dirección la acompaña. Con sólo la dirección, el
  cambio tardaba un instante en verse.
- **Tarjeta de Categorías:** además de lo pedido, muestra el primer servicio sugerido.
- **Usuarios:** se conserva el filtro «Desactivadas», que ya existía (RF-011).
- **«Sin límite»:** las barras de uso dicen «ilimitado», como el resto del panel.
- **Beta:** conserva lo suyo.
  - **Actividad:** mantiene su forma de dos columnas, con la auditoría y los emails agrupados por
    día, y un aviso en lugar de las cifras.
  - **Ficha:** sin «Gestionar negocio» ni las acciones que la beta ya no tenía (eliminar, agregar
    miembro, solicitudes, tipo de negocio).
  - **Configuración:** sin la tarjeta de verificación en dos pasos, y con «Datos de demostración».
  - **Copia previa:** antes de cambiarla se guardó una copia de su código en el scratchpad
    (`beta-src-antes-007.tgz`).
- **Íconos en los títulos de Configuración:** `SettingsSection`, la verificación en dos pasos y la
  contraseña aceptan un ícono opcional. Sin él, se ven como antes.

## Pendientes y riesgos

- **Si el front se publica antes que el backend,** el panel usa los colores de Agenda360 y guardar
  colores falla con un aviso hasta publicar el backend.
- **La migración 035 va antes del backend.** Sin ella, la sesión del super admin falla al leer la
  columna nueva.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 8ce1765 | Spec 007: colores del panel por cuenta de super admin (backend) |
| agenda-front | 35df4b7 | Spec 007: panel del super admin en tarjetas y con colores propios |

## Cómo publicarlo

1. **Migraciones primero.** Las aplica el dueño del producto. Si la 034 (spec 006) todavía no está,
   el mismo comando aplica las dos en orden:
   ```
   npm run db:migrate
   ```
2. **PR `dev` → `main` del backend.** Lleva también la spec 006 y el aviso de citas por ntfy.
3. **PR `dev` → `main` del front.**
4. **Después:** entrar al panel, elegir colores en Configuración y comprobar «Gestionar negocio».

## Texto para el PR

Panel del super admin en tarjetas y con colores propios (spec 007): encabezado y cifras en cada
pantalla, Negocios y Usuarios en tarjetas con opción de lista, ficha del negocio con pestañas y
colores del panel por cuenta. **Migración 035** (`users.panel_colors`), que va antes. Reporte:
`specs/007-panel-super-admin-tarjetas/reporte.md`.
