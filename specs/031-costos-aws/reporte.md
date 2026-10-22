# Reporte final: Los costos de AWS en /admin

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada en dev · **Fecha**: 2026-10-22

**Repos**: los dos (la beta no lo lleva) · **Migración**: Sí: `051_aws_costs.sql`

## Resumen

En /admin → **Costos**, el super admin ve lo que cuesta el backend en AWS sin entrar a AWS:
- lo gastado en el mes, lo que cubren los créditos y lo que se paga de verdad;
- la previsión para fin de mes;
- el desglose por servicio;
- el plan de la cuenta, con los créditos que quedan.

En el Inicio de /admin hay una tarjeta con el total y los créditos.

El cron lo pide a AWS una vez al día. Cuando lo gastado pasa el monto que fija el super admin, llega un ntfy y un email al super admin principal, una vez por mes y por monto.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – Ver lo que cuesta el backend | P1 | Hecha | Página «Costos» y tarjeta en el Inicio |
| H2 – El aviso cuando el gasto pasa un monto | P2 | Hecha | ntfy y email; «a este ritmo pasarás tu aviso» en la página |
| H3 – Los créditos de AWS | P2 | Hecha | Plan, créditos que quedan, lo que cubrieron y lo que se paga |

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – Una consulta al día, guardada | Cumple | `aws-costs`: el AWS falso cuenta las peticiones; la segunda pasada del día no consulta |
| RF-002 – Aunque nadie abra la página, y sin afectar al cron | Cumple | `aws-costs`: con 403 de AWS el cron sigue con lo demás y guarda el motivo |
| RF-003 – La página con lo gastado, la previsión, los servicios, la fecha y el mes | Cumple | Recorrido «con datos» en los cuatro casos; `aws-costs`: la previsión el día 1 y a mitad de mes |
| RF-004 – La tarjeta del Inicio | Cumple | Recorrido: con datos, con fallo y sin datos |
| RF-005 – Sólo el super admin | Cumple | `aws-costs`: 403 para el propietario y sin la verificación en dos pasos |
| RF-006 – El monto del aviso, a la actividad | Cumple | `aws-costs` y recorrido: guardar y quitar dejan su entrada; volver a guardar lo mismo no |
| RF-007 – El aviso, una vez por mes y por monto | Cumple | `aws-costs`: con $1,20 sobre $1, un email al principal y el ntfy, una sola vez; de nuevo con otro monto y en el mes nuevo |
| RF-008 – Sin datos o con fallo, se dice claro | Cumple | Recorrido: «sin datos», «sin datos con el motivo» y «último intento fallido» |
| RF-009 – Sin montos en el registro público | Cumple | `cron` y `aws-costs`: la línea del cron no lleva montos; el ntfy, sólo en el mensaje |
| RF-010 – El plan, los créditos y lo que cubren | Cumple | `aws-costs`: con `GetAccountPlanState` caído, los costos se guardan igual |
| RF-011 – La sección del plan | Cumple | Recorrido: plan de pago, plan gratuito y sin plan («Míralos en la consola de AWS → Créditos») |
| CE-001 – Ver el costo sin entrar a AWS | Cumple | Recorrido: la página carga lo guardado, sin consultar a AWS |
| CE-002 – Coincide al centavo con la consola de AWS | Sin comprobar | Se comprueba al publicar, el día siguiente después de las 06:00 |
| CE-003 – No más de una consulta al día | Cumple | `aws-costs`: el AWS falso cuenta una por día; tras un fallo, como mucho 3, cada 3 horas |
| CE-004 – El aviso, una vez y sólo si se pasa | Cumple | `aws-costs`: por debajo nunca, y en centavos ($2,004 no pasa $2) |
| CE-005 – Computador y celular, claro y oscuro | Cumple | Recorrido en Chromium a 1440 px y WebKit a 390 px, claro y oscuro, sin desplazamiento horizontal |
| CE-006 – Los créditos coinciden con la consola | Sin comprobar | Al publicar. Hoy son $140. Si AWS no los da en el plan de pago, la página lleva a la consola |

**Pruebas automáticas:**
- **Backend:** `npm run typecheck` sin errores y `env -u DATABASE_URL npm test` con **68 de 68 suites**. Lo repetí yo después del agente.
  - `aws-costs` tiene 88 comprobaciones.
  - La firma coincide con los ejemplos oficiales de AWS `get-vanilla` y `post-vanilla`.
- **Front:** `npm run build`, `npm run lint` y `npm run check:contrast` sin errores.
- **Recorrido:** `scratchpad/e2e-025/costos-031.mjs`, con capturas en `scratchpad/e2e-025/costos-031/`.

## Cambios respecto al plan

- **Una columna más en la 051:** `platform_settings.aws_costs_attempts`, para contar los «hasta 3 intentos al día».
- **Un estado más en el cron, «waiting»:** falló hace menos de 3 horas o ya van 3 intentos hoy.
- **«Sin credenciales» se guarda como motivo,** así la página explica por qué no hay datos.
- **El formato de los montos** («menos de $0,01») va en `lib/constants/business.ts`, compartido, porque también lo usa el email.
- **`AwsCostAlertInput`** va en `validations/admin.ts`, con las demás entradas.
- **Las direcciones de AWS de las pruebas** no se leen con `NODE_ENV=production`, y una prueba lo comprueba.
- **El aviso compara en centavos,** como se ve en la página.
- **Mensajes de error extra:** credenciales no aceptadas, Cost Explorer sin activar, demasiadas consultas y error inesperado con su código.

## Pendientes y riesgos

- **Si AWS da los créditos que quedan en el plan de pago,** no está confirmado. Si no los da, la página dice «Míralos en la consola de AWS → Créditos».
- **El permiso `freetier:GetAccountPlanState`:** hay que confirmar que IAM lo acepta al crear la política.
- **Cost Explorer sin activar** se reconoce por el texto del mensaje de AWS. Si el texto fuera otro, la página diría «Falta el permiso de AWS para leer los costos».
- **El email del aviso** sale en la siguiente pasada del cron, hasta 10 minutos después del ntfy.
- **La página «Costos»** es lo que más gasta en AWS: unos $0,30 al mes, que cubren los créditos.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | ce06a27 | Spec 031: los costos de AWS en /admin (migración 051, consulta diaria en el cron, API, aviso, pruebas y constitución 1.27.0) |
| agenda-front | 332608b | Spec 031: la página «Costos», la tarjeta del Inicio y el aviso de gasto (constitución 1.27.0) |

## Cómo publicarlo

1. **La migración 051,** como paso aparte, antes del backend:

   ```
   cd ~/Documentos/Proyectos/Backend/agenda-backend
   npm run db:migrate
   ```

2. **Los pasos en AWS y GitHub, una sola vez.** Están en el README, «Los costos de AWS»:
   1. Cost Explorer activado.
   2. El rol `agenda-costos-lectura`, con identidad web de GitHub, rama `main`.
   3. La política en línea `leer-costos`.
   4. El secreto `AWS_COSTS_ROLE_ARN` en GitHub.

   Hasta entonces, la página dice que aún no hay costos.
3. **El PR del backend y después el del front.**
4. **Al día siguiente, después de las 06:00,** comparar /admin → Costos con la consola de AWS: la factura del mes y Créditos.

## Texto para el PR

Spec 031: los costos de AWS en /admin.
- **«Costos»:** lo gastado en el mes, lo que cubren los créditos, lo que se paga, la previsión, el desglose por servicio y el plan con los créditos. En el Inicio, el total.
- **El cron lo pide a AWS una vez al día,** con un rol sólo de lectura (OIDC, sin claves guardadas) y unos $0,30 al mes.
- **Aviso por ntfy y email** cuando lo gastado pasa el monto que fija el super admin.
- **Constitución 1.27.0.**

**Migración:** `051_aws_costs.sql`, antes del backend. **Una vez:** el rol de AWS y el secreto `AWS_COSTS_ROLE_ARN` (ver el README).

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/031-costos-aws/reporte.md
