# Plan de implementación: Detalle de las tarjetas de «Crecimiento del mes»

**Rama**: `dev` · **Fecha**: 2026-11-11 · **Spec**: [spec.md](./spec.md)

**Sin migración.** Las cifras salen de las citas, los pacientes y los negocios que ya existen. El backend suma una
ruta de lectura; el front, el panel.

## Diseño

1. **El desglose** (`GET /api/admin/growth`, nuevo, en `adminRoutes`):
   - **Quién:** sólo el super admin, con la verificación en dos pasos, como `/admin/stats`. Un propietario recibe
     403 y alguien sin sesión, 401. Leer no va a la actividad.
   - **Qué devuelve:** los dos periodos y las cuatro listas de una vez (`AdminGrowthDetail`, en el código
     compartido). Se pide al abrir el primer panel y se guarda 5 minutos en el navegador. Así, pasar de una
     tarjeta a otra no vuelve a pedir nada.
   - **Cómo cuenta:** con los mismos periodos (`growthPeriodsSql`, en hora de Ecuador) y las mismas condiciones
     que `platformGrowth`. Así, la suma por negocio es la cifra de la tarjeta:

     | Lista | Qué cuenta |
     |---|---|
     | Citas agendadas | Citas creadas en el periodo, sin las canceladas, por negocio |
     | Reservas online | De ésas, las que llegaron por la página de reservas, por negocio |
     | Pacientes nuevos | Fichas creadas en el periodo sin las importadas, por negocio. También cuántas llegaron por la página de reservas y cuántas se crearon desde el panel |
     | Negocios nuevos | Los negocios creados en el periodo, con su fecha de alta, su plan y su estado |

   - **Cada fila de negocio:** el id, el nombre, el estado (activo o suspendido), la cifra de este periodo y la del
     mes pasado. Van de más a menos este mes, luego por el mes pasado y luego por nombre. Los negocios en 0 en los
     dos periodos no salen.
   - **Sólo cifras** (respuestas 1 y 2): ni nombres, emails, teléfonos o cédulas de pacientes, ni citas sueltas,
     servicios o notas.
   - **El costo:** cuatro consultas agrupadas por negocio sobre dos meses de citas y pacientes. Van a la vez, como
     en `getStats`, y sólo cuando se abre un panel: cargar el Resumen no cambia.
   - **El código:** `adminService.getGrowthDetail(ctx)`, junto a `platformGrowth` en `admin-service.ts`, para
     compartir `growthPeriodsSql`.

2. **Las tarjetas** (`front/src/features/admin/growth-section.tsx`):
   - **Cada tarjeta es un botón** con la misma apariencia: `aria-haspopup="dialog"`, el foco visible de siempre y
     un leve cambio al pasar el ratón. Lleva una flecha pequeña («›») que dice que se puede abrir.
   - Mientras cargan las cifras del Resumen, la tarjeta no se puede pulsar.

3. **El panel** (`front/src/features/admin/growth-detail-sheet.tsx`, nuevo), como el panel del día del calendario
   de /admin (spec 035, `day-sheet.tsx`):
   - **Dónde:** a la derecha en el computador (`Sheet`, hasta 28 rem) y desde abajo en el celular (hasta el 92 %
     del alto).
   - **El encabezado:** el nombre de la tarjeta y el periodo («Citas agendadas · del 1 al 11 de noviembre»).
     Debajo, el resumen: «17 citas en 2 negocios», «6 reservas online en 2 negocios», «8 pacientes nuevos en 2
     negocios» o «Ningún negocio nuevo este mes».
   - **Cada fila de negocio:**
     - el nombre, y la marca «Suspendido» si no está activo;
     - la cifra de este mes grande;
     - «antes N» (la del mes pasado) en gris.

     Toda la fila es un enlace a la ficha del negocio en /admin.
   - **Pacientes nuevos:** debajo del nombre, «Por la página N · Desde el panel N».
   - **Negocios nuevos:** el nombre, «Alta el 3 de noviembre», el plan y el estado.
   - **Estados:**
     - cargando: filas de esqueleto;
     - error: «Reintentar» (`ErrorState`);
     - sin nada este mes: «Todavía no hay … este mes», con las filas del mes pasado si las hay.
   - **El pie**, como en el calendario: «Sólo cifras: sin datos de pacientes. Los pacientes de un negocio se ven en
     su modo soporte».
   - **Se cierra** con Escape, tocando fuera o con «Cerrar». El foco vuelve a la tarjeta que lo abrió.
   - **Los datos:** `getGrowthDetail` en el repositorio (`repository.ts` y `api-repository.ts`) y
     `useAdminGrowthDetail(enabled)` en `use-admin.ts`, con `queryKeys.admin.growthDetail`, 5 minutos de caché y
     sin recargar al volver a la pestaña. Sólo se pide cuando hay un panel abierto.

4. **La constitución, 1.40.0, en los dos repos:** la regla de la analítica de /admin suma el detalle de las
   tarjetas, con la misma privacidad: cifras por negocio, sin pacientes ni citas sueltas.

**No se hace:**
- el CSV del detalle: la analítica ya tiene el suyo por negocio;
- la beta (respuesta 3).

## Comprobación contra la constitución

| Principio | ¿Cumple? | Cómo |
|---|---|---|
| II. Privacidad | Sí | Sólo cifras por negocio, como la analítica y el calendario de /admin (spec 035). Una prueba revisa que la respuesta no lleve nombres de pacientes |
| Super admin con dos pasos | Sí | La ruta cuelga de `adminRoutes`, detrás de `requireSuperAdminTwoFactor`, y el servicio llama a `authorizeSuperAdmin` |
| Auditoría | Sí | Es sólo lectura: no va a la actividad, como el resto del Resumen |
| Costo de Vercel | Sí | Se calcula sólo al abrir un panel, una vez cada 5 minutos como mucho. Cargar el Resumen no cambia |
| VII. Diseño | Sí | La gama de la marca y los grises, el mismo panel que el calendario de /admin, contraste AA y 390 px sin desbordes |
| Super admin en tarjetas (2026-10-14) | Sí | No hay menú ni pestañas nuevas: el detalle sale de las tarjetas, como se pidió |

## Pruebas

- **`tests/admin-overview.test.ts`** (la del Resumen, spec 006) suma «Detalle de las tarjetas (spec 042)». Usa
  las citas, los pacientes y los negocios que ya crea en este periodo, en el del mes pasado y fuera de los dos:
  - **El desglose de la Clínica Dental:** suben 2 citas, 1 reserva online y 2 pacientes este mes, y 2 citas, 1
    reserva y 1 paciente el mes pasado. Ni las canceladas ni las de fuera del periodo cuentan.
  - **Por origen:** un paciente nuevo por la página de reservas y uno desde el panel cuentan en su lado. Uno
    importado no cuenta.
  - **La suma** de cada lista es la cifra de la tarjeta (`/admin/stats`), en los dos periodos.
  - **Negocios nuevos:** el de este mes, con su plan y su estado.
  - **Un negocio suspendido** sale con su estado y sigue contando.
  - **Sin negocios en 0** en los dos periodos.
  - **La privacidad:** la respuesta no lleva el nombre ni el email de ningún paciente de prueba.
  - **Sólo el super admin:** un propietario recibe 403 y alguien sin sesión, 401.
- **Backend:** `typecheck` y `npm test`.
- **Front:** build, lint y `check:contrast`.
- **Recorrido en el navegador,** con la base de prueba y capturas para el reporte:
  - en Chromium a 1440 px en claro y en WebKit a 390 px en oscuro;
  - las cuatro tarjetas abren su panel con el ratón y con el teclado (Tab y Enter);
  - Escape lo cierra y el foco vuelve a la tarjeta;
  - la suma cuadra con la tarjeta;
  - una fila abre la ficha del negocio;
  - sin desbordes ni errores en la consola.

## Riesgos

- **Entre cargar el Resumen y abrir el panel puede entrar una cita nueva.** Entonces el panel suma una más que la
  tarjeta. El panel dice su propio total y, al abrirse, se vuelven a pedir las cifras del Resumen. Así quedan
  iguales.
- **Muchos negocios:** la lista se desplaza dentro del panel. Con decenas de negocios, el desglose sigue siendo una
  consulta agrupada por negocio.
