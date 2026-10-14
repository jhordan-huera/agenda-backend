# Reporte final: Inicio del super admin con datos importantes

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Publicada (2026-10-14, PR #23 del backend y #21 del front) · **Fecha**: 2026-10-14 (ampliada el mismo día con gráficos)

**Repos**: los dos (agenda-backend y agenda-front) y la beta · **Migración**: Sí: `034_backup_runs.sql`

## Resumen

Al entrar, el super admin ve tres bloques:
- **Crecimiento del mes:** citas, reservas online, pacientes y negocios nuevos frente a los mismos
  días del mes pasado.
- **Salud del sistema:** emails, cron, copia de seguridad y seguridad, cada uno con su estado y un
  resumen «Todo bien» o «N avisos».
- **Negocios para vender:** los que están cerca del límite de su plan, los que más crecen y los que
  dejaron de usar el sistema.

Cada bloque tiene además su gráfico (historia 5):
- **Crecimiento:** líneas acumuladas día a día, este mes frente al mes pasado completo, para citas,
  reservas online o pacientes nuevos.
- **Salud:** barras con los emails enviados y fallidos de los últimos 14 días.
- **Negocios:** barras con las citas de los negocios activos con más citas, este mes frente a los
  mismos días del mes pasado.

Las copias de seguridad ahora quedan anotadas para poder mostrarlas.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – Ver cómo crece la plataforma este mes | P1 | Hecha | 4 cifras con ▲ ▼, «igual» o «nuevo» |
| H2 – Saber si el sistema está sano | P1 | Hecha | Incluye la migración 034 y la anotación de cada copia |
| H3 – Encontrar negocios a los que venderles | P1 | Hecha | 3 listas con enlace a la ficha de cada negocio |
| H4 – Lo de siempre, arriba y en su lugar | P2 | Hecha | Saludo, planes, «Nuevo negocio» y solicitudes pendientes |
| H5 – Gráficos, no sólo tarjetas | P1 | Hecha | Un gráfico por bloque. La beta no tiene el de emails (no hay emails reales) |

## Comprobación

Todo en local: base de prueba, API local y datos de demostración.

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – Crecimiento del mes con la diferencia | Cumple | `admin-overview.test.ts`: citas, reservas online, pacientes y negocios creados en cada periodo. Las canceladas y las de fuera del periodo comparable no cuentan. Recorrido: los 4 cuadros con su % y su periodo |
| RF-002 – Emails de hoy | Cumple | Prueba: un enviado, un fallido y uno en cola suman uno cada uno. Los descartados a propósito no cuentan |
| RF-003 – Cron | Cumple | Prueba: sin pasadas, `null`; una de hace 3 h trae su hora y sus 3 errores. Recorrido: «Hace 3 h · 1 error en la última pasada», en rojo |
| RF-004 – Copia de seguridad anotada y mostrada | Cumple | `backup.test.ts`: una buena queda con su tamaño; una fallida, con el motivo. Prueba de stats: la última, aquí una fallida. Recorrido: «Falló: … pg_dump falló: tiempo de espera», en rojo |
| RF-005 – Seguridad | Cumple | Prueba: 13 intentos en 24 h y 1 cuenta en alerta (12 en la última hora). Recorrido: «1 cuenta con 10 o más en la última hora» |
| RF-006 – «Todo bien» o «N avisos» | Cumple | Recorrido: «3 avisos» (cron de 50 min, un email fallido, copia de 10 días) y «4 avisos» con 3 cuadros en rojo |
| RF-007 – Cerca del límite y el plan para ofrecer | Cumple | Recorrido: «Estudio Bella · 20 de 20 citas del mes · Ofrecerle Pro» |
| RF-008 – Los que más crecen | Cumple | Prueba: `growth` de cada negocio. Recorrido: la lista con su % y sus citas |
| RF-009 – Dejaron de usarlo | Cumple | Recorrido: con datos demo activos dice «Todos los negocios tienen actividad». La regla de 14 días y de negocios recién creados está en `sales-lists.ts` |
| RF-010 – Arriba y solicitudes | Cumple | Recorrido: una solicitud pendiente aparece, se aprueba ahí y deja de ocupar lugar |
| RF-011 – Fuera tabla, gráfico y reparto | Cumple | Recorrido: no aparecen. Archivos borrados |
| RF-012 – Sólo el super admin, sin datos de pacientes | Cumple | Prueba: un propietario recibe 403 y la respuesta no trae ningún «@» |
| RF-013 – Beta | Cumple | Build y lint. `/admin` en el 3199: crecimiento (con su gráfico) y negocios para vender (con el suyo) con sus datos, y la salud «No disponible en la beta» |
| RF-014 – Gráfico de crecimiento | Cumple | Prueba: la suma día a día de este mes da las cifras del mes y después de hoy no hay datos. Recorrido (`graficos-006.mjs`): «124 en octubre», como el cuadro; al elegir «Reservas online», 26, también como el cuadro; recuadro al pasar el cursor y tabla de 30 días |
| RF-015 – Gráfico de emails | Cumple | Prueba: 14 días, hoy el último e igual a «Emails de hoy». Recorrido: barras de enviados y fallidos y recuadro del día |
| RF-016 – Gráfico por negocio | Cumple | Recorrido: los 5 negocios activos con citas, sin el suspendido; el nombre lleva a su ficha |
| RF-017 – Se lee sin verlo | Cumple | Los dos primeros tienen descripción y «Ver como tabla». El de negocios escribe el nombre y las cifras junto a cada barra |
| CE-001 – Saber en 10 s | Sin comprobar | No se midió con personas. Los tres bloques quedan a la vista al entrar |
| CE-002 – Cifras exactas | Cumple | `admin-overview.test.ts`, 16 comprobaciones |
| CE-003 – Colores y resumen | Cumple | Recorrido con los dos escenarios (ámbar y rojo) |
| CE-004 – Sin datos de pacientes | Cumple | Prueba de privacidad |
| CE-005 – Pruebas y 390 px | Cumple | Backend: 42 de 42 suites. Front: build y lint. Sin desplazamiento horizontal a 390 px, también con los gráficos |

**Pruebas automáticas:**
- backend: `npm run typecheck` y `npm test`, 42 de 42, con `admin-overview` (16) y `backup` (28);
- front y beta: `npm run build` y `npm run lint` sin errores;
- recorrido con Playwright: `inicio-006.mjs` 13 de 13 y, para los gráficos, `graficos-006.mjs` 11 de 11;
- la migración 034 se aplicó sin errores en el PostgreSQL 16 local.

## Cambios respecto al plan

- **Crecimiento en el celular:** las cifras van en dos columnas para que no ocupen tanto alto.
- **Cron:** el título del cuadro quedó solo como «Cron».
- **Solicitudes de plan:** sin pendientes, el inicio ya no muestra el historial de las resueltas
  (RF-010).
- **Gráfico por negocio:** se pensó con «Ver como tabla», como los otros. En el celular los nombres
  se cortaban junto al eje, así que quedó como barras con el nombre encima y las cifras escritas al
  lado. Así se lee entero y no necesita tabla aparte (RF-017 se ajustó).
- **Lo creado con fecha futura** (sólo pasa con datos de prueba) ya no cuenta en el mes en curso, ni
  en las cifras ni en el día a día, para que las dos sumen lo mismo.

## Pendientes y riesgos

- **El cuadro de la copia** dirá «Sin copias registradas todavía», en ámbar, hasta la primera copia
  después de publicar. Se puede lanzar una a mano en GitHub → Actions → Copia de seguridad.
- **Los ingresos** quedan fuera (los precios no se guardan).

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | d51019d | Spec 006: inicio del super admin con datos importantes (backend) |
| agenda-front | ca05a67 | Spec 006: inicio del super admin con datos importantes |
| agenda-backend | 01fd6bc | Spec 006: datos día a día para los gráficos del inicio del super admin |
| agenda-front | e081925 | Spec 006: gráficos en el inicio del super admin |

## Cómo publicarlo

1. **Migración 034 primero.** La aplica el dueño del producto:
   ```
   npm run db:migrate
   ```
2. **PR `dev` → `main` del backend.** Lleva también el aviso por ntfy de las citas del panel.
3. **PR `dev` → `main` del front.**
4. **Después**, mirar el inicio del super admin y, si se quiere ver el cuadro de la copia, lanzar una
   copia a mano.

## Texto para el PR

Inicio del super admin con datos importantes (spec 006): crecimiento del mes, salud del sistema
(emails, cron, copia de seguridad, seguridad) y negocios para vender, cada bloque con su gráfico.
**Migración 034**
(`backup_runs`), que va antes. Reporte: `specs/006-inicio-super-admin/reporte.md`.
