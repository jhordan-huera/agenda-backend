# Investigación y decisiones: Inicio del super admin con datos importantes

**Spec**: [spec.md](./spec.md) · **Fecha**: 2026-10-13

## D1. Los periodos que se comparan

- **Decisión:**
  - El periodo actual va desde el inicio del mes, a las 0:00 en Ecuador, hasta ahora.
  - El anterior empieza el día 1 del mes pasado y dura lo mismo, sin pasar del inicio de este mes.
  - Se calculan en la base con la zona del panel de plataforma (`DEFAULT_TIMEZONE`) y los usan la
    plataforma y cada negocio.
- **Por qué:**
  - Comparar el mes a medias con un mes pasado completo daría siempre «baja».
  - Con el tope, el 31 de marzo se compara con febrero entero (caso límite de la spec).
- **Descartado:** comparar con el mes pasado completo.

## D2. Qué cuenta cada cifra

- **Decisión:**
  - **Citas agendadas:** citas creadas en el periodo (`created_at`), sin las canceladas ahora.
  - **Reservas online:** lo mismo, con `source = 'booking_page'`.
  - **Pacientes nuevos:** `clients.created_at` en el periodo, sea cual sea su origen.
  - **Negocios nuevos:** `businesses.created_at` en el periodo.
- **Por qué:** mide la actividad del mes (supuesto de la spec), no la agenda. Las «citas este mes»
  del diseño anterior contaban por fecha de la cita.

## D3. El porcentaje

- **Decisión:** lo calcula el front con `actual` y `anterior`:
  - si anterior es 0 y actual es mayor que 0: «nuevo»;
  - si los dos son 0: «igual»;
  - si no, `round((actual - anterior) / anterior × 100)`, y 0 % se muestra como «igual».
- **Por qué:** la API devuelve los números crudos (contrato simple) y la presentación queda en un solo
  lugar.

## D4. La copia de seguridad queda anotada (migración 034)

- **Decisión:** una tabla nueva, `backup_runs`, con `ran_at`, `ok`, `size_bytes` y `error`.
  - **Quién escribe:** `scripts/backup.ts` anota una fila al terminar: buena con el tamaño del archivo
    cifrado, o fallida con el motivo ya limpio (`scrub`, sin URL ni datos).
  - **Si la anotación falla:** no rompe la copia. Usa una conexión aparte con un tiempo de espera
    corto.
  - **Limpieza:** se borran las filas de más de un año.
  - **Seguridad:** RLS activada, como en las demás tablas.
- **Por qué:** la copia corre en GitHub Actions y hoy sólo avisa por email y ntfy. El panel no tiene
  otra forma de saberlo.
- **Descartado:** leer las ejecuciones de GitHub desde el backend. Exige un token de GitHub en
  producción.

## D5. La salud del sistema

- **Decisión:** todo con consultas de lectura, en el mismo pedido de estadísticas:
  - **Emails:**
    - enviados de hoy: `status = 'sent'` y `created_at` desde las 0:00 de hoy en Ecuador;
    - fallidos de hoy: `status = 'failed'`, sin los descartados a propósito («Recordatorio
      descartado…» y «Dirección de demostración…»);
    - en cola: todos los `queued`.
  - **Cron:** la última fila de `cron_runs`, con su hora y sus errores (`report.reminderFailures` y
    `report.emails.failed`).
  - **Copia:** la última fila de `backup_runs`.
  - **Seguridad:**
    - los `session.login_failed` de las últimas 24 h;
    - las cuentas con 10 o más intentos en la última hora, con la misma agrupación que
      `findLoginAttacks` del cron.
  - **Colores:** los decide el front con los umbrales de la spec. La API sólo da datos.
- **Por qué:** los umbrales son de presentación y así se ajustan sin tocar la API.

## D6. Los negocios para vender

- **Decisión:**
  - **El dato nuevo:** `AdminBusinessSummary` gana `growth: { current, previous }`, las citas agendadas
    del negocio en los dos periodos de D1, en la misma consulta de la lista.
  - **Lo calcula el front con la lista que ya carga:**
    - cerca del límite: 80 % o más de `appointmentsPerMonth` o `clients`;
    - los que más crecen: los 5 de mayor % con al menos 5 citas este mes y que hayan crecido;
    - los que dejaron de usarlo: 14 días o más sin actividad, sin contar los creados en esos días.
  - **Plan para ofrecer:** el siguiente en `PLANS` (Free → Pro, Pro → Business).
- **Por qué:** no hace falta otra consulta y la lista sirve también en «Negocios».

## D7. Qué se quita del front

- **Decisión:**
  - **Fuera:** la tabla de actividad (`business-activity-list.tsx`), la tarjeta de atención
    (`attention-card.tsx`) y el gráfico de altas (`signups-chart.tsx`).
  - **Se queda:** la lógica de `attention.ts` (cerca del límite y sin actividad), que pasa a
    `sales-lists.ts`.
  - **API:** `signupsByMonth` se sigue enviando, pero el panel ya no lo usa.
- **Por qué:** el dueño del producto pidió quitarlos (RF-011).

## D8. La beta

- **Decisión:**
  - La misma pantalla.
  - Su repositorio de prueba calcula el crecimiento con su base del navegador.
  - En la salud, lo que no existe en la beta (cron, copias, emails reales) dice «No disponible en la
    beta», en gris (RF-013).
