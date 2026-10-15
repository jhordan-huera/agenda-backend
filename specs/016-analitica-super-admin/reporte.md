# Reporte final: Analítica del super admin

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Publicada (2026-10-15, PR backend #32 y front #27) · **Fecha**: 2026-10-15

**Repos**: los dos (agenda-backend y agenda-front). La beta no lleva la analítica (decisión del dueño)
· **Migración**: Sí: `043_analytics_snapshots.sql`

## Resumen

/admin tiene una página «Analítica» con cuatro pestañas:
- **Comparar:** todos los negocios en una tabla.
- **Por tipo de negocio:** cada rubro y cada negocio frente a su rubro.
- **Salud y ventas:** una puntuación de 0 a 100 con sus motivos, a quién llamar y a quién ofrecerle
  un plan mayor.
- **Uso y valor:** qué funciones usa cada negocio y lo que Agenda360 le aporta.

Las cifras se preparan cada mañana con el cron de GitHub, sin gastar la CPU de Vercel, y nunca llevan
datos de pacientes. La ficha de cada negocio suma la tarjeta «Frente a su tipo».

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – Comparar los negocios en una tabla | P1 | Hecha | Ordenar, filtrar, buscar, CSV, enlace a la ficha; a 390 px, la tabla se desplaza dentro de su recuadro con el negocio fijo |
| H2 – Cada tipo y cada negocio frente a su tipo | P1 | Hecha | Medianas, «muy distinto», demanda por día y hora; tarjeta «Frente a su tipo» en la ficha |
| H3 – Riesgo de abandono y oportunidades de venta | P1 | Hecha | La fórmula aprobada (`HEALTH`) y los criterios (`UPSELL`); «Llamar», «WhatsApp» y «Email» del propietario |
| H4 – Uso de funciones y valor generado | P2 | Hecha | Adopción de cada función, valor del periodo, antes y después, y totales con «Copiar» |

## Comprobación

Todo en local: las bases desechables de `npm test` y una base de prueba en el puerto 54400 con los
datos demo, ajustados para tener medianas y un negocio en riesgo. Todo ficticio.

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – La página, sólo del super admin | Cumple | Recorrido; `analytics`: un propietario recibe 403 |
| RF-002 – 30 o 90 días frente al periodo anterior | Cumple | `analytics` y recorrido (el periodo queda en la dirección) |
| RF-003 – La tabla con sus cifras, filtros, CSV y ficha | Cumple | `analytics`: 14 negocios con cifras contadas a mano (por ejemplo, el grande: 40 citas frente a 32, +25 %, 30 % online, 20 % de inasistencias, 8 de 20 confirmadas, $500 estimados y $250 cobrados); recorrido: ordenar, filtrar, buscar y el CSV |
| RF-004 – «Pocos datos» con menos de 10 citas | Cumple | Se ven atenuadas, no cuentan para las medianas, no se comparan y van al final al ordenar |
| RF-005 – Los tipos y cada negocio frente a su tipo | Cumple | `analytics`: medianas, «muy distinto», «pocos datos» del tipo y demanda; recorrido: pestaña y ficha |
| RF-006 – La salud, con su grupo y sus motivos | Cumple | `analytics`: cada regla resta lo aprobado, con su motivo y sus límites |
| RF-007 – «En riesgo» y «Listos para subir de plan» | Cumple | `analytics`: cada criterio de venta; recorrido |
| RF-008 – Funciones, adopción, valor, antes y después, totales | Cumple | `analytics`: inasistencias 25 % → 20 % en el negocio grande, y sin datos suficientes no se muestra |
| RF-009 – Sin datos de pacientes | Cumple | `analytics`: la foto entera no tiene el nombre, email, teléfono ni cédula de ninguno de los 138 pacientes de prueba; el CSV del recorrido tampoco |
| RF-010 – Los negocios no lo ven | Cumple | Es una ruta de /admin (verificación en dos pasos) y una página de /admin |
| RF-011 – Una vez al día, fuera de Vercel | Cumple | `analytics`: el cron prepara una foto al día y no la repite; la ruta sólo lee una fila |
| RF-012 – 390 px | Cumple | Recorrido: la página no se desplaza en horizontal y la tabla sí, dentro de su recuadro |
| RF-013 – La beta no la lleva | Cumple | No se tocó la beta |
| CE-001 – En menos de un minuto, los de más inasistencias y los que están en riesgo | Cumple | Ordenar por «% inasistencias» y la pestaña «Salud y ventas» |
| CE-002 – Las cifras coinciden con las contadas a mano | Cumple | `analytics` (103 comprobaciones) |
| CE-003 – Ninguna pantalla ni descarga con pacientes | Cumple | `analytics` y el CSV del recorrido |
| CE-004 – Abrir la analítica no recalcula | Cumple | La ruta lee la última foto |
| CE-005 – Pruebas y 390 px | Cumple | Ver abajo |

**Pruebas automáticas:**
- **Backend:** `npm run typecheck` sin errores y `env -u DATABASE_URL npm test`: 56 de 56 suites.
  `analytics` es nueva, con 103 comprobaciones.
- **Front:** `npm run build` y `npm run lint` sin errores ni avisos.

**Recorrido:** 78 de 78, en escritorio y a 390 px. En local, la foto de 6 negocios tardó menos de un
segundo.

## Cambios respecto al plan

- **Las tasas con «pocos datos»** se ven atenuadas en vez de vacías (la spec dice «llevan la marca»).
- **La ruta** siempre responde `{ snapshot }`, con la foto o con `null`.
- **La foto lleva campos de más:**
  - el periodo y la zona;
  - la moneda;
  - el tamaño del equipo;
  - las citas sin cerrar;
  - la comparación con el tipo;
  - los usuarios en el uso del plan;
  - la fecha de partida del antes y después;
  - cuántos negocios tienen datos en cada tipo.
- **Pacientes nuevos:** no cuentan los importados, como en el Inicio (spec 006).
- **«Sin tipo»** hoy no puede pasar, porque la categoría es obligatoria. Está hecho y probado con datos
  simulados.
- **Cancelaciones con tiempo:** no cuentan las de «Cancelar ésta y las siguientes» de una serie,
  porque la actividad no las registra cita por cita.
- **Pro con mucha demanda** en la foto de 90 días: 120 citas cada 30 días.
- **Una zona horaria guardada que no existe** cuenta como la de Ecuador, para que un negocio así no
  deje a todos sin foto.
- **`npm run analytics:refresh`** no escribe en la base de producción desde el equipo: allí la foto la
  prepara el cron (la constitución: producción sólo se consulta desde el equipo).
- **Fuera de la spec:** en la misma tanda se publica la tarjeta «Base de datos» de Salud, pedida por
  el dueño el 2026-10-15 (commits aparte).

## Pendientes y riesgos

- **Sin comprobar:**
  - el cron en GitHub con datos reales;
  - el motor de Safari (se probó con Chromium);
  - que «Copiar» llegue al portapapeles;
  - que los enlaces de llamar, WhatsApp y email abran.
- **Los pesos de la salud son una primera versión:** se ajustan en `HEALTH`, en
  `analytics-service.ts`.
- **Las cifras son de la mañana.** Lo que pasa durante el día sale al día siguiente.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 1a1a562 | Spec 016: spec y plan de la analítica del super admin (plan por aprobar) |
| agenda-backend | 21ee067 | Spec 016: tareas y constitución 1.13.0 (plan aprobado) |
| agenda-front | 575994b | Constitución 1.13.0: la analítica del super admin (spec 016) |
| agenda-backend | (el de esta entrega) | Spec 016: analítica del super admin (backend) y reporte |
| agenda-front | (el de esta entrega) | Spec 016: analítica del super admin (front) |

## Cómo publicarlo

1. **La migración 043,** como paso aparte, antes del PR del backend:

   ```
   cd ~/Documentos/Proyectos/Backend/agenda-backend
   npm run db:migrate
   ```

2. **Primero el PR del backend y después el del front.** En la misma tanda va la tarjeta «Base de
   datos».
3. **La primera foto** la prepara el cron en su siguiente pasada, si ya pasaron las 06:00 de Ecuador.
   Para no esperar, en GitHub → Actions → el workflow del cron → «Run workflow».
4. **Después:**
   - `/api/health` `"ok":true`;
   - en /admin → «Analítica» deben salir los datos y en Salud, la tarjeta «Base de datos».

## Texto para el PR

Spec 016, analítica del super admin. /admin → «Analítica» tiene cuatro pestañas:
- la tabla comparativa de los negocios;
- cada tipo de negocio y cada negocio frente a su tipo;
- la salud de 0 a 100, con quién está en riesgo y quién está listo para subir de plan;
- el uso de funciones y el valor generado.

Una foto diaria preparada por el cron, sin datos de pacientes. Incluye la tarjeta «Base de datos» de
Salud.

**Migración:** `043_analytics_snapshots.sql`, aplicada antes del backend.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/016-analitica-super-admin/reporte.md
