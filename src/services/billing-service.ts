import { randomUUID } from "node:crypto";
import { isUuid, many, one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { APP_NAME, DEFAULT_TIMEZONE } from "../shared/lib/constants/app.ts";
import {
  BILLING_OVERDUE_DAYS,
  BILLING_RECEIPT_RETENTION_MONTHS,
  BILLING_REMINDER_DAYS,
  REFERRAL_DISCOUNT,
  formatUsdAmount,
} from "../shared/lib/constants/business.ts";
import { describePlanPrice, effectiveMonthlyFee, planMonthlyPrice } from "../shared/lib/constants/plans.ts";
import { emailTemplates, type BillingEmailData } from "../shared/lib/email/templates.ts";
import { formatDate, formatSupportContact } from "../shared/lib/format.ts";
import { addDaysISO, addMonthsISO, dayOfMonthISO, daysBetween, getZonedNow } from "../shared/lib/time.ts";
import {
  adminBillingFilterSchema,
  billingPaidSchema,
  billingReasonSchema,
  businessBillingSchema,
  planPricesSchema,
  proposedBilling,
  platformBankAccountsSchema,
} from "../shared/lib/validations/admin.ts";
import { RECEIPT_MAX_BYTES, RECEIPT_UPLOAD_ATTEMPTS, receiptInputSchema } from "../shared/lib/validations/payment.ts";
import type {
  AdminBillingCharge,
  AdminBillingFilter,
  AdminBillingList,
  AdminBusinessBilling,
  AuditChange,
  BankAccount,
  BillingCharge,
  BillingReceipt,
  BillingReceiptUpload,
  BillingStatus,
  BusinessBilling,
  BusinessStatus,
  ISODate,
  PlanId,
  PlanPrices,
} from "../shared/types/index.ts";
import { logAudit } from "./audit.ts";
import { authorize, authorizeSuperAdmin, parseInput, type Actor, type AuditActor, type RequestContext } from "./context.ts";
import { receiptStorage, type FileStorage } from "./file-storage.ts";
import { appOrigin, queueEmail } from "./notifications.ts";
import { countActiveProfessionals } from "./plan-limits.ts";
import { getPlanPrices, getPlatformBankAccounts, getPlatformSettings } from "./platform-settings.ts";
import { notifyBillingReceipt } from "./push-notices.ts";
import { applyRewards, availableRewardIds } from "./referral-service.ts";

/**
 * El cobro de las mensualidades por transferencia (spec 029, migración 049).
 *
 * - **La mensualidad** sale sola de su plan y sus agendas (ampliación del 2026-10-20, migración 050): los
 *   precios de los planes los pone el super admin en /admin → Planes, y en la ficha del negocio le puede
 *   poner un precio especial (0 = cortesía, sin cobros). En el plan gratis no hay cobros. El día de pago y el
 *   primer cobro también salen solos, del día en que empezó su plan (ensureBillingSchedule), y el super admin
 *   los puede cambiar en la ficha.
 * - **El cobro del mes** se crea en su día de pago (en los meses cortos, el último día), en la zona del
 *   negocio: lo crean el cron en cada pasada y la lectura del propietario, para que la pantalla no espere
 *   al cron. Lleva la mensualidad de ese momento menos el descuento de las recomendaciones ganadas y sin
 *   aplicar que no use otro cobro abierto (REFERRAL_DISCOUNT cada una, sin pasar de la mensualidad). Sólo
 *   se crea en sus primeros BILLING_OVERDUE_DAYS días: un mes en que el negocio estuvo suspendido o sin
 *   propietario no se cobra después.
 * - **El propietario** ve la pantalla de pago desde el día de pago y sube el comprobante (como los de los
 *   pacientes: foto o PDF de hasta 10 MB, al bucket privado de comprobantes, en la carpeta del negocio).
 *   No hay «Más tarde» ni días de gracia (pedido del dueño del producto, 2026-10-20): mientras haya un
 *   cobro por pagar o rechazado, la pantalla no se cierra. El cobro pasa a «En revisión» y el super admin
 *   recibe el aviso en su campana, en el celular y, desde el cron, por ntfy. La API no bloquea nada: la
 *   pantalla decide con `blocked`, así su equipo y su página de reservas siguen funcionando.
 * - **Los atrasados** son sólo del super admin: en /admin → Cobros, un cobro por pagar pasa de «Por pagar» a
 *   «Atrasados» a los BILLING_OVERDUE_DAYS días de su día de pago, y el Inicio de /admin los cuenta.
 * - **El super admin** lo marca pagado (los descuentos usados quedan aplicados), lo rechaza con un motivo
 *   (vuelve a pedir el comprobante), lo marca pagado sin comprobante o lo anula. Cada cambio le llega al
 *   propietario por email.
 * - **La actividad:** todo va a la de la plataforma (`platform.billing_*`, sin negocio), también lo que hace
 *   el propietario: la del negocio la ven sus administradores, y la mensualidad sólo el propietario
 *   (constitución, principio III). De lo que pasa solo, sólo se anota el día de pago automático (cambia los
 *   datos del negocio, como «Agenda360»); crear el cobro, el recordatorio y la purga no se anotan.
 */

/** Los cobros que esperan algo del propietario o del super admin. */
const OPEN_STATUSES: BillingStatus[] = ["due", "in_review", "rejected"];
/** Los que esperan el comprobante: abren la pantalla de pago. */
const AWAITING_RECEIPT: BillingStatus[] = ["due", "rejected"];

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

const SUPPORT_UPLOAD_FORBIDDEN =
  "El comprobante de la mensualidad lo sube el propietario. Si ya pagó por otra vía, márcalo pagado en /admin → Cobros.";
const ALREADY_SENT = "Ya enviaste el comprobante de este mes: lo estamos revisando.";

/* ------------------------------------------------------------- Las fechas -- */

/** Hoy en la zona del negocio (con una zona inválida, la de Ecuador: un cobro no debe fallar por eso). */
function todayIn(timezone: string, at: Date): ISODate {
  try {
    return getZonedNow(timezone, at).date;
  } catch {
    return getZonedNow(DEFAULT_TIMEZONE, at).date;
  }
}

/** El último día de pago que ya llegó (hoy incluido), desde el primer cobro; null si todavía no llegó ninguno. */
function lastDueDate(today: ISODate, day: number, start: ISODate): ISODate | null {
  let due = dayOfMonthISO(today, day);
  if (due > today) due = dayOfMonthISO(addMonthsISO(today, -1), day);
  return due >= start ? due : null;
}

/** El primer día de pago desde `from` (incluido), sin ser anterior al primer cobro. */
function nextDueFrom(from: ISODate, day: number, start: ISODate): ISODate {
  const base = from > start ? from : start;
  const due = dayOfMonthISO(base, day);
  return due >= base ? due : dayOfMonthISO(addMonthsISO(base, 1), day);
}

/** «noviembre de 2026»: el mes de un cobro, para la actividad. */
const monthLabel = (dueDate: ISODate) => formatDate(dueDate, "MMMM 'de' yyyy");

/* --------------------------------------------------- Los datos de un negocio -- */

/** La mensualidad de un negocio, con lo que decide si hay cobro. */
interface BillingTarget {
  businessId: string;
  businessName: string;
  timezone: string;
  status: BusinessStatus;
  ownerId: string | null;
  subscriptionId: string;
  plan: PlanId;
  /** Su precio especial (null: el de su plan; 0: cortesía, sin cobros). */
  customFee: number | null;
  /** Las «Agendas contratadas» (null: sin tope): las que cuenta el precio de Business. */
  maxProfessionals: number | null;
  billingDay: number | null;
  billingStart: ISODate | null;
  /** El día en que empezó su plan actual, en la zona del negocio: de él sale la mensualidad automática. */
  planStart: ISODate;
}

const TARGET_SQL = `select b.id as "businessId", b.name as "businessName", b.timezone, b.status, b.owner_id as "ownerId",
                           s.id as "subscriptionId", s.plan, s.monthly_fee as "customFee",
                           s.max_professionals as "maxProfessionals", s.billing_day as "billingDay",
                           s.billing_start as "billingStart", (s.plan_since at time zone b.timezone)::date as "planStart"
                      from businesses b join subscriptions s on s.business_id = b.id`;

/** Con `lock`, bloquea la suscripción: los cobros de un negocio se crean de uno en uno (cron y lectura a la vez). */
async function findTarget(db: Db, businessId: string, lock = false): Promise<BillingTarget | null> {
  if (!isUuid(businessId)) return null;
  return one<BillingTarget>(db, `${TARGET_SQL} where b.id = $1 ${lock ? "for update of s" : ""}`, [businessId]);
}

/**
 * Puede tener cobros: un plan de pago sin cortesía, con su día de pago y su primer cobro. El monto se calcula
 * aparte (feeOf): con los precios de los planes en 0, tampoco hay cobros.
 */
const hasSchedule = (target: BillingTarget): target is BillingTarget & { billingDay: number; billingStart: ISODate } =>
  target.plan !== "free" && target.customFee !== 0 && target.billingDay !== null && target.billingStart !== null;

/** Genera cobros: con mensualidad, activo y con propietario. */
const isBillable = (target: BillingTarget): target is BillingTarget & { billingDay: number; billingStart: ISODate } =>
  hasSchedule(target) && target.status === "active" && target.ownerId !== null;

/** SQL de isBillable (alias `b` y `s`), para el cron. */
const BILLABLE_SQL = `b.status = 'active' and b.owner_id is not null and s.plan <> 'free'
                      and (s.monthly_fee is null or s.monthly_fee > 0)
                      and s.billing_day is not null and s.billing_start is not null`;

/** Los negocios que generan cobros, para el cron. */
export async function billableBusinessIds(db: Db): Promise<string[]> {
  const rows = await many<{ id: string }>(
    db,
    `select b.id from businesses b join subscriptions s on s.business_id = b.id where ${BILLABLE_SQL} order by b.id`,
  );
  return rows.map((row) => row.id);
}

/* ------------------------------------------------------------ El monto -- */

/** La mensualidad de un negocio hoy: lo que se le cobra, el precio de su plan y las agendas que cuenta. */
interface Fee {
  /** effectiveMonthlyFee: su precio especial o el de su plan (0: sin cobros). */
  monthlyFee: number;
  /** planMonthlyPrice: el de su plan con sus agendas, aunque tenga un precio especial. */
  planPrice: number;
  /** Las agendas que cuenta Business: las contratadas o, sin tope, las activas (1 en los demás planes). */
  agendas: number;
}

/**
 * La mensualidad de un negocio con los precios de los planes de este momento. Las agendas sólo se cuentan en
 * Business: las «Agendas contratadas» o, sin tope, las activas.
 */
async function feeOf(db: Db, target: Pick<BillingTarget, "businessId" | "plan" | "customFee" | "maxProfessionals">): Promise<Fee> {
  const planPrices = await getPlanPrices(db);
  const agendas = target.plan !== "business" ? 1 : (target.maxProfessionals ?? (await countActiveProfessionals(db, target.businessId)));
  return {
    monthlyFee: effectiveMonthlyFee(target, agendas, planPrices),
    planPrice: planMonthlyPrice(target.plan, agendas, planPrices),
    agendas,
  };
}

/** Lo que paga un cobro: la mensualidad, el descuento de las recomendaciones libres y las que usa. */
interface ChargeAmounts {
  baseAmount: number;
  referralDiscount: number;
  amount: number;
  referralIds: string[];
}

/**
 * La mensualidad menos el descuento de las recomendaciones ganadas y libres (availableRewardIds), las más
 * antiguas primero: tantas como hagan falta para llegar a la mensualidad, sin pasar de ella. Las que sobran
 * quedan para el cobro siguiente. En centavos, para no arrastrar decimales.
 */
async function chargeAmounts(db: Db, businessId: string, monthlyFee: number): Promise<ChargeAmounts> {
  const feeCents = Math.round(monthlyFee * 100);
  const perReferral = Math.round(REFERRAL_DISCOUNT * 100);
  const referralIds = (await availableRewardIds(db, businessId)).slice(0, Math.ceil(feeCents / perReferral));
  const discountCents = Math.min(referralIds.length * perReferral, feeCents);
  return { baseAmount: feeCents / 100, referralDiscount: discountCents / 100, amount: (feeCents - discountCents) / 100, referralIds };
}

/* -------------------------------------------------- El día de pago automático -- */

/** «$9,99», «El de su plan», «Cortesía ($0,00)»: el precio especial, para la actividad. */
const customFeeLabel = (fee: number | null) => (fee === null ? "El de su plan" : fee === 0 ? "Cortesía ($0,00)" : formatUsdAmount(fee));
const dayLabel = (day: number | null) => (day === null ? "Sin día" : `El ${day} de cada mes`);
const startLabel = (start: ISODate | null) => (start === null ? "Sin fecha" : formatDate(start, "d 'de' MMMM 'de' yyyy"));

/**
 * El día de pago y el primer cobro automáticos: los de proposedBilling (el día del mes en que empezó su plan,
 * y el primer cobro al cumplirse el mes o, si ya pasó, el siguiente día de pago), con el primer cobro a
 * BILLING_REMINDER_DAYS días de hoy como pronto: así el email de aviso de los tres días antes llega siempre
 * antes del primer cobro. A un negocio nuevo o que vuelve de Free no le cambia nada (su primer cobro es a un
 * mes); a uno que ya existía y cuyo día de pago cae en los próximos tres días, su primer cobro le queda en el
 * mes siguiente, nunca en uno ya pasado ni sin aviso.
 */
function automaticBilling(planStart: ISODate, today: ISODate): { billingDay: number; billingStart: ISODate } {
  return proposedBilling(planStart, addDaysISO(today, BILLING_REMINDER_DAYS));
}

/**
 * El día de pago automático (spec 029, ampliación del 2026-10-20, RF-010). A un negocio de pago con
 * mensualidad y sin día de pago (nuevo, que volvió de Free o que ya existía al publicarse los precios) le pone
 * su día de pago y su primer cobro (automaticBilling). Idempotente: con el día ya puesto no hace nada, y la
 * condición va en el mismo update, así dos lecturas a la vez no lo ponen dos veces. Corre en la transacción de
 * quien lo llama: el cron (antes de crear los cobros), la lectura del propietario y la ficha de /admin. Queda en
 * la actividad de la plataforma, con «Agenda360» como autor. `at`: el momento (las pruebas lo mueven).
 * Devuelve 1 si lo puso.
 */
export async function ensureBillingSchedule(db: Db, businessId: string, at: Date = new Date()): Promise<number> {
  const target = await findTarget(db, businessId);
  if (!target || target.billingDay !== null || target.plan === "free" || target.customFee === 0) return 0;
  const fee = await feeOf(db, target);
  if (fee.monthlyFee <= 0) return 0;
  const { billingDay, billingStart } = automaticBilling(target.planStart, todayIn(target.timezone, at));
  const updated = await one<{ id: string }>(
    db,
    "update subscriptions set billing_day = $2, billing_start = $3 where id = $1 and billing_day is null returning id",
    [target.subscriptionId, billingDay, billingStart],
  );
  if (!updated) return 0;
  await logAudit(db, {
    businessId: null,
    actor: null,
    actorName: APP_NAME,
    action: "platform.billing_schedule_set",
    entityType: "subscription",
    entityId: target.subscriptionId,
    summary: `Puso la mensualidad automática de ${target.businessName} (${formatUsdAmount(fee.monthlyFee)}): el ${billingDay} de cada mes, desde el ${startLabel(billingStart)}`,
    changes: [
      { label: "Día de pago", before: dayLabel(null), after: dayLabel(billingDay) },
      { label: "Primer cobro", before: startLabel(null), after: startLabel(billingStart) },
    ],
  });
  return 1;
}

/** Los negocios de pago con mensualidad y sin día de pago, para el cron (ensureBillingSchedule decide). */
export async function unscheduledBusinessIds(db: Db): Promise<string[]> {
  const rows = await many<{ id: string }>(
    db,
    `select s.business_id as id from subscriptions s
      where s.plan <> 'free' and s.billing_day is null and (s.monthly_fee is null or s.monthly_fee > 0)
      order by s.business_id`,
  );
  return rows.map((row) => row.id);
}

/* --------------------------------------------------------------- Los cobros -- */

/**
 * Crea el cobro del mes de un negocio si llegó su día de pago (RF-002), una sola vez (unique por negocio y
 * día de pago, y la suscripción bloqueada). Sólo en sus primeros BILLING_OVERDUE_DAYS días: un mes que el
 * negocio pasó suspendido o sin propietario, o un primer cobro que ya quedó atrás, no se cobra después. Su
 * monto es la mensualidad de ese momento (effectiveMonthlyFee, con los precios de los planes y las agendas
 * de hoy): un cambio de precio, de plan o de agendas vale desde el siguiente cobro, y los ya creados no
 * cambian. Si el descuento cubre la mensualidad entera, nace pagado y sus recomendaciones quedan aplicadas.
 * `at`: el momento (las pruebas lo mueven). Devuelve 1 si lo creó. No va a la actividad: pasa solo.
 */
export async function ensureCharge(db: Db, businessId: string, at: Date = new Date()): Promise<number> {
  const target = await findTarget(db, businessId, true);
  if (!target || !isBillable(target)) return 0;
  const today = todayIn(target.timezone, at);
  const due = lastDueDate(today, target.billingDay, target.billingStart);
  if (!due || daysBetween(due, today) >= BILLING_OVERDUE_DAYS) return 0;
  if (await one(db, "select 1 from billing_charges where business_id = $1 and due_date = $2", [businessId, due])) return 0;
  const { monthlyFee } = await feeOf(db, target);
  if (monthlyFee <= 0) return 0;
  const amounts = await chargeAmounts(db, businessId, monthlyFee);
  const covered = amounts.amount === 0;
  const created = await one<{ id: string }>(
    db,
    `insert into billing_charges (business_id, due_date, base_amount, referral_discount, amount, referral_ids, status, paid_at)
     values ($1, $2, $3, $4, $5, $6::uuid[], $7, case when $7 = 'paid' then now() end)
     on conflict (business_id, due_date) do nothing
     returning id`,
    [businessId, due, amounts.baseAmount, amounts.referralDiscount, amounts.amount, amounts.referralIds, covered ? "paid" : "due"],
  );
  if (!created) return 0;
  if (covered) await applyRewards(db, amounts.referralIds);
  return 1;
}

/** El propietario de un negocio, para sus emails (null: todavía no tiene). */
async function findOwner(db: Db, businessId: string) {
  return one<{ email: string; firstName: string }>(
    db,
    "select u.email, u.first_name as \"firstName\" from businesses b join users u on u.id = b.owner_id where b.id = $1",
    [businessId],
  );
}

/** El panel del propietario: al entrar, la pantalla de pago se abre sola. */
const panelUrl = () => `${appOrigin()}/dashboard`;

/**
 * El email de BILLING_REMINDER_DAYS días antes del día de pago (RF-006): el monto (con el descuento que
 * llevaría hoy) y las cuentas para transferir. Una sola vez por día de pago (`dedupe_key`), aunque el cron
 * pase muchas veces. Va sin negocio: en la bandeja sólo lo ve el propietario. Devuelve 1 si lo puso en cola.
 */
export async function queueBillingReminder(db: Db, businessId: string, at: Date = new Date()): Promise<number> {
  const target = await findTarget(db, businessId);
  if (!target || !isBillable(target)) return 0;
  const today = todayIn(target.timezone, at);
  const due = nextDueFrom(addDaysISO(today, 1), target.billingDay, target.billingStart);
  if (daysBetween(today, due) > BILLING_REMINDER_DAYS) return 0;
  const dedupeKey = `billing-reminder:${businessId}:${due}`;
  if (await one(db, "select 1 from notifications where dedupe_key = $1", [dedupeKey])) return 0;
  const owner = await findOwner(db, businessId);
  if (!owner) return 0;
  // Con la mensualidad de hoy: si cambia antes del día de pago, el cobro lleva la nueva.
  const { monthlyFee } = await feeOf(db, target);
  if (monthlyFee <= 0) return 0;
  const amounts = await chargeAmounts(db, businessId, monthlyFee);
  // Las recomendaciones todavía no se reservan: el cobro las toma en su día de pago.
  const queued = await queueEmail(db, {
    businessId: null,
    type: "billing_reminder",
    to: owner.email,
    dedupeKey,
    ...emailTemplates.billingReminder({
      firstName: owner.firstName,
      businessName: target.businessName,
      dueDate: due,
      ...amounts,
      referralCount: amounts.referralIds.length,
      panelUrl: panelUrl(),
      bankAccounts: await getPlatformBankAccounts(db),
      supportContact: formatSupportContact(await getPlatformSettings(db)),
    }),
  });
  return queued ? 1 : 0;
}

/* ------------------------------------------------------- Leer los cobros -- */

/** Las columnas de un cobro (alias `c`), con su último comprobante listo. */
const CHARGE_COLUMNS = `c.id, c.due_date as "dueDate", c.base_amount as "baseAmount", c.referral_discount as "referralDiscount",
  cardinality(c.referral_ids) as "referralCount", c.amount, c.status, c.rejection_reason as "rejectionReason",
  case when c.status = 'void' then c.void_reason end as "voidReason", c.paid_method as "paidMethod", c.paid_at as "paidAt",
  (select json_build_object('id', r.id, 'fileName', r.file_name, 'contentType', r.content_type, 'sizeBytes', r.size_bytes,
                            'createdAt', to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
     from billing_receipts r where r.charge_id = c.id and r.status = 'ready'
    order by r.created_at desc limit 1) as receipt,
  c.created_at as "createdAt"`;

/** Cobros que se muestran en el historial del propietario, como mucho (dos años). */
const HISTORY_SIZE = 24;

/** La mensualidad y el estado de pago del propietario (Configuración → Negocio y la pantalla de pago). */
async function billingState(db: Db, target: BillingTarget, at: Date): Promise<BusinessBilling> {
  const charges = await many<BillingCharge>(
    db,
    `select ${CHARGE_COLUMNS} from billing_charges c where c.business_id = $1 order by c.due_date desc limit $2`,
    [target.businessId, HISTORY_SIZE],
  );
  // El pendiente más antiguo, aunque quede fuera del historial (varios meses sin pagar: cada uno aparte).
  const pending = await one<BillingCharge>(
    db,
    `select ${CHARGE_COLUMNS} from billing_charges c
      where c.business_id = $1 and c.status = any($2::text[])
      order by c.due_date limit 1`,
    [target.businessId, AWAITING_RECEIPT],
  );
  const today = todayIn(target.timezone, at);
  const fee = await feeOf(db, target);
  return {
    // Sólo su total: nunca el precio de su plan ni de dónde sale (constitución, principio III).
    monthlyFee: fee.monthlyFee,
    billingDay: fee.monthlyFee > 0 ? target.billingDay : null,
    nextDueDate: await nextUnbilledDue(db, target, today, fee.monthlyFee),
    pending,
    // Sin gracia: un pendiente ya es de su día de pago o de antes (el cobro nace ese día), y bloquea.
    blocked: pending !== null,
    bankAccounts: await getPlatformBankAccounts(db),
    charges,
    receiptsEnabled: Boolean(receiptStorage),
  };
}

/** El próximo día de pago que todavía no tiene su cobro (null: sin mensualidad o todavía sin día de pago). */
async function nextUnbilledDue(db: Db, target: BillingTarget, today: ISODate, monthlyFee: number): Promise<ISODate | null> {
  if (!hasSchedule(target) || monthlyFee <= 0) return null;
  const due = nextDueFrom(today, target.billingDay, target.billingStart);
  const billed = await one(db, "select 1 from billing_charges where business_id = $1 and due_date = $2", [target.businessId, due]);
  return billed ? nextDueFrom(addDaysISO(due, 1), target.billingDay, target.billingStart) : due;
}

/**
 * La mensualidad de un negocio en su ficha de /admin (null: no existe): la que se le cobra, el precio de su
 * plan con sus agendas, su precio especial, el día de pago y el primer cobro. Quien la lee para la ficha
 * llama antes a ensureBillingSchedule, en la misma transacción.
 */
export async function adminBusinessBilling(db: Db, businessId: string, at: Date = new Date()): Promise<AdminBusinessBilling | null> {
  const target = await findTarget(db, businessId);
  if (!target) return null;
  const open = await one<{ count: number }>(
    db,
    "select count(*)::int as count from billing_charges where business_id = $1 and status = any($2::text[])",
    [businessId, OPEN_STATUSES],
  );
  const fee = await feeOf(db, target);
  return {
    monthlyFee: fee.monthlyFee,
    planPrice: fee.planPrice,
    customFee: target.customFee,
    agendas: fee.agendas,
    billingDay: target.billingDay,
    billingStart: target.billingStart,
    nextDueDate: await nextUnbilledDue(db, target, todayIn(target.timezone, at), fee.monthlyFee),
    openCharges: open?.count ?? 0,
  };
}

/** Las cifras del Inicio de /admin: los comprobantes por revisar y los atrasados (como «Atrasados» en Cobros). */
export async function billingCounts(db: Db): Promise<{ inReview: number; overdue: number }> {
  const row = await one<{ inReview: number; overdue: number }>(
    db,
    `select count(*) filter (where c.status = 'in_review')::int as "inReview",
            count(*) filter (where c.status = 'due' and (now() at time zone b.timezone)::date - c.due_date >= $1)::int as overdue
       from billing_charges c join businesses b on b.id = c.business_id
      where c.status in ('in_review', 'due')`,
    [BILLING_OVERDUE_DAYS],
  );
  return { inReview: row?.inReview ?? 0, overdue: row?.overdue ?? 0 };
}

/* --------------------------------------------------------- El comprobante -- */

function requireReceiptStorage(): FileStorage {
  if (!receiptStorage) {
    throw new AppError("unavailable", "Por ahora no se pueden subir comprobantes aquí: envíalo por WhatsApp al soporte.");
  }
  return receiptStorage;
}

/**
 * Quien maneja la mensualidad: el propietario (`billing.manage`). El super admin en modo soporte la ve,
 * pero con `upload` no: el comprobante lo sube el propietario (y su acción queda en la actividad).
 */
async function authorizeBilling(db: Db, ctx: RequestContext, businessId: string, options: { upload?: boolean } = {}): Promise<Actor> {
  const actor = await authorize(db, ctx, businessId, "billing.manage");
  if (options.upload && actor.support) throw new AppError("forbidden", SUPPORT_UPLOAD_FORBIDDEN);
  return actor;
}

interface ChargeRow {
  id: string;
  businessId: string;
  businessName: string;
  dueDate: ISODate;
  baseAmount: number;
  referralDiscount: number;
  amount: number;
  referralIds: string[];
  status: BillingStatus;
}

/**
 * Un cobro (de ese negocio, si se da). Con `lock`, bloqueado hasta el fin de la transacción: dos pestañas o
 * dos super admins a la vez van uno detrás de otro. 404 si no existe (o es de otro negocio).
 */
async function findCharge(db: Db, chargeId: string, options: { businessId?: string; lock?: boolean } = {}): Promise<ChargeRow> {
  const charge = isUuid(chargeId)
    ? await one<ChargeRow>(
        db,
        `select c.id, c.business_id as "businessId", b.name as "businessName", c.due_date as "dueDate",
                c.base_amount as "baseAmount", c.referral_discount as "referralDiscount", c.amount,
                c.referral_ids::text[] as "referralIds", c.status
           from billing_charges c join businesses b on b.id = c.business_id
          where c.id = $1 and ($2::uuid is null or c.business_id = $2::uuid)
          ${options.lock ? "for update of c" : ""}`,
        [chargeId, options.businessId ?? null],
      )
    : null;
  if (!charge) throw new AppError("not_found", "Cobro no encontrado.");
  return charge;
}

/** Por qué un cobro ya no recibe comprobantes. */
function closedMessage(status: BillingStatus): string {
  if (status === "in_review") return ALREADY_SENT;
  if (status === "paid") return "Este mes ya está pagado.";
  return "Este cobro está anulado: no tienes que pagarlo.";
}

async function chargeById(db: Db, chargeId: string): Promise<BillingCharge> {
  return (await one<BillingCharge>(db, `select ${CHARGE_COLUMNS} from billing_charges c where c.id = $1`, [chargeId]))!;
}

/** El último comprobante listo de un cobro, con una URL de unos minutos para verlo. */
async function receiptUrlOf(db: Db, chargeId: string): Promise<{ url: string }> {
  const storage = requireReceiptStorage();
  const receipt = await one<{ storagePath: string; fileName: string }>(
    db,
    `select storage_path as "storagePath", file_name as "fileName" from billing_receipts
      where charge_id = $1 and status = 'ready' order by created_at desc limit 1`,
    [chargeId],
  );
  if (!receipt) throw new AppError("not_found", "Este cobro no tiene comprobante.");
  return { url: await storage.createDownloadUrl(receipt.storagePath, receipt.fileName) };
}

/** Borra archivos de comprobantes ya sin registro. Después de confirmar el borrado; nunca falla. */
async function removeFiles(paths: string[]): Promise<void> {
  if (!paths.length || !receiptStorage) return;
  await receiptStorage
    .remove(paths)
    .catch((error: unknown) => console.error("No se pudieron borrar los comprobantes de la mensualidad:", error instanceof Error ? error.message : error));
}

/** /api/businesses/:businessId/billing (spec 029): la mensualidad del propietario y su comprobante. */
export const billingService = {
  /**
   * La mensualidad, el próximo pago, el historial, el cobro pendiente más antiguo (que bloquea la pantalla
   * hasta subir el comprobante) y las cuentas. Antes le pone el día de pago automático si le falta y crea el
   * cobro del mes si ya llegó su día de pago, para que la pantalla no espere al cron.
   */
  async get(ctx: RequestContext, businessId: string, at: Date = new Date()): Promise<BusinessBilling> {
    await authorizeBilling(pool, ctx, businessId);
    return transaction(async (db) => {
      await ensureBillingSchedule(db, businessId, at);
      await ensureCharge(db, businessId, at);
      const target = await findTarget(db, businessId);
      if (!target) throw new AppError("not_found", "Negocio no encontrado.");
      return billingState(db, target, at);
    });
  },

  /** Registra el comprobante (pendiente) de un cobro por pagar o rechazado y devuelve la URL firmada para subirlo. */
  async requestUpload(ctx: RequestContext, businessId: string, chargeId: string, input: unknown): Promise<BillingReceiptUpload> {
    const data = parseInput(receiptInputSchema, input);
    const storage = requireReceiptStorage();
    return transaction(async (db) => {
      await authorizeBilling(db, ctx, businessId, { upload: true });
      const charge = await findCharge(db, chargeId, { businessId, lock: true });
      if (!AWAITING_RECEIPT.includes(charge.status)) throw new AppError("conflict", closedMessage(charge.status));
      // Un tope de subidas que no terminaron (las de más de un día las borra el cron).
      const attempts = await one<{ count: number }>(
        db,
        "select count(*)::int as count from billing_receipts where charge_id = $1 and status = 'pending'",
        [charge.id],
      );
      if ((attempts?.count ?? 0) >= RECEIPT_UPLOAD_ATTEMPTS) {
        throw new AppError("conflict", "Demasiados intentos de subida. Espera un rato o envía el comprobante por WhatsApp al soporte.");
      }
      const id = randomUUID();
      // En la carpeta del negocio (se borra con él) y sin el nombre original: sólo ids y la extensión.
      const storagePath = `${businessId}/mensualidades/${charge.id}/${id}.${EXTENSIONS[data.contentType]}`;
      const receipt = (await one<BillingReceipt>(
        db,
        `insert into billing_receipts (id, charge_id, file_name, content_type, size_bytes, storage_path)
         values ($1, $2, $3, $4, $5, $6)
         returning id, file_name as "fileName", content_type as "contentType", size_bytes as "sizeBytes", created_at as "createdAt"`,
        [id, charge.id, data.fileName, data.contentType, data.sizeBytes, storagePath],
      ))!;
      const upload = await storage.createUploadUrl(storagePath, data.contentType);
      return { receipt, upload: { url: upload.url, method: "PUT", headers: upload.headers } };
    });
  },

  /**
   * El navegador terminó de subir: se comprueba que el archivo llegó (y su tamaño), el cobro pasa a «En
   * revisión» (RF-004), queda en la actividad y el super admin recibe el aviso en su campana y en el celular.
   */
  async completeUpload(ctx: RequestContext, businessId: string, chargeId: string, receiptId: string): Promise<BillingCharge> {
    const storage = requireReceiptStorage();
    const result = await transaction(async (db) => {
      const actor = await authorizeBilling(db, ctx, businessId, { upload: true });
      const charge = await findCharge(db, chargeId, { businessId, lock: true });
      const receipt = isUuid(receiptId)
        ? await one<{ storagePath: string; status: string }>(
            db,
            `select storage_path as "storagePath", status from billing_receipts where id = $1 and charge_id = $2 for update`,
            [receiptId, charge.id],
          )
        : null;
      if (!receipt) throw new AppError("not_found", "Comprobante no encontrado.");
      if (receipt.status === "ready") return { charge: await chargeById(db, charge.id), discarded: null, tooLarge: null };
      // Dos pestañas a la vez: el cobro está bloqueado, así que sólo la primera queda.
      if (!AWAITING_RECEIPT.includes(charge.status)) {
        await db.query("delete from billing_receipts where id = $1", [receiptId]);
        return { charge: null, discarded: { path: receipt.storagePath, message: closedMessage(charge.status) }, tooLarge: null };
      }
      const size = await storage.sizeOf(receipt.storagePath);
      if (size === null) throw new AppError("conflict", "El comprobante no terminó de subirse. Vuelve a intentarlo.");
      if (size > RECEIPT_MAX_BYTES) {
        await db.query("delete from billing_receipts where id = $1", [receiptId]);
        return { charge: null, discarded: null, tooLarge: receipt.storagePath };
      }
      await db.query("update billing_receipts set status = 'ready', size_bytes = $2 where id = $1", [receiptId, size]);
      await db.query("update billing_charges set status = 'in_review', updated_at = now() where id = $1", [charge.id]);
      await logAudit(db, {
        businessId: null,
        actor,
        action: "platform.billing_receipt_uploaded",
        entityType: "subscription",
        entityId: charge.id,
        summary: `Subió el comprobante de la mensualidad de ${monthLabel(charge.dueDate)} de ${charge.businessName} (${formatUsdAmount(charge.amount)})`,
      });
      await notifyBillingReceipt(db, { id: receiptId, businessName: charge.businessName, amount: charge.amount, dueDate: charge.dueDate });
      return { charge: await chargeById(db, charge.id), discarded: null, tooLarge: null };
    });
    if (result.discarded) {
      await removeFiles([result.discarded.path]);
      throw new AppError("conflict", result.discarded.message);
    }
    if (result.tooLarge) {
      await removeFiles([result.tooLarge]);
      throw new AppError("validation", "El archivo supera los 10 MB.");
    }
    return result.charge!;
  },

  /** Su comprobante de un cobro, con una URL de unos minutos (también en modo soporte: sólo lo ve). */
  async receiptUrl(ctx: RequestContext, businessId: string, chargeId: string): Promise<{ url: string }> {
    await authorizeBilling(pool, ctx, businessId);
    return receiptUrlOf(pool, (await findCharge(pool, chargeId, { businessId })).id);
  },
};

/* --------------------------------------------------------- El super admin -- */

/** «3 agendas»: las agendas incluidas, para la actividad. */
const agendasLabel = (agendas: number) => (agendas === 1 ? "1 agenda" : `${agendas} agendas`);

/** Los campos de /admin → Planes, como los dice la actividad. */
const PRICE_FIELDS: { key: keyof PlanPrices; label: string; format: (value: number) => string }[] = [
  { key: "proPrice", label: "Pro", format: formatUsdAmount },
  { key: "businessPrice", label: "Business", format: formatUsdAmount },
  { key: "businessIncludedAgendas", label: "Agendas incluidas en Business", format: agendasLabel },
  { key: "businessExtraAgendaPrice", label: "Cada agenda más de Business", format: formatUsdAmount },
];

/** «Pro $14,99 · Business $29,99 con 3 agendas y $8,00 por cada agenda más». */
const describePrices = (prices: PlanPrices) =>
  `Pro ${formatUsdAmount(prices.proPrice)} · Business ${formatUsdAmount(prices.businessPrice)} con ${agendasLabel(
    prices.businessIncludedAgendas,
  )} y ${formatUsdAmount(prices.businessExtraAgendaPrice)} por cada agenda más`;

/** Los datos de un cobro para los emails al propietario. */
const emailData = (charge: ChargeRow, firstName: string): BillingEmailData => ({
  firstName,
  businessName: charge.businessName,
  dueDate: charge.dueDate,
  amount: charge.amount,
  baseAmount: charge.baseAmount,
  referralDiscount: charge.referralDiscount,
  referralCount: charge.referralIds.length,
  panelUrl: panelUrl(),
});

/** El email de un cambio de estado al propietario (si el negocio todavía lo tiene). Va sin negocio: sólo lo ve él. */
async function emailOwner(
  db: Db,
  charge: ChargeRow,
  type: "billing_paid" | "billing_rejected" | "billing_voided",
  build: (data: BillingEmailData) => { subject: string; body: string; html: string },
): Promise<void> {
  const owner = await findOwner(db, charge.businessId);
  if (!owner) return;
  await queueEmail(db, { businessId: null, type, to: owner.email, ...build(emailData(charge, owner.firstName)) });
}

/** Por qué un cobro en `status` ya no admite la acción del super admin (409). */
const CLOSED_FOR_ADMIN: Partial<Record<BillingStatus, string>> = {
  paid: "Este cobro ya está pagado.",
  void: "Este cobro está anulado.",
};

/** Lo que dice el 409 de cada acción, según el estado en que encontró el cobro. */
const NOT_IN_REVIEW = (status: BillingStatus) => CLOSED_FOR_ADMIN[status] ?? "Este cobro no está en revisión: no tiene un comprobante por revisar.";
const NOT_AWAITING = (status: BillingStatus) =>
  status === "in_review" ? "Este cobro tiene comprobante: revísalo y márcalo «Pagado»." : (CLOSED_FOR_ADMIN[status] ?? "");
const NOT_OPEN = (status: BillingStatus) => CLOSED_FOR_ADMIN[status] ?? "";

/**
 * Cambia el estado de un cobro (bloqueado) si está en uno de `from` (409 con `conflict` si no) y deja quién
 * lo hizo. `set`: las columnas de más, con sus valores desde $4.
 */
async function moveCharge(
  db: Db,
  actor: AuditActor,
  chargeId: string,
  change: { from: BillingStatus[]; to: BillingStatus; conflict: (status: BillingStatus) => string; set?: string; values?: unknown[] },
): Promise<ChargeRow> {
  const charge = await findCharge(db, chargeId, { lock: true });
  if (!change.from.includes(charge.status)) throw new AppError("conflict", change.conflict(charge.status));
  await db.query(
    `update billing_charges set status = $2, reviewed_by = $3, updated_at = now()${change.set ? `, ${change.set}` : ""} where id = $1`,
    [charge.id, change.to, actor.userId, ...(change.values ?? [])],
  );
  return charge;
}

/** La fila de /admin → Cobros: los cobros con su negocio, quién los revisó y los días que llevan. */
interface AdminChargeRow extends AdminBillingCharge {
  daysSince: number;
}

/**
 * Cada cobro, en un filtro. Los por pagar se separan por los días desde su día de pago, sólo para el super
 * admin (el propietario no tiene gracia): «Por pagar» antes de BILLING_OVERDUE_DAYS y «Atrasados» desde ahí.
 */
const FILTER_SQL: Record<AdminBillingFilter, string> = {
  in_review: "c.status = 'in_review'",
  due: `c.status = 'due' and (now() at time zone b.timezone)::date - c.due_date < ${BILLING_OVERDUE_DAYS}`,
  overdue: `c.status = 'due' and (now() at time zone b.timezone)::date - c.due_date >= ${BILLING_OVERDUE_DAYS}`,
  paid: "c.status = 'paid'",
  rejected: "c.status = 'rejected'",
  void: "c.status = 'void'",
};

/** Cobros por página de /admin → Cobros, como mucho. */
const ADMIN_LIST_SIZE = 200;

/** /api/admin/billing… (spec 029): la mensualidad de cada negocio, los cobros y las cuentas de Agenda360. */
export const adminBillingService = {
  /**
   * El precio especial, el día de pago y el primer cobro de un negocio (RF-001; el precio especial, desde la
   * ampliación del 2026-10-20). Sin precio especial (null) se le cobra el de su plan con sus agendas; con 0,
   * nada (cortesía). Sin día de pago ni primer cobro, los pone la API como el sistema (automaticBilling). Un
   * primer cobro nuevo no puede ser anterior a hoy (en la zona del negocio). Un cambio vale desde el siguiente
   * cobro: los ya creados no cambian. Queda en la actividad de la plataforma, con lo que cambió.
   */
  async setBusinessBilling(ctx: RequestContext, businessId: string, input: unknown): Promise<AdminBusinessBilling> {
    const actor = authorizeSuperAdmin(ctx);
    const parsed = parseInput(businessBillingSchema, input);
    return transaction(async (db) => {
      const before = await findTarget(db, businessId, true);
      if (!before) throw new AppError("not_found", "Negocio no encontrado.");
      const today = todayIn(before.timezone, new Date());
      const fee = await feeOf(db, { ...before, customFee: parsed.customFee });
      // Sin día de pago ni primer cobro, los dos salen del día en que empezó su plan (pedido del dueño del
      // producto, 2026-10-20): creado el 8 de septiembre, paga el 8 de cada mes desde el 8 de octubre.
      const data =
        fee.monthlyFee > 0 && parsed.billingDay === null && parsed.billingStart === null
          ? { ...parsed, ...automaticBilling(before.planStart, today) }
          : parsed;
      if (fee.monthlyFee > 0 && data.billingStart !== null && data.billingStart !== before.billingStart && data.billingStart < today) {
        throw new AppError("validation", "La fecha del primer cobro no puede ser anterior a hoy.");
      }
      const feeChanged = data.customFee !== before.customFee;
      const scheduleChanged = data.billingDay !== before.billingDay || data.billingStart !== before.billingStart;
      const changes: AuditChange[] = [
        feeChanged && { label: "Precio especial", before: customFeeLabel(before.customFee), after: customFeeLabel(data.customFee) },
        data.billingDay !== before.billingDay && { label: "Día de pago", before: dayLabel(before.billingDay), after: dayLabel(data.billingDay) },
        data.billingStart !== before.billingStart && {
          label: "Primer cobro",
          before: startLabel(before.billingStart),
          after: startLabel(data.billingStart),
        },
      ].filter((change) => change !== false);
      if (changes.length > 0) {
        await db.query("update subscriptions set monthly_fee = $2, billing_day = $3, billing_start = $4 where id = $1", [
          before.subscriptionId,
          data.customFee,
          data.billingDay,
          data.billingStart,
        ]);
        const name = before.businessName;
        const planPart = `${describePlanPrice(before.plan, fee.agendas)}${fee.planPrice > 0 ? `, ${formatUsdAmount(fee.planPrice)}` : ": sin cobros"}`;
        const feePart =
          data.customFee === null
            ? `Quitó el precio especial de ${name}: vuelve al de su plan (${planPart})`
            : data.customFee === 0
              ? `Puso a ${name} en cortesía: sin cobros`
              : `Puso a ${name} el precio especial de ${formatUsdAmount(data.customFee)}`;
        const schedulePart = data.billingDay === null ? null : `el ${data.billingDay} de cada mes desde el ${startLabel(data.billingStart)}`;
        await logAudit(db, {
          businessId: null,
          actor,
          action: "platform.billing_fee_changed",
          entityType: "subscription",
          entityId: before.subscriptionId,
          summary: feeChanged
            ? `${feePart}${scheduleChanged && schedulePart ? `; ${schedulePart}` : ""}`
            : schedulePart
              ? `Cambió el día de pago de ${name}: ${schedulePart}`
              : `Quitó el día de pago de ${name}`,
          changes,
        });
      }
      return (await adminBusinessBilling(db, businessId))!;
    });
  },

  /** Los precios de los planes, para /admin → Planes. */
  async getPlanPrices(ctx: RequestContext): Promise<PlanPrices> {
    authorizeSuperAdmin(ctx);
    return getPlanPrices(pool);
  },

  /**
   * Cambia los precios de los planes (RF-009): valen desde el siguiente cobro de cada negocio. Los cobros ya
   * creados no cambian, y los negocios con precio especial siguen con el suyo. Queda en la actividad de la
   * plataforma, con lo que cambió.
   */
  async setPlanPrices(ctx: RequestContext, input: unknown): Promise<PlanPrices> {
    const actor = authorizeSuperAdmin(ctx);
    const data = parseInput(planPricesSchema, input);
    return transaction(async (db) => {
      // Una sola fila: bloqueada, dos super admins a la vez van uno detrás de otro.
      await db.query("select 1 from platform_settings for update");
      const before = await getPlanPrices(db);
      const changes = PRICE_FIELDS.filter(({ key }) => data[key] !== before[key]).map(({ key, label, format }) => ({
        label,
        before: format(before[key]),
        after: format(data[key]),
      }));
      if (changes.length === 0) return before;
      await db.query(
        "update platform_settings set pro_price = $1, business_price = $2, business_included_agendas = $3, business_extra_agenda_price = $4",
        [data.proPrice, data.businessPrice, data.businessIncludedAgendas, data.businessExtraAgendaPrice],
      );
      await logAudit(db, {
        businessId: null,
        actor,
        action: "platform.plan_prices_changed",
        entityType: "platform",
        entityId: null,
        summary: `Cambió los precios de los planes: ${describePrices(data)}`,
        changes,
      });
      return data;
    });
  },

  /** Los cobros de un filtro (los pendientes, el más antiguo primero; los demás, el último cambio primero) y las cifras de cada uno. */
  async list(ctx: RequestContext, query: Record<string, unknown>): Promise<AdminBillingList> {
    authorizeSuperAdmin(ctx);
    const filter = parseInput(adminBillingFilterSchema, typeof query.status === "string" && query.status !== "" ? query.status : undefined);
    const pendingFirst = filter === "in_review" || filter === "due" || filter === "overdue";
    const [rows, counts] = await Promise.all([
      many<AdminChargeRow>(
        pool,
        `select ${CHARGE_COLUMNS}, json_build_object('id', b.id, 'name', b.name) as business,
                c.paid_note as "paidNote", nullif(trim(u.first_name || ' ' || u.last_name), '') as "reviewedByName",
                c.updated_at as "updatedAt", (now() at time zone b.timezone)::date - c.due_date as "daysSince"
           from billing_charges c
           join businesses b on b.id = c.business_id
           left join users u on u.id = c.reviewed_by
          where ${FILTER_SQL[filter]}
          order by ${pendingFirst ? "c.due_date, b.name" : "c.updated_at desc"}, c.id
          limit $1`,
        [ADMIN_LIST_SIZE],
      ),
      one<Record<AdminBillingFilter, number>>(
        pool,
        `select ${Object.entries(FILTER_SQL)
          .map(([key, where]) => `count(*) filter (where ${where})::int as "${key}"`)
          .join(", ")}
           from billing_charges c join businesses b on b.id = c.business_id`,
      ),
    ]);
    return {
      charges: rows.map(({ daysSince, ...charge }) => ({
        ...charge,
        // Los días que le faltan a un cobro por pagar para salir en «Atrasados» (como FILTER_SQL).
        overdueInDays: charge.status === "due" ? Math.max(0, Math.min(BILLING_OVERDUE_DAYS, BILLING_OVERDUE_DAYS - daysSince)) : 0,
      })),
      counts: counts!,
    };
  },

  /**
   * «Pagado» (RF-005): el comprobante está bien. Los descuentos de referidos que usa quedan aplicados y al
   * propietario le llega «Recibimos tu pago, gracias».
   */
  async approve(ctx: RequestContext, chargeId: string): Promise<void> {
    const actor = authorizeSuperAdmin(ctx);
    await transaction(async (db) => {
      const charge = await moveCharge(db, actor, chargeId, {
        from: ["in_review"],
        to: "paid",
        conflict: NOT_IN_REVIEW,
        set: "paid_method = 'transfer', paid_at = now()",
      });
      await applyRewards(db, charge.referralIds);
      await emailOwner(db, charge, "billing_paid", (data) => emailTemplates.billingPaid({ ...data, method: "transfer" }));
      await logAudit(db, {
        businessId: null,
        actor,
        action: "platform.billing_charge_paid",
        entityType: "subscription",
        entityId: charge.id,
        summary: `Confirmó el pago de la mensualidad de ${monthLabel(charge.dueDate)} de ${charge.businessName} (${formatUsdAmount(charge.amount)})`,
      });
    });
  },

  /**
   * «Rechazar», con el motivo (RF-005): al propietario le llega por email y, al entrar, se le vuelve a abrir
   * la pantalla de pago, que no se cierra hasta subir otro comprobante.
   */
  async reject(ctx: RequestContext, chargeId: string, input: unknown): Promise<void> {
    const actor = authorizeSuperAdmin(ctx);
    const { reason } = parseInput(billingReasonSchema, input ?? {});
    await transaction(async (db) => {
      const charge = await moveCharge(db, actor, chargeId, {
        from: ["in_review"],
        to: "rejected",
        conflict: NOT_IN_REVIEW,
        set: "rejection_reason = $4",
        values: [reason],
      });
      const supportContact = formatSupportContact(await getPlatformSettings(db));
      await emailOwner(db, charge, "billing_rejected", (data) => emailTemplates.billingRejected({ ...data, reason, supportContact }));
      await logAudit(db, {
        businessId: null,
        actor,
        action: "platform.billing_charge_rejected",
        entityType: "subscription",
        entityId: charge.id,
        summary: `Rechazó el comprobante de la mensualidad de ${monthLabel(charge.dueDate)} de ${charge.businessName}: ${reason}`,
      });
    });
  },

  /** «Pagado sin comprobante»: el pago llegó por otra vía (efectivo…). Como «Pagado», con su nota. */
  async markPaid(ctx: RequestContext, chargeId: string, input: unknown): Promise<void> {
    const actor = authorizeSuperAdmin(ctx);
    const { note } = parseInput(billingPaidSchema, input ?? {});
    await transaction(async (db) => {
      const charge = await moveCharge(db, actor, chargeId, {
        from: AWAITING_RECEIPT,
        to: "paid",
        conflict: NOT_AWAITING,
        set: "paid_method = 'other', paid_at = now(), paid_note = nullif($4, '')",
        values: [note],
      });
      await applyRewards(db, charge.referralIds);
      await emailOwner(db, charge, "billing_paid", (data) => emailTemplates.billingPaid({ ...data, method: "other" }));
      await logAudit(db, {
        businessId: null,
        actor,
        action: "platform.billing_charge_paid_other",
        entityType: "subscription",
        entityId: charge.id,
        summary: `Marcó pagada sin comprobante la mensualidad de ${monthLabel(charge.dueDate)} de ${charge.businessName} (${formatUsdAmount(charge.amount)})${note ? `: ${note}` : ""}`,
      });
    });
  },

  /**
   * «Anular», con el motivo: el cobro ya no se paga (p. ej. el negocio pasó al plan gratis). Sus descuentos
   * de referidos vuelven a quedar libres para el cobro siguiente. Al propietario le llega por email.
   */
  async void(ctx: RequestContext, chargeId: string, input: unknown): Promise<void> {
    const actor = authorizeSuperAdmin(ctx);
    const { reason } = parseInput(billingReasonSchema, input ?? {});
    await transaction(async (db) => {
      const charge = await moveCharge(db, actor, chargeId, {
        from: OPEN_STATUSES,
        to: "void",
        conflict: NOT_OPEN,
        set: "void_reason = $4",
        values: [reason],
      });
      await emailOwner(db, charge, "billing_voided", (data) => emailTemplates.billingVoided({ ...data, reason }));
      await logAudit(db, {
        businessId: null,
        actor,
        action: "platform.billing_charge_voided",
        entityType: "subscription",
        entityId: charge.id,
        summary: `Anuló el cobro de la mensualidad de ${monthLabel(charge.dueDate)} de ${charge.businessName} (${formatUsdAmount(charge.amount)}): ${reason}`,
      });
    });
  },

  /** El último comprobante de un cobro, con una URL de unos minutos. */
  async receiptUrl(ctx: RequestContext, chargeId: string): Promise<{ url: string }> {
    authorizeSuperAdmin(ctx);
    return receiptUrlOf(pool, (await findCharge(pool, chargeId)).id);
  },

  /** Las cuentas de Agenda360 para recibir las mensualidades. */
  async getAccounts(ctx: RequestContext): Promise<{ bankAccounts: BankAccount[] }> {
    authorizeSuperAdmin(ctx);
    return { bankAccounts: await getPlatformBankAccounts(pool) };
  },

  /** Cambia las cuentas (hasta 3, la primera la principal). Queda en la actividad de la plataforma. */
  async setAccounts(ctx: RequestContext, input: unknown): Promise<{ bankAccounts: BankAccount[] }> {
    const actor = authorizeSuperAdmin(ctx);
    const { bankAccounts } = parseInput(platformBankAccountsSchema, input);
    return transaction(async (db) => {
      const before = await getPlatformBankAccounts(db);
      const same = (a: BankAccount[], b: BankAccount[]) =>
        a.length === b.length &&
        a.every((account, index) =>
          (["bank", "accountType", "number", "holder", "holderId"] as const).every((key) => account[key] === b[index][key]),
        );
      if (same(before, bankAccounts)) return { bankAccounts: before };
      await db.query("update platform_settings set bank_accounts = $1", [JSON.stringify(bankAccounts)]);
      const banks = (accounts: BankAccount[]) => (accounts.length ? accounts.map((account) => account.bank).join(", ") : "Ninguna");
      await logAudit(db, {
        businessId: null,
        actor,
        action: "platform.billing_accounts_changed",
        entityType: "platform",
        entityId: null,
        summary:
          bankAccounts.length > 0
            ? `Cambió las cuentas para recibir las mensualidades: ${banks(bankAccounts)}`
            : "Quitó las cuentas para recibir las mensualidades",
        changes: [{ label: "Cuentas", before: banks(before), after: banks(bankAccounts) }],
      });
      return { bankAccounts };
    });
  },
};

/* ---------------------------------------------------------------- La purga -- */

/** Comprobantes que se borran en cada pasada del cron, como mucho. */
const PURGE_BATCH = 500;

/**
 * Los comprobantes de más de BILLING_RECEIPT_RETENTION_MONTHS meses (contabilidad): primero sus archivos y
 * después sus registros; el cobro se queda como historial. Si el almacenamiento falla, los registros quedan
 * y se reintenta en la próxima pasada. Lo llama el cron; devuelve cuántos borró (null: sin almacenamiento).
 */
export async function purgeOldBillingReceipts(): Promise<number | null> {
  if (!receiptStorage) return null;
  const old = await many<{ id: string; storagePath: string }>(
    pool,
    `select id, storage_path as "storagePath" from billing_receipts
      where created_at < now() - make_interval(months => $1)
      order by created_at limit $2`,
    [BILLING_RECEIPT_RETENTION_MONTHS, PURGE_BATCH],
  );
  if (old.length === 0) return 0;
  await receiptStorage.remove(old.map((receipt) => receipt.storagePath));
  await pool.query("delete from billing_receipts where id = any($1::uuid[])", [old.map((receipt) => receipt.id)]);
  return old.length;
}

/**
 * Subidas que nunca se completaron (más de un día): primero su archivo (el navegador pudo llegar a
 * subirlo) y después su registro. Si el almacenamiento falla, el registro queda y se reintenta en la
 * próxima pasada. Lo llama el cron.
 */
export async function deleteStalePendingBillingReceipts(): Promise<void> {
  const stale = await many<{ id: string; storagePath: string }>(
    pool,
    `select id, storage_path as "storagePath" from billing_receipts
      where status = 'pending' and created_at < now() - interval '1 day'
      order by created_at limit $1`,
    [PURGE_BATCH],
  );
  if (stale.length === 0) return;
  try {
    await receiptStorage?.remove(stale.map((receipt) => receipt.storagePath));
  } catch (error) {
    console.error("No se pudieron borrar los comprobantes de mensualidades sin terminar de subir:", error instanceof Error ? error.message : error);
    return;
  }
  await pool.query("delete from billing_receipts where id = any($1::uuid[]) and status = 'pending'", [stale.map((receipt) => receipt.id)]);
}
