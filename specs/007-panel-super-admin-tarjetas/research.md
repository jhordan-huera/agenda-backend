# Decisiones técnicas: Panel del super admin con tarjetas y colores propios

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Las tres decisiones de producto (tarjetas con botón de lista, ficha con pestañas y colores por
cuenta) las tomó el dueño del producto. Aquí está cómo se llevan al código.

## D1. Dónde se guardan los colores

- **Decisión:** una columna `panel_colors jsonb` en `users`, nula por defecto (nula = colores de
  Agenda360). Lleva la misma comprobación que `businesses.brand_colors`: dos colores `#rrggbb`.
- **Por qué:** es un dato de la cuenta, cabe en una columna, sigue al super admin en cualquier equipo
  (RF-013) y reutiliza la forma de guardar los colores de los negocios.
- **Descartado:**
  - una tabla de preferencias aparte: demasiado para un solo dato;
  - guardarlos en el navegador: no se verían en otro equipo;
  - `platform_settings`: el dueño del producto eligió colores por cuenta, no para toda la plataforma.

## D2. Cómo llegan al panel

- **Decisión:** la sesión (`Session`) gana `panelColors`. Viene con los colores para el super admin y
  `null` para el resto. `resolveSession` los lee con una consulta pequeña, sólo si la cuenta es de
  super admin.
- **Por qué:** el panel se pinta con sus colores desde el primer momento, sin un pedido más y sin
  parpadeo. Las cuentas de los negocios no hacen ninguna consulta nueva.
- **Descartado:** añadirlos a `User`. Viajarían en todas las listas de usuarios sin hacer falta.

## D3. Cómo se guardan

- **Decisión:** `PUT /api/admin/panel-colors` con `{ colors }`, que guarda los colores en la cuenta
  de quien hace el pedido. No lleva el id de otra cuenta, así que nadie puede cambiar los de otro.
  Está dentro de `/admin`: exige ser super admin y tener la verificación en dos pasos. Se valida con
  `panelColorsSchema` (nuevo en `lib/validations/admin.ts`, compartido), que usa el `brandColorsSchema`
  de los negocios.
- **Sin auditoría:** es una preferencia personal y no cambia nada de la plataforma ni de los
  negocios. Así la auditoría no se llena de cambios de color.

## D4. Cómo se aplican

- **Decisión:** `AdminLayout` envuelve el panel con el `BrandThemeProvider` que ya usan los negocios,
  con `session.panelColors`. Las variables van en `<html>`, así que también las toman los diálogos y
  los menús, y se quitan al salir del panel.
- **Gestionar negocio:** el panel del negocio está en otro layout (`DashboardLayout`) con los colores
  del negocio. Al cambiar de layout, el proveedor del panel de plataforma se desmonta y quita los
  suyos (RF-015). Lo mismo pasa en la portada, el inicio de sesión y la página de reservas.
- **Al guardar:** se refresca la sesión (`refresh()` del `SessionProvider`) y los colores cambian al
  momento.
- **Contraste (CE-004):** `resolveBrandPalette` ya ajusta los tonos para que se lean. Es la misma
  garantía que tienen los negocios.

## D5. Los gráficos siguen los colores

- **Decisión:** los gráficos del inicio (spec 006) dejan de usar colores fijos y toman los de la
  paleta con `useChartColors()`, como los de Reportes. Se quedan fijos sólo el gris del «mes pasado»
  y el rojo de los «fallidos», porque significan algo.
- **Por qué:** lo pide la constitución (VII: no fijar colores que ignoren la marca). Con los colores
  de Agenda360 se ven igual que hoy.

## D6. Un solo selector de colores

- **Decisión:** la parte de elegir colores de `brand-colors-settings.tsx` (paletas listas y los dos
  colores) pasa a `features/branding/brand-colors-picker.tsx`. La usan:
  - los colores del negocio, que se ven igual que hoy y conservan su vista previa;
  - la tarjeta nueva `features/admin/panel-colors-card.tsx`, con una vista previa del panel de
    plataforma (menú, botón, insignia y barras).
- **Por qué:** las mismas paletas y las mismas reglas, sin copiar código (RF-012). Antes y después se
  saca una captura de la configuración de un negocio para comprobar que no cambió.

## D7. Tarjetas o lista

- **Decisión:** un `ViewToggle` («Tarjetas» / «Lista») con `useViewPreference("negocios" | "usuarios")`,
  que recuerda la elección en el navegador. Cada lectura y escritura va en `try/catch`; si falla, se
  muestran tarjetas.
  - **Por defecto:** tarjetas.
  - **En el celular:** siempre tarjetas y sin botón (la tabla de hoy ya se ve en tarjetas ahí).
  - **La lista:** es la tabla de hoy, movida a `businesses-table.tsx` y `users-table.tsx`.
- **Por qué:** es una preferencia del equipo, no de la cuenta (spec, entidades clave).

## D8. Pestañas de la ficha

- **Decisión:** las `Tabs` de `components/ui`, con la pestaña en la dirección:
  `?pestana=resumen|equipo|ajustes|actividad`, con `replace` para no llenar el historial. Así se
  mantiene al recargar y al volver atrás (RF-007).
- **Lo escrito sin guardar:** las pestañas se quedan montadas (`forceMount`) y sólo se ocultan. Así
  un ajuste a medio escribir no se pierde al cambiar de pestaña (historia 2, escenario 7).
- **Dirección con otra pestaña:** un valor desconocido abre Resumen.

## D9. Las cifras de arriba

Todas salen de datos que el panel ya pide (RF-002):

| Pantalla | Cifras | De dónde |
|---|---|---|
| Negocios | Activos, suspendidos, nuevos este mes, cerca del límite | Lista de negocios (`nearLimit` de `sales-lists.ts`; «este mes» en Ecuador) |
| Usuarios | Cuentas, propietarios, equipos, sin negocio | Lista de usuarios (mismas reglas que sus filtros de hoy) |
| Categorías | Activas, con historia clínica, en uso | Lista de categorías |
| Actividad | Emails enviados hoy, fallidos hoy, intentos fallidos 24 h, cuentas en alerta | `GET /admin/stats` (`health`), el mismo pedido del inicio y en la misma caché |
| Ficha | Citas del mes, pacientes, usuarios, agendas (frente a su límite) | El uso del negocio (`usage`) que ya trae la ficha |

En la beta, Actividad no muestra esa fila: no tiene emails reales ni inicios de sesión. Dice «No
disponible en la beta», como la salud del sistema.

## D10. Componentes comunes

En `src/features/admin/`, sólo para el panel de plataforma:
- `stat-cards.tsx`: `StatCard` (icono, título, cifra y detalle) y su cuadrícula: 2 columnas en el
  celular y 4 en pantallas anchas;
- `filter-chips.tsx`: botones con su número, como grupo de radio accesible;
- `view-toggle.tsx` y `use-view-preference.ts` (D7);
- `business-card.tsx`, `user-card.tsx` y `category-card.tsx`;
- `business-hero.tsx`: la cabecera de la ficha, con el degradado de la marca (constitución VII) y las
  acciones;
- `panel-colors-card.tsx` (D6).

**El encabezado:** sigue siendo el `PageHeader` compartido que ya usan las 8 pantallas, sin tocarlo,
porque también lo usa el panel de los negocios. La coherencia viene de usarlo igual en todas, con su
fila de cifras debajo.

## D11. Actividad agrupada por día

- **Decisión:** `AuditFeed` y `EmailOutboxCard` (compartidos con el panel del negocio) ganan una
  opción `groupByDay`, apagada por defecto. Así el panel del negocio no cambia. Cada día va en su
  propia tarjeta, con el título «Hoy», «Ayer» o la fecha («martes 12 de octubre»), en hora de
  Ecuador.
- **Descartado:** una lista aparte para el super admin. Duplicaría «Cargar más», los filtros y la
  exportación.

## D12. La beta

- **Archivos de pantalla:** los mismos, respetando lo que la beta tiene distinto (no tiene
  verificación en dos pasos, cron ni copias). Antes de copiar, se compara cada archivo.
- **Datos de prueba:**
  - una colección `panelColors` (`{ userId, colors }`), vacía en los datos que ya estén guardados en
    el navegador;
  - `updatePanelColors` en `mockAdminRepository`;
  - `resolveSession` de `mock-auth-service.ts` devuelve `panelColors`.

## D13. Constitución 1.4.0 (los dos repos)

- **Principio III:** la decisión nueva. El panel del super admin va en tarjetas, con lista en
  Negocios y Usuarios. Cada super admin elige los colores de su panel en su cuenta, y esos colores no
  se aplican a los negocios ni a otros super admins (2026-10-14).
- **Principio VII:** «cada negocio personaliza los suyos» pasa a «cada negocio, y cada super admin
  para su panel, personaliza los suyos».
