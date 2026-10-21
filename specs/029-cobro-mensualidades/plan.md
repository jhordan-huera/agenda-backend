# Plan de implementación: El cobro de las mensualidades por transferencia

**Rama**: `dev` · **Fecha**: 2026-10-20 · **Spec**: [spec.md](./spec.md)

## Diseño

1. **La migración 049, `049_monthly_billing.sql`:**
   - **`subscriptions`:**
     - `monthly_fee numeric(10,2) not null default 0 check (>= 0)`;
     - `billing_day smallint` (1 a 31, null si no hay cobro);
     - `billing_start date`, el primer cobro.
   - **`platform_settings.bank_accounts jsonb not null default '[]'`,** con el mismo check que las cuentas
     de las agendas (030). **Nunca va en la lectura pública** de `/public/platform-settings`: se lee con
     rutas propias.
   - **`billing_charges`:** el cobro de cada mes.
     - Columnas:
       - `id`;
       - `business_id`, FK `on delete cascade`;
       - `due_date`, su día de pago;
       - `base_amount`, `referral_discount` y `amount` (lo que se paga);
       - `referral_ids uuid[]`, las recomendaciones que usa el descuento;
       - `status`, con check `due | in_review | paid | rejected | void`;
       - `rejection_reason`;
       - `paid_method`, `transfer | other`;
       - `paid_at`, `reviewed_by`, `created_at` y `updated_at`.
     - `unique (business_id, due_date)`.
   - **`billing_receipts`:** los comprobantes, como `payment_receipts`.
     - Columnas: `id`, `charge_id` (FK `on delete cascade`), `storage_path`, `content_type`, `size_bytes`,
       `status` (`pending | ready`) y `created_at`.
     - En el mismo bucket privado `comprobantes`, con la ruta `<negocio>/mensualidades/<cobro>/<id>`.
       Así al eliminar el negocio se borran con su carpeta.
   - **RLS** en las dos tablas nuevas, como las demás.

2. **Los cobros** (`src/services/billing-service.ts`, nuevo):
   - **`ensureCharges(db, businessId?, at?)`** crea el cobro del mes:
     - si el negocio está activo, tiene propietario, `monthly_fee > 0` y la fecha de hoy en Ecuador
       llegó a su `due_date`;
     - el día de pago se ajusta al último día de los meses cortos;
     - **el descuento:** las recomendaciones ganadas sin aplicar (`listRewards` de `referral-service`),
       que no use otro cobro abierto, × $1,50, sin pasar de la mensualidad;
     - es idempotente, por el `unique`.

     La llaman el cron, en cada pasada, y la lectura del propietario, para que la pantalla no espere al
     cron.
   - **`queueBillingReminders`:** tres días antes, el email `billing_reminder`, con `dedupe_key`
     `billing-reminder:<negocio>:<fecha>`.
   - **El estado para el propietario:** el cobro pendiente más antiguo (`due` o `rejected`), los días de
     gracia que le quedan (5, contados desde `due_date`, en la zona del negocio) y `blocked` (pasada la
     gracia).
   - **Subir el comprobante:** como `clinical-attachment-service`, con sesión. `requestUpload` da un PUT
     firmado; `completeUpload` comprueba el tamaño y el tipo con las mismas reglas de los comprobantes
     de los pacientes y pasa el cobro a `in_review`. Además:
     - registra la actividad;
     - avisa al super admin en la campana y por push (`addPlatformNotice` y `guardedPush`, tipo nuevo
       `billing_receipt`);
     - el cron lo cuenta para ntfy.
   - **Lo del super admin:**
     - `approve`: `paid`, el email `billing_paid` y `referral_reward_applied_at` en las recomendaciones
       usadas;
     - `reject`: `rejected`, con motivo, y el email `billing_rejected`;
     - `markPaid`: pagado sin comprobante, con nota;
     - `void`: anula el cobro, con motivo;
     - `receiptUrl`: enlace firmado de 5 minutos.
   - **La actividad:** cada cambio va con `businessId null`, como los referidos, porque la mensualidad
     sólo la ve el propietario. Las acciones son `platform.billing_*`.
   - **La purga:** los comprobantes de más de 12 meses (el archivo y su fila), en el cron. Los cobros se
     quedan como historial.

3. **Las rutas:**
   - **Del propietario** (`billing.manage`, que sólo tiene el propietario):
     - `GET /businesses/:id/billing`: la mensualidad, el próximo pago, el historial, el cobro pendiente,
       `graceDaysLeft`, `blocked` y las cuentas;
     - `POST …/billing/charges/:chargeId/receipt` y `…/receipt/:receiptId/complete`;
     - `GET …/billing/charges/:chargeId/receipt`: el suyo.
   - **Del super admin:**
     - `GET /admin/billing?status=`;
     - `POST /admin/billing/charges/:id/approve`, `…/reject`, `…/mark-paid` y `…/void`;
     - `GET …/receipt`;
     - `PUT /admin/businesses/:id/billing`, con la mensualidad, el día y el primer cobro;
     - `GET` y `PUT /admin/billing-accounts`.

     Todas con `no-store`.
   - **`adminService.getStats`** suma `billing: { inReview, overdue }`.

4. **Los emails** (plantillas en `front/src/lib/email/templates.ts`, con `platformEmail`):
   - `billing_reminder`, `billing_paid` y `billing_rejected`;
   - van con `businessId null`, para que en la bandeja sólo los vea el propietario;
   - la prioridad es `team`, para que salgan siempre;
   - se añaden en `EMAIL_PRIORITY`, `EMAIL_GROUPS` y `TYPE_LABELS`.

5. **El cron** (`scheduled-tasks.ts` y `scripts/cron.ts`):
   - en cada pasada, `ensureCharges`, los recordatorios y la purga;
   - en el informe, las cifras: cobros creados, recordatorios y comprobantes nuevos;
   - por ntfy: «Agenda360: comprobante de mensualidad», con el negocio en la primera línea y el monto.

6. **El front, para el propietario:**
   - **`billing-screen.tsx`,** como `ToCloseScreen`:
     - «Tu mensualidad de noviembre», con el monto y su descuento;
     - las cuentas, con `accountRows` y «Copiar»;
     - «Subir comprobante», con `prepareReceipt`, `uploadToStorage` y el avance;
     - «Más tarde · Te quedan N días», sólo mientras dure la gracia;
     - «Cerrar sesión»;
     - el aviso del rechazo con su motivo.
   - **`DashboardShell`:** se muestra si es el propietario, no es el modo soporte y hay un cobro
     pendiente. Va antes del cierre de mes.
     - «Más tarde» se guarda en `sessionStorage` por cobro, así vuelve en el siguiente inicio de sesión.
     - Sin gracia, no se puede cerrar.
     - El bloqueo es de la pantalla, como en la spec 021; la API no bloquea, así su equipo y su página
       siguen.
   - **`monthly-fee-card.tsx`** en Configuración → Negocio, sólo para el propietario: la mensualidad, el
     próximo pago y el historial, con el estado, el motivo si se rechazó y su comprobante.

7. **El front, para el super admin:**
   - **La ficha del negocio,** en la tarjeta «Suscripción y uso»:
     - la mensualidad, el día de pago y el primer cobro, con «Guardar»;
     - el texto pasa a «El propietario sólo ve su mensualidad».
   - **`/admin/billing`, «Cobros», en el menú:**
     - filtros: En revisión, Por pagar, Atrasados, Pagados, Rechazados y Anulados;
     - cada cobro con su negocio, periodo, monto, fecha y estado;
     - «Ver comprobante», «Pagado», «Rechazar» (motivo), «Pagado sin comprobante» y «Anular».
   - **El Inicio:** una tarjeta arriba, como `PlanRequestsCard`: «2 comprobantes por revisar · 1
     atrasado».
   - **`/admin/settings`:** «Cuentas para recibir las mensualidades», con `BankAccountsFields`.
   - **La campana:** el tipo `billing_receipt`, con su icono y su texto.

8. **Constitución 1.25.0** (MENOR):
   - la decisión «Los negocios no ven planes ni precios» suma: «…salvo su propia mensualidad (el monto,
     el día de pago y el estado de sus pagos), que ve sólo el propietario (spec 029, 2026-10-20)»;
   - una línea nueva sobre el cobro por transferencia: los 5 días de gracia, el bloqueo sólo del
     panel del propietario y la revisión del super admin.

9. **La beta,** en una fase al final, con datos de prueba:
   - la tarjeta de la mensualidad y la pantalla de pago (un cobro de ejemplo, que «sube» el
     comprobante sin servidor);
   - en su /admin, «Cobros» con ejemplos.

**Migración:** 049. **Variables:** ninguna.

## Pruebas

**Backend** (`tests/billing.test.ts`, nueva):
- **La mensualidad:** sólo el super admin la pone, y queda en la actividad. Con 0, sin propietario o
  suspendido, no hay cobros.
- **El cobro:**
  - se crea el día de pago (el 31 cae el 30 en noviembre), una sola vez aunque el cron pase varias
    veces;
  - con dos recomendaciones ganadas, lleva $3 de descuento, que no reusa el cobro siguiente.
- **El recordatorio:** tres días antes y una sola vez.
- **El estado del propietario:** sin cobro, en la gracia (días que quedan) y bloqueado desde el sexto
  día. Las fechas se mueven con sql.
- **El comprobante:**
  - subirlo lo pasa a `in_review` y avisa en la campana del super admin;
  - fuera de las reglas de tamaño o tipo, se rechaza.
- **Aprobar, rechazar y los demás:** cada uno con su email y su actividad.
  - Aprobar marca aplicadas las recomendaciones.
  - Rechazar deja el motivo y vuelve a pedir el comprobante.
  - Pagado sin comprobante y anular, también.
- **Quién:**
  - el administrador, la recepción y el profesional no ven la mensualidad (403);
  - otro negocio no ve ni sube nada;
  - `/public/platform-settings` no trae las cuentas bancarias.
- **La purga:** a los 12 meses se borran el comprobante y su archivo, y el cobro queda.

**Las que cambian:** `email-quota` (los tipos nuevos), `cron` (la línea), `admin-overview` (las cifras),
`panel-notices` (el tipo nuevo) y `database-stats` (las tablas nuevas en `TABLE_INFO`).

**Front:** build, lint y `check:contrast`. El recorrido, en Chromium a 1440 px y WebKit a 390 px, claro y
oscuro:
- el propietario en su día de pago: la pantalla, «Más tarde», subir el comprobante y entrar;
- pasada la gracia: sin «Más tarde»;
- el super admin, en «Cobros»: aprobar y rechazar;
- el administrador del negocio y el modo soporte no ven la pantalla.

## Publicación

1. **La migración 049,** como paso aparte, antes del backend.
2. **El backend y después el front.** La beta, aparte.
3. **Después:** en /admin, poner tus cuentas y la mensualidad de cada negocio, con su día de pago.
