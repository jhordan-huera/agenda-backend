# Plan de implementación: El calendario de la plataforma, sólo con cifras

**Rama**: `dev` · **Fecha**: 2026-10-22 · **Spec**: [spec.md](./spec.md)

## Diseño

1. **Lo compartido** (en el front, y `npm run sync:shared` en el backend):
   - `src/types`: `AdminCalendar` y `AdminCalendarDay`;
   - `src/lib/validations/admin.ts`: el esquema de la consulta. Lleva `from` y `to` (como mucho 42 días),
     `date`, `hour` (de 0 a 23) y `category` y `businessId` opcionales.
2. **El backend**, en `src/services/admin-calendar-service.ts` (nuevo), con `authorizeSuperAdmin` como la
   Analítica:
   - **`GET /api/admin/calendar?from&to&category&businessId`:** una consulta con `group by` sobre
     `appointments`, unida a los negocios activos. Devuelve sólo números:
     - `days`: por fecha, las citas sin las canceladas, las canceladas, las sin cerrar y los negocios;
     - `hours`: por fecha y hora de inicio, las citas sin las canceladas.
   - **`GET /api/admin/calendar/day?date&hour&category&businessId`:** por negocio, con el nombre y el tipo:
     - las citas por estado, igual que el tablero: Pendientes, Confirmadas, Atendidas (completadas sin
       pagar), Pagadas (completadas y pagadas), No asistió y Canceladas;
     - las online y las sin cerrar;
     - `professionals`: el nombre de cada agenda con su número.

     Se ordena de más a menos citas.
   - **Las columnas** se eligen a mano y sólo son agregados. Nunca se leen `clients`, `services`, `notes`
     ni el `id` de la cita.
   - **Las rutas** van en `src/routes/platform-routes.ts`, bajo `requireSuperAdminTwoFactor`.
3. **El front:**
   - **`src/pages/admin/admin-calendar-page.tsx`** (nuevo), en `/admin/calendar`, con «Calendario»
     (icono `CalendarDays`) después de «Analítica» en `nav-items.ts`. La vista, el mes o la semana y los
     filtros van en la dirección (`?vista=`, `?fecha=`, `?tipo=`, `?negocio=`), como la Analítica.
   - **`src/features/admin/calendar/`** (nuevo):
     - `month-grid.tsx`: 7 columnas. Cada día lleva el número grande, «en N negocios» y la marca
       «N sin cerrar»;
     - `week-heatmap.tsx`: los días en columnas, las horas en filas y los totales;
     - `day-sheet.tsx`: el panel de la Historia 3, con el `Sheet` de siempre, a la derecha y abajo en el
       celular;
     - `calendar-intensity.ts`: la intensidad del fondo, de la marca al 8–40 % sobre `--card`. Es una
       función pura con su prueba en `scripts/check-admin-calendar.ts`.
   - **Las fechas:** se reutilizan `getVisibleDays`, `shiftDate` y `getRangeLabel` de
     `calendar-utils.ts`.
   - **`use-admin.ts`:** `useAdminCalendar` y `useAdminCalendarDay`, con 5 minutos de `staleTime`, sin
     recargar al volver a la pestaña y con `keepPreviousData` al cambiar de mes.
   - **`api-repository.ts`:** las dos llamadas nuevas.
4. **La constitución** pasa a la 1.29.0 en los dos repos. El principio II suma: «El super admin no tiene un
   calendario con las citas de los negocios: el de /admin sólo lleva cifras (spec 035); las citas de un
   negocio las ve en modo soporte, para darle asistencia».

**Migración:** ninguna. Las consultas usan el índice `appointments (business_id, date)`.

## Comprobación contra la constitución

| Principio | ¿Cumple? | Cómo |
|---|---|---|
| II. Privacidad | Sí | Sólo cifras. Lo comprueba una prueba que busca en la respuesta los nombres y servicios de prueba |
| III. Decisiones | Sí | Sigue la decisión del dueño (2026-10-22) y la regla de la Analítica: nada de pacientes en /admin |
| Auditoría | Sí | Es una consulta: no va a la actividad |
| VI. Barato | Sí | Dos consultas agregadas, como mucho de 42 días, y la caché de 5 minutos en el navegador |
| VII. Diseño | Sí | Una sola gama (la marca y los grises), 7 columnas que caben a 390 px, foco y teclado |

## Pruebas

- **`tests/admin-calendar.test.ts`** (nueva), con dos negocios, uno suspendido, varias agendas y todos
  los estados:
  - las cifras por día, por hora y del panel;
  - «sin cerrar»;
  - los filtros por tipo y por negocio;
  - el suspendido no cuenta;
  - los límites: más de 42 días o una hora fuera de rango, 400;
  - un propietario recibe 403, y un super admin sin la verificación en dos pasos, `two_factor_required`;
  - el JSON no contiene el nombre, el email, el teléfono, el servicio ni las notas de los pacientes de
    prueba.
- **Front:** build, lint, `check:contrast` y `check:admin-calendar`.
- **El recorrido,** en Chromium a 1440 px y WebKit a 390 px, en claro y oscuro:
  - el mes y la semana, las flechas, «Hoy» y los dos filtros;
  - el panel de un día y de una hora;
  - el enlace a la ficha del negocio;
  - el teclado;
  - que no haya desplazamiento horizontal.
- **Backend:** `typecheck` y `npm test`.
