# Plan de implementación: Los costos de AWS en /admin

**Rama**: `dev` · **Fecha**: 2026-10-22 · **Spec**: [spec.md](./spec.md)

## Diseño

1. **La migración 051, `051_aws_costs.sql`:**
   - **`aws_costs`,** una fila por mes de facturación de AWS:
     - `month date primary key`: el día 1 del mes, en UTC, como lo cuenta AWS;
     - `usage_usd numeric(12,4)`: lo gastado, antes de créditos;
     - `credits_usd numeric(12,4)`: lo que cubren los créditos;
     - `services jsonb`: `[{ name, amount }]`, lo gastado por servicio;
     - `fetched_at timestamptz`;
     - el plan de AWS: `plan_type` (`FREE | PAID`), `plan_status`, `remaining_credits` y `plan_expires_at`, todos `null` si AWS no los da.

     Con RLS, como las demás. No se borra: es una fila al mes.
   - **`platform_settings`,** columnas privadas que nunca van en `/public/platform-settings`:
     - `aws_cost_alert numeric(10,2)`, el monto del aviso: `null` = sin aviso, con un check de 0,01 a 100 000;
     - `aws_cost_alerted_month date` y `aws_cost_alerted_amount numeric(10,2)`, para qué mes y monto ya se avisó;
     - `aws_costs_attempted_at timestamptz` y `aws_costs_error text`, el último intento y su motivo si falló.

2. **La firma de AWS, a mano, sin librerías** (`src/services/aws-signature.ts`, nuevo):
   - Firma Signature V4 con `node:crypto` (HMAC-SHA256), como ya se hizo con TOTP y Web Push.
   - Se evita sumar el SDK de AWS al proyecto y al paquete de Lambda (constitución VI).
   - Se prueba con los ejemplos oficiales de AWS.

3. **La consulta diaria** (`src/services/aws-costs.ts`, nuevo):
   - **Los costos:** una sola consulta a Cost Explorer, `GetCostAndUsage` en `ce.us-east-1.amazonaws.com`:
     - el mes en curso, en `MONTHLY`, con `UnblendedCost`;
     - agrupada por `SERVICE` y `RECORD_TYPE`. Así, con una consulta ($0,01) salen lo gastado por servicio y lo que cubren los créditos (`Credit`).
   - **El plan y los créditos:** `GetAccountPlanState` del Free Tier API (`freetier.us-east-1.api.aws`, sin costo).
     - Si falla o no hay permiso, los costos se guardan igual y la página dice dónde ver los créditos.
   - **`refreshAwsCosts()`,** al estilo de `saveDailyDatabaseStats`:
     - Cuándo corre:
       - desde las 06:00 de Ecuador;
       - si hoy no salió bien;
       - si falló, reintenta cada 3 horas, hasta 3 veces al día.

       Nunca hay más de una consulta correcta al día.
     - Las credenciales vienen de las variables `AWS_*` que deja el paso de GitHub. Sin ellas (en local, o antes de los pasos en AWS), no consulta y queda en «sin credenciales».
     - El tiempo máximo de cada consulta es de 10 s.
     - Los errores se guardan en palabras sencillas, sin datos de la cuenta:
       - sin permiso → «Falta el permiso de AWS para leer los costos»;
       - sin datos → «Cost Explorer todavía no tiene datos (tarda hasta un día tras activarlo)»;
       - red → «AWS no respondió».
   - **La previsión:** lo gastado ÷ los días ya cerrados del mes × los días del mes. El día 1 queda `null`, «todavía sin previsión».
   - **El aviso:** se manda después de guardar si se cumplen las tres condiciones:
     - hay monto;
     - lo gastado lo pasa;
     - no se avisó ya este mes con ese monto.

     Lo que hace:
     - encola un email `aws_cost_alert` al super admin principal, con `dedupeKey` `aws-cost:<mes>:<monto>`;
     - deja la marca en `platform_settings`;
     - el cron manda el ntfy.

4. **El cron:**
   - **`src/jobs/scheduled-tasks.ts`:** `refreshAwsCosts().catch(...)` después de la foto de la analítica, con su propio `catch`: si falla, el resto sigue. El informe suma `awsCosts: { status, alert }`.
   - **`scripts/cron.ts`:**
     - una línea «Costos de AWS: actualizados / ya estaban los de hoy / se actualizan después de las 06:00 / sin credenciales / falló», **sin montos**, porque el registro es público;
     - `buildCostNotice(report)`: el ntfy con el título fijo «Agenda360: costos de AWS» y los montos en el mensaje. ntfy sólo registra el título.
   - **El email** sale en la siguiente pasada del cron, hasta 10 minutos después, porque se encola después del envío. El ntfy llega al momento.

5. **El paso de GitHub** (`.github/workflows/cron.yml`):
   - `permissions: id-token: write` y un paso `aws-actions/configure-aws-credentials`, fijado al mismo SHA que `deploy-lambda.yml`, con `role-to-assume: ${{ secrets.AWS_COSTS_ROLE_ARN }}` y `aws-region: us-east-1`.
   - El paso sólo corre si el secreto existe, y con `continue-on-error: true`: si AWS falla, los recordatorios salen igual.
   - Es un **rol nuevo, sólo de lectura de costos**, no el de publicar Lambda. Así el cron, que corre cada 10 minutos, no puede tocar la función.

6. **La API del super admin** (`src/routes/platform-routes.ts` y `src/services/aws-costs.ts`):
   - **`GET /admin/aws-costs`:**
     - Devuelve el mes, lo gastado, los créditos usados, lo que se paga, la previsión, los servicios, el plan, cuándo se actualizó, el último error y el monto del aviso.
     - Con `authorizeSuperAdmin` (con 2FA) y `Cache-Control: no-store`.
     - El modo soporte no aplica: /admin no lo tiene.
   - **`PUT /admin/aws-costs/alert`:**
     - Recibe `{ amount: number | null }`, validado con `awsCostAlertSchema`.
     - Pasa a la actividad como `platform.aws_cost_alert_changed`, con el antes y el después. Si no cambia, no se audita.
     - Leer no se audita.

7. **Lo compartido** (en el front, y `npm run sync:shared` al backend):
   - **Tipos:**
     - `AwsCosts` y `AwsCostAlertInput`;
     - el `EmailType` `aws_cost_alert`, que suma su entrada en `EMAIL_PRIORITY` («team»), `EMAIL_GROUPS` y las etiquetas del buzón: «Costos de AWS».
   - **`awsCostAlertSchema`,** en `lib/validations/admin.ts`.
   - **La plantilla `awsCostAlert`,** en `lib/email/templates.ts`. Va con el estilo de `accountSecurityChanged` y contiene:
     - lo gastado, el monto, la previsión y lo que cubren los créditos;
     - el botón «Ver costos».

8. **El front:**
   - **El menú:** «Costos», con un icono de `lucide-react`, en `ADMIN_NAV_ITEMS`. La ruta es `costs` en el router.
   - **`src/pages/admin/admin-costs-page.tsx`:**
     - **Lo gastado este mes:** la cifra grande, con el mes («Octubre de 2026, mes de AWS») y, debajo, «Lo cubren tus créditos: $X · Pagas: $Y».
     - **La previsión.** Si pasa del monto del aviso, una nota: «a este ritmo pasarás tu aviso de $Z».
     - **«Actualizado el …»,** con la nota de que AWS tarda hasta un día. Si el último intento falló, un aviso con el motivo.
     - **Por servicio:** una lista de mayor a menor. Los que van en $0,00, en una línea: «y N servicios en $0,00». «Menos de $0,01» cuando corresponda.
     - **Tu plan de AWS:**
       - el plan y los créditos que quedan, con su vencimiento;
       - sin dato, «Míralos en la consola de AWS → Créditos»;
       - en el plan gratuito, además, cuándo vence y qué hacer.
     - **Aviso de gasto:** el campo en dólares con «Guardar» y «Quitar aviso», con el patrón de `PlanPricesCard`.
     - **Sin datos:** un estado vacío que explica por qué y qué falta.
   - **`src/features/admin/aws-costs-card.tsx`,** en el Inicio después de `BillingOverviewCard`:
     - el total del mes y los créditos que quedan, con «Ver costos»;
     - sin datos, «Aún sin datos de costos».
   - **Los datos:** `getAwsCosts` y `setAwsCostAlert` en `repository.ts` y `api-repository.ts`, `useAwsCosts` y `useSetAwsCostAlert` en `use-admin.ts`, y `queryKeys.admin.awsCosts`.
   - **El diseño:** tarjetas del panel y tokens de la marca, en una sola gama, en claro y oscuro y a 390 px.

9. **`database-stats-service.ts`:** `aws_costs` en `TABLE_INFO`, con la nota «una fila por mes, no se borra».

**La beta:** no lo lleva.

## Comprobación contra la constitución

| Principio | ¿Cumple? | Cómo |
|---|---|---|
| I. Español | Sí | Textos, errores y emails en español |
| II. Privacidad | Sí | Sin datos de pacientes. Los montos no van a los registros públicos |
| III. Decisiones | Sí | Lo decidido el 2026-10-22 se anota: constitución **1.27.0**, en los dos repos |
| IV. Local | Sí | Pruebas con un AWS falso local. Nunca contra la cuenta real ni producción |
| V. Compartido | Sí | Tipos, validación y plantilla en el front, con `sync:shared` |
| VI. Barato | Sí | Una consulta de pago al día, unos $0,30 al mes, aprobada por el dueño del producto. Sin dependencias nuevas. Lo hace el cron, no la API |
| VII. Diseño | Sí | Tokens de la marca, una sola gama, 390 px sin desplazamiento horizontal |
| Auditoría | Sí | El cambio del monto va a la actividad. Leer y lo automático no |

## Pruebas

**Backend** (`tests/aws-costs.test.ts`, nueva, con un AWS falso local; los endpoints se cambian por variables de entorno sólo en las pruebas):
- **La firma:** coincide con los ejemplos oficiales de AWS.
- **La lectura:** con servicios y créditos se obtienen lo gastado, lo cubierto y lo que se paga, con los servicios de mayor a menor.
- **El cron:**
  - guarda una vez al día;
  - en la segunda pasada no consulta: el AWS falso cuenta las peticiones;
  - antes de las 06:00, nada;
  - sin credenciales, «sin credenciales»;
  - con 403 de AWS: guarda el motivo, deja lo último guardado, el resto del cron sigue y reintenta a las 3 horas.
- **El plan:** si `GetAccountPlanState` falla, los costos se guardan igual.
- **La previsión:** el día 1, `null`; a mitad de mes, el ritmo.
- **El aviso:**
  - con $1,20 sobre $1, un email al principal y el ntfy, una sola vez;
  - al cambiar el monto, otra vez;
  - en el mes nuevo, otra vez;
  - por debajo, nunca.
- **La API:**
  - 403 para el propietario y para quien no tiene 2FA;
  - el super admin lee;
  - `PUT` valida, guarda y audita sólo si cambia;
  - `/public/platform-settings` sigue sin campos nuevos.
- **El registro del cron:** sin montos.

**Las que cambian:** `email-quota` (el tipo nuevo), `cron` (la línea nueva) y `database-stats` (la tabla nueva).

**Front:** build, lint y `check:contrast`. El recorrido, en Chromium a 1440 px y WebKit a 390 px, claro y oscuro, con datos cargados en la base local:
- con datos;
- sin datos;
- con el último intento fallido;
- guardar y quitar el aviso;
- la tarjeta del Inicio.

## Publicación

1. **La migración 051,** como paso aparte, antes del backend: `npm run db:migrate`.
2. **Los pasos en AWS y GitHub,** una sola vez, cuando quieras; hasta entonces la página dice «sin datos»:
   1. En AWS, **IAM → Roles → Crear rol → Identidad web:**
      - proveedor `token.actions.githubusercontent.com`;
      - audiencia `sts.amazonaws.com`;
      - organización `jhordan-huera`, repositorio `agenda-backend` y rama `main`;
      - nombre `agenda-costos-lectura`.

      Después, en el rol, una política en línea que sólo permite `ce:GetCostAndUsage` y `freetier:GetAccountPlanState`. Te paso el texto para pegar.
   2. Copiar el ARN del rol y guardarlo en GitHub como secreto `AWS_COSTS_ROLE_ARN` del repo agenda-backend.
3. **El PR del backend y después el del front.**
4. **Al día siguiente, después de las 06:00,** comparar /admin → Costos con la consola de AWS: costos y créditos.
