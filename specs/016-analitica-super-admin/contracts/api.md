# Contratos: Analítica del super admin

## `GET /api/admin/analytics?days=30|90`

Sólo el super admin, con la verificación en dos pasos (como el resto de /admin).

- **200:** la última `AnalyticsSnapshot` de ese periodo (data-model).
- **200 `{ snapshot: null }`:** todavía no hay foto («Las cifras se preparan cada mañana»).
- **400 `validation`:** `days` no es 30 ni 90.

Lee una fila de la base. No calcula nada.

## `GET /api/admin/businesses/:id`

Suma `analytics`, la parte de ese negocio en la última foto de 30 días (o `null`), y las medianas de su
tipo, para la tarjeta «Frente a su tipo».

## Cron (`scripts/cron.ts`)

Después de las 06:00 de Ecuador, si no hay foto de hoy, prepara las de 30 y de 90 días y borra las de
más de 30 días. La línea del registro suma «analítica: preparada (N negocios)», sólo con la cifra.

## Guion

`npm run analytics:refresh` prepara la foto de hoy contra la base del entorno (en local, para probar).
