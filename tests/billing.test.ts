// El cobro de las mensualidades por transferencia (spec 029): los precios de los planes (sólo el super admin,
// con su actividad, nunca para los negocios ni en la configuración pública), la mensualidad automática (Pro y
// Business con sus agendas, sin tope las activas, el día de pago desde el día en que empezó su plan: en la
// ficha, en la lectura del propietario, en el cron y al volver de Free), el precio especial (poner, quitar y
// cortesía), las cuentas de la plataforma (nunca en la configuración pública), el cobro de cada mes (su día
// de pago en la zona del negocio, el 31 que cae el 30, una sola vez, con la mensualidad de ese momento, nunca
// en cortesía, en el plan gratis, suspendido o sin propietario), el descuento de referidos (sin reusar,
// aplicado al pagarse, libre al anular, también sobre el precio del plan), el recordatorio de tres días antes,
// el estado del propietario (bloqueado desde el día de pago, sin gracia) y «Por pagar» y «Atrasados» en
// /admin (moviendo las fechas con sql), el comprobante (a «En revisión», con la campana y el ntfy del super
// admin), aprobar, rechazar, pagado sin comprobante y anular (cada uno con su email y su actividad), quién ve
// qué y la purga de los comprobantes de más de 12 meses.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { businessInput } from "./helpers/business.mjs";
import { checks, count, fakeNtfy, login, runCron, sql, BASE } from "./helpers/harness.ts";
import { addDaysISO, addMonthsISO, dayOfMonthISO, getZonedNow } from "../src/shared/lib/time.ts";
import { proposedBilling } from "../src/shared/lib/validations/admin.ts";
import type {
  AdminBillingList,
  AdminBusinessBilling,
  AdminBusinessDetail,
  BusinessBilling,
  PanelNoticePage,
  PlanPrices,
  PlatformStats,
  ReferralReward,
} from "../src/shared/types/index.ts";

const { ok, done } = checks();
const { pool, transaction } = await import("../src/db/pool.ts");
const billing = await import("../src/services/billing-service.ts");
const tasks = await import("../src/jobs/scheduled-tasks.ts");
const ORIGIN = new URL(BASE).origin;

const admin = await login("admin@demo.com");
const owner = await login("jhordan@demo.com"); // Propietario de «Centro Profesional» (plan Pro).
const andrea = await login("andrea@demo.com"); // Administradora del Centro.
const miguel = await login("miguel@demo.com"); // Recepción del Centro.
const valeria = await login("valeria@demo.com"); // Rol Profesional en la Clínica Dental.
const ricardo = await login("ricardo@demo.com"); // Propietario de la Clínica Dental.

const idOf = (slug: string) => sql(`select id from businesses where slug = '${slug}'`);
const CENTRO = idOf("jhordan");
const DENTAL = idOf("dental-sonrisa");
const FISIO = idOf("fisioactiva");
const centroName = sql(`select name from businesses where id = '${CENTRO}'`);
const TZ = sql(`select timezone from businesses where id = '${CENTRO}'`);
const today = () => getZonedNow(TZ).date;
const B = `/businesses/${CENTRO}`;

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
/** Sube el archivo a la URL firmada (almacenamiento local de las pruebas). */
const put = (upload: { url: string; headers: Record<string, string> }, body: Buffer) =>
  fetch(ORIGIN + upload.url, { method: "PUT", headers: upload.headers, body });
const receiptInput = { fileName: "transferencia.png", contentType: "image/png", sizeBytes: PNG.length };

const ownerBilling = async () => (await owner("GET", `${B}/billing`)).body as BusinessBilling;
const adminList = async (status: string) => (await admin("GET", `/admin/billing?status=${status}`)).body as AdminBillingList;
const stats = async () => (await admin("GET", "/admin/stats")).body as PlatformStats;
const lastAudit = (action: string) =>
  sql(`select coalesce(business_id::text, 'sin negocio') || ' | ' || actor_name || ' | ' || summary || ' | ' || coalesce(changes::text, '')
         from audit_logs where action = '${action}' order by created_at desc, id desc limit 1`);
const audits = (action: string) => count(`select count(*) from audit_logs where action = '${action}'`);
const lastEmail = (type: string) =>
  sql(`select coalesce(business_id::text, 'sin negocio') || ' | ' || to_email || ' | ' || subject || ' | ' || body
         from notifications where type = '${type}' order by created_at desc limit 1`);
const emails = (type: string) => count(`select count(*) from notifications where type = '${type}'`);

/** Un cobro creado como lo haría el cron en ese momento (`at`), en su transacción. */
const ensureAt = (businessId: string, at: string) => transaction((db) => billing.ensureCharge(db, businessId, new Date(at)));
const reminderAt = (businessId: string, at: string) => transaction((db) => billing.queueBillingReminder(db, businessId, new Date(at)));
const chargeOf = (businessId: string, due: string) =>
  sql(`select id || ' ' || base_amount || ' ' || referral_discount || ' ' || amount || ' ' || cardinality(referral_ids) || ' ' || status
         from billing_charges where business_id = '${businessId}' and due_date = '${due}'`);

/** La mensualidad en la ficha de /admin: al leerla, el sistema le pone el día de pago si le falta. */
const ficha = async (businessId: string) => ((await admin("GET", `/admin/businesses/${businessId}`)).body as AdminBusinessDetail).billing as AdminBusinessBilling;
/** El día en que empezó su plan, en la zona del negocio. */
const planStartOf = (businessId: string) =>
  sql(`select (s.plan_since at time zone b.timezone)::date from subscriptions s join businesses b on b.id = s.business_id where b.id = '${businessId}'`);
/** El día de pago automático: el de proposedBilling, con el primer cobro a tres días de hoy como pronto (el aviso). */
const automatic = (planStart: string) => proposedBilling(planStart, addDaysISO(today(), 3));

/** Los de la migración 050. */
const DEFAULT_PRICES: PlanPrices = { proPrice: 14.99, businessPrice: 29.99, businessIncludedAgendas: 3, businessExtraAgendaPrice: 8 };
const setPrices = async (prices: PlanPrices) => {
  const r = await admin("PUT", "/admin/plan-prices", prices);
  if (r.status !== 200) throw new Error(`No se pudieron poner los precios: ${JSON.stringify(r.body)}`);
};

const ACCOUNTS = [
  { bank: "Banco Pichincha", accountType: "savings", number: "2200123456", holder: "Agenda360 S.A.S.", holderId: "1790012345001" },
  { bank: "Produbanco", accountType: "checking", number: "1005566778", holder: "Agenda360 S.A.S.", holderId: "" },
];

/* --------------------------------------------------------------- Las cuentas ---- */

console.log("Las cuentas de la plataforma");
{
  let r = await owner("GET", "/admin/billing-accounts");
  ok(r.status === 403, "un propietario no las lee desde /admin", r.status);
  r = await admin("PUT", "/admin/billing-accounts", { bankAccounts: [...ACCOUNTS, ...ACCOUNTS] });
  ok(r.status === 400, "más de 3 cuentas → 400", r.body);
  r = await admin("PUT", "/admin/billing-accounts", { bankAccounts: [{ ...ACCOUNTS[0], number: "12a" }] });
  ok(r.status === 400, "un número que no es de una cuenta → 400", r.body);
  const before = audits("platform.billing_accounts_changed");
  r = await admin("PUT", "/admin/billing-accounts", { bankAccounts: ACCOUNTS });
  ok(r.status === 200 && r.body.bankAccounts.length === 2, "el super admin pone sus dos cuentas", r.body);
  ok(audits("platform.billing_accounts_changed") === before + 1, "queda en la actividad");
  ok(
    lastAudit("platform.billing_accounts_changed").startsWith("sin negocio | ") &&
      lastAudit("platform.billing_accounts_changed").includes("Banco Pichincha, Produbanco"),
    "en la de la plataforma, con los bancos",
    lastAudit("platform.billing_accounts_changed"),
  );
  r = await admin("PUT", "/admin/billing-accounts", { bankAccounts: ACCOUNTS });
  ok(r.status === 200 && audits("platform.billing_accounts_changed") === before + 1, "las mismas otra vez no anotan nada");
  r = await admin("GET", "/admin/billing-accounts");
  ok(r.status === 200 && r.body.bankAccounts[0].number === "2200123456", "y las lee", r.body);

  const pub = await fetch(`${BASE}/public/platform-settings`);
  const text = await pub.text();
  ok(
    pub.status === 200 && Object.keys(JSON.parse(text)).sort().join(",") === "allowPublicSignup,supportEmail,supportPhone",
    "/public/platform-settings no trae las cuentas",
    text,
  );
  ok(!text.includes("2200123456") && !text.includes("Pichincha"), "ni un número ni un banco", text);
}

/* ------------------------------------------------------- Los precios de los planes ---- */

console.log("Los precios de los planes (/admin → Planes)");
{
  let r = await owner("GET", "/admin/plan-prices");
  ok(r.status === 403, "un propietario no los lee", r.status);
  r = await owner("PUT", "/admin/plan-prices", { ...DEFAULT_PRICES, proPrice: 1 });
  ok(r.status === 403, "ni los cambia", r.status);
  r = await admin("GET", "/admin/plan-prices");
  ok(
    r.status === 200 && JSON.stringify(r.body) === JSON.stringify(DEFAULT_PRICES),
    "los de la migración: Pro $14,99; Business $29,99 con 3 agendas y $8 por cada agenda más",
    r.body,
  );
  ok(r.headers.get("cache-control") === "no-store", "sin caché", r.headers.get("cache-control"));
  for (const [input, label] of [
    [{ ...DEFAULT_PRICES, proPrice: -1 }, "un precio negativo"],
    [{ ...DEFAULT_PRICES, businessPrice: 29.999 }, "más de dos decimales"],
    [{ ...DEFAULT_PRICES, businessExtraAgendaPrice: "" }, "un precio vacío"],
    [{ ...DEFAULT_PRICES, businessIncludedAgendas: 0 }, "Business sin agendas incluidas"],
    [{ ...DEFAULT_PRICES, businessIncludedAgendas: 2.5 }, "agendas que no son enteras"],
  ] as const) {
    r = await admin("PUT", "/admin/plan-prices", input);
    ok(r.status === 400, `${label} → 400`, r.body);
  }
  const before = audits("platform.plan_prices_changed");
  r = await admin("PUT", "/admin/plan-prices", DEFAULT_PRICES);
  ok(r.status === 200 && audits("platform.plan_prices_changed") === before, "los mismos otra vez no anotan nada", r.body);
  r = await admin("PUT", "/admin/plan-prices", { ...DEFAULT_PRICES, proPrice: 15.49, businessExtraAgendaPrice: 9 });
  ok(r.status === 200 && r.body.proPrice === 15.49 && r.body.businessExtraAgendaPrice === 9, "el super admin los cambia", r.body);
  ok((await admin("GET", "/admin/plan-prices")).body.proPrice === 15.49, "y quedan guardados");
  ok(audits("platform.plan_prices_changed") === before + 1, "queda en la actividad");
  const audit = lastAudit("platform.plan_prices_changed");
  ok(
    audit.startsWith("sin negocio | Admin") &&
      audit.includes("Cambió los precios de los planes: Pro $15,49 · Business $29,99 con 3 agendas y $9,00 por cada agenda más") &&
      audit.includes('"label": "Pro"') &&
      audit.includes('"before": "$14,99"') &&
      audit.includes('"after": "$15,49"') &&
      audit.includes('"label": "Cada agenda más de Business"') &&
      !audit.includes("Agendas incluidas"),
    "en la de la plataforma, con lo que cambió (y sólo eso)",
    audit,
  );
  await setPrices(DEFAULT_PRICES);
}

/* ---------------------------------------------------- La mensualidad automática ---- */

console.log("La mensualidad automática: el precio de su plan y el día en que empezó");
{
  ok(
    sql(`select coalesce(monthly_fee::text, 'null') || ' ' || coalesce(billing_day::text, 'null') from subscriptions where business_id = '${CENTRO}'`) ===
      "null null",
    "un negocio que ya existía, después de la migración: sin precio especial ni día de pago",
  );
  const schedules = audits("platform.billing_schedule_set");
  const started = planStartOf(CENTRO);
  const expected = automatic(started);
  let billing = await ficha(CENTRO);
  ok(billing.monthlyFee === 14.99 && billing.planPrice === 14.99 && billing.customFee === null, "Pro: $14,99, el de su plan", billing);
  ok(
    billing.billingDay === Number(started.slice(8)) &&
      billing.billingStart === dayOfMonthISO(addMonthsISO(started, 1), Number(started.slice(8))) &&
      billing.billingStart === expected.billingStart &&
      billing.nextDueDate === billing.billingStart,
    "al abrir su ficha, el sistema le pone el día en que empezó su plan, con el primer cobro al cumplirse el mes",
    [started, billing],
  );
  ok(audits("platform.billing_schedule_set") === schedules + 1, "queda en la actividad");
  const audit = lastAudit("platform.billing_schedule_set");
  ok(
    audit.startsWith(
      `sin negocio | Agenda360 | Puso la mensualidad automática de ${centroName} ($14,99): el ${billing.billingDay} de cada mes, desde el `,
    ) && audit.includes('"label": "Día de pago"'),
    "en la de la plataforma, con «Agenda360» como autor y lo que cambió",
    audit,
  );
  await ficha(CENTRO);
  ok(audits("platform.billing_schedule_set") === schedules + 1, "abrir la ficha otra vez no lo vuelve a poner");
  const state = await ownerBilling();
  ok(
    state.monthlyFee === 14.99 && state.billingDay === billing.billingDay && state.nextDueDate === billing.billingStart && state.pending === null,
    "el propietario ve su total y su próximo pago, todavía sin cobro",
    state,
  );

  // Business: $29,99 con 3 agendas y $8 por cada agenda más (las «Agendas contratadas»).
  for (const [agendas, fee] of [
    [3, 29.99],
    [4, 37.99],
    [5, 45.99],
  ] as const) {
    const r = await admin("PUT", `/admin/businesses/${DENTAL}/max-professionals`, { maxProfessionals: agendas });
    billing = await ficha(DENTAL);
    ok(
      r.status === 200 && billing.monthlyFee === fee && billing.planPrice === fee && billing.agendas === agendas,
      `Business con ${agendas} agendas: ${fee}`,
      billing,
    );
  }
  // Sin tope, las agendas activas. Con una sola incluida se ve en el monto: cada activa de más suma.
  await admin("PUT", `/admin/businesses/${DENTAL}/max-professionals`, { maxProfessionals: null });
  const active = count(`select count(*) from professionals where business_id = '${DENTAL}' and is_active`);
  await setPrices({ ...DEFAULT_PRICES, businessIncludedAgendas: 1 });
  billing = await ficha(DENTAL);
  ok(
    active >= 2 && billing.agendas === active && billing.monthlyFee === Math.round((29.99 + (active - 1) * 8) * 100) / 100,
    `sin tope, cuenta las agendas activas (${active})`,
    [active, billing],
  );
  const paused = sql(
    `update professionals set is_active = false where id = (select id from professionals where business_id = '${DENTAL}' and is_active order by sort_order desc limit 1) returning id`,
  ).split("\n")[0];
  billing = await ficha(DENTAL);
  ok(billing.agendas === active - 1 && billing.monthlyFee === Math.round((29.99 + (active - 2) * 8) * 100) / 100, "una agenda menos, $8 menos", billing);
  sql(`update professionals set is_active = true where id = '${paused}'`);
  await setPrices(DEFAULT_PRICES);
  await admin("PUT", `/admin/businesses/${DENTAL}/max-professionals`, { maxProfessionals: 3 });
}

/* ------------------------------------------- Los precios no salen para los negocios ---- */

console.log("Los precios de los planes nunca salen para los negocios");
{
  // Unos precios que no se confunden con otra cifra: el de Pro sólo lo puede ver el Centro (es su total) y el
  // de Business sólo la Clínica. Ninguno ve los de los demás, ni de dónde sale el suyo.
  await setPrices({ proPrice: 14.37, businessPrice: 29.73, businessIncludedAgendas: 3, businessExtraAgendaPrice: 8.61 });
  const KEYS = ["proPrice", "businessPrice", "businessIncludedAgendas", "businessExtraAgendaPrice", "planPrice", "customFee"];
  const paths = (id: string) => [
    "/auth/session",
    `/businesses/${id}`,
    `/businesses/${id}/subscription`,
    `/businesses/${id}/subscription/usage`,
    `/businesses/${id}/billing`,
    `/businesses/${id}/referrals`,
    `/businesses/${id}/notifications`,
  ];
  for (const [browser, id, others, label] of [
    [owner, CENTRO, ["29.73", "29,73", "8.61", "8,61"], "el propietario del Centro (Pro)"],
    [ricardo, DENTAL, ["14.37", "14,37", "8.61", "8,61"], "el de la Clínica (Business)"],
    [andrea, CENTRO, ["14.37", "14,37", "29.73", "29,73", "8.61", "8,61"], "una administradora"],
  ] as const) {
    const found: string[] = [];
    for (const path of paths(id)) {
      const text = JSON.stringify((await browser("GET", path)).body ?? "");
      found.push(...[...others, ...KEYS].filter((value) => text.includes(value)).map((value) => `${path}: ${value}`));
    }
    ok(found.length === 0, `${label}: ninguna de sus respuestas trae los precios de los planes`, found);
  }
  ok((await ownerBilling()).monthlyFee === 14.37, "el propietario del Centro sólo ve su total");
  ok(((await ricardo("GET", `/businesses/${DENTAL}/billing`)).body as BusinessBilling).monthlyFee === 29.73, "y el de la Clínica, el suyo");
  for (const path of ["/public/platform-settings", "/public/businesses/jhordan", "/public/businesses/dental-sonrisa"]) {
    const text = await (await fetch(`${BASE}${path}`)).text();
    ok(!["14.37", "29.73", "8.61", ...KEYS].some((value) => text.includes(value)), `${path} no los trae`, text.slice(0, 300));
  }
  await setPrices(DEFAULT_PRICES);
}

/* ------------------------------------------------------ El monto de cada cobro ---- */

console.log("El cobro lleva la mensualidad de ese momento");
{
  await admin("PUT", `/admin/businesses/${DENTAL}/max-professionals`, { maxProfessionals: 5 });
  // Su día de pago, hoy (las fechas se mueven con sql).
  sql(`update subscriptions set billing_day = ${Number(today().slice(8))}, billing_start = '${today()}' where business_id = '${DENTAL}'`);
  ok((await ensureAt(DENTAL, new Date().toISOString())) === 1, "llega su día de pago: se crea el cobro");
  ok(chargeOf(DENTAL, today()).endsWith(" 45.99 0.00 45.99 0 due"), "con el precio de su plan y sus agendas: Business con 5, $45,99", chargeOf(DENTAL, today()));
  await admin("PUT", `/admin/businesses/${DENTAL}/max-professionals`, { maxProfessionals: 3 });
  ok(chargeOf(DENTAL, today()).endsWith(" 45.99 0.00 45.99 0 due"), "bajar las agendas no cambia el cobro ya creado");
  ok((await ficha(DENTAL)).monthlyFee === 29.99, "el siguiente ya lleva $29,99");
  // La Clínica, de cortesía desde aquí: el resto de las pruebas no cuenta con sus cobros.
  sql(`delete from billing_charges where business_id = '${DENTAL}'`);
  sql(`update subscriptions set monthly_fee = 0 where business_id = '${DENTAL}'`);
}

/* ------------------------------------------------------- El día de pago automático ---- */

console.log("El día de pago automático: la lectura del propietario, el cron y la ficha");
{
  const tomas = await login("tomas@demo.com"); // Propietario de FisioActiva (plan Pro).
  const startedAt = (interval: string) => {
    sql(
      `update subscriptions set plan = 'pro', plan_since = now() - interval '${interval}', monthly_fee = null, billing_day = null, billing_start = null where business_id = '${FISIO}'`,
    );
    return planStartOf(FISIO);
  };
  const fisio = () => sql(`select billing_day || ' ' || billing_start from subscriptions where business_id = '${FISIO}'`);
  const schedules = audits("platform.billing_schedule_set");

  let started = startedAt("10 days");
  const state = (await tomas("GET", `/businesses/${FISIO}/billing`)).body as BusinessBilling;
  const monthLater = dayOfMonthISO(addMonthsISO(started, 1), Number(started.slice(8)));
  ok(
    state.monthlyFee === 14.99 && state.billingDay === Number(started.slice(8)) && state.nextDueDate === monthLater,
    "empezó hace 10 días: al entrar el propietario, paga el mismo día de cada mes desde que se cumple el mes",
    [started, state],
  );
  ok(audits("platform.billing_schedule_set") === schedules + 1, "queda en la actividad");

  // Los negocios que ya existían al publicarse: los pone el cron, en su pasada.
  started = startedAt("75 days");
  const run = await tasks.runMonthlyBilling();
  const expected = automatic(started);
  ok(run.schedules >= 1 && fisio() === `${expected.billingDay} ${expected.billingStart}`, "empezó hace 75 días: el cron le pone el mismo día", [started, fisio()]);
  ok(
    expected.billingStart >= addDaysISO(today(), 3) && count(`select count(*) from billing_charges where business_id = '${FISIO}'`) === 0,
    "y su primer cobro, el siguiente desde hoy: nunca uno ya pasado",
    expected,
  );
  ok((await tasks.runMonthlyBilling()).schedules === 0 && audits("platform.billing_schedule_set") === schedules + 2, "otra pasada no lo vuelve a poner");

  // Su día de pago cae mañana: el primer cobro, al mes siguiente, para que le llegue antes el aviso de tres días.
  const tomorrow = addDaysISO(today(), 1);
  const day = Number(tomorrow.slice(8));
  // El mismo día de un mes anterior que lo tenga (el 31 no está en todos).
  let months = 1;
  while (Number(dayOfMonthISO(addMonthsISO(tomorrow, -months), day).slice(8)) !== day) months++;
  const earlier = dayOfMonthISO(addMonthsISO(tomorrow, -months), day);
  sql(
    `update subscriptions set plan_since = ('${earlier} 12:00'::timestamp at time zone '${TZ}'), monthly_fee = null, billing_day = null, billing_start = null where business_id = '${FISIO}'`,
  );
  await tasks.runMonthlyBilling();
  const nextMonth = dayOfMonthISO(addMonthsISO(tomorrow, 1), day);
  ok(
    fisio() === `${day} ${nextMonth}` &&
      count(`select count(*) from notifications where dedupe_key = 'billing-reminder:${FISIO}:${tomorrow}'`) === 0,
    "empezó un día como mañana: su primer cobro no es mañana (sin aviso) sino el mes siguiente",
    [earlier, fisio()],
  );

  // En la ficha, sin día de pago ni primer cobro, la API los pone como el sistema.
  started = startedAt("10 days");
  const r = await admin("PUT", `/admin/businesses/${FISIO}/billing`, { customFee: null, billingDay: null, billingStart: null });
  ok(
    r.status === 200 && r.body.billingDay === Number(started.slice(8)) && r.body.billingStart === automatic(started).billingStart,
    "el super admin los deja vacíos: la API los pone desde el día en que empezó su plan",
    [started, r.body],
  );
}

/* ---------------------------------------------------- Al cambiar de plan ---- */

console.log("El día de pago al cambiar de plan");
{
  const NUTRI = idOf("nutrivida");
  const changePlan = (plan: string) => admin("PUT", `/admin/businesses/${NUTRI}/plan`, { plan });
  const now = today();
  const day = Number(now.slice(8));
  const monthLater = dayOfMonthISO(addMonthsISO(now, 1), day);
  let billing = await ficha(NUTRI);
  ok(billing.monthlyFee === 0 && billing.billingDay === null && billing.nextDueDate === null, "en Free: sin mensualidad ni día de pago", billing);

  let r = await changePlan("pro");
  billing = await ficha(NUTRI);
  ok(
    r.status === 200 && billing.monthlyFee === 14.99 && billing.billingDay === day && billing.billingStart === monthLater,
    "de Free a Pro: $14,99, el día del cambio de cada mes, desde que se cumple el mes",
    billing,
  );
  ok(lastAudit("platform.billing_schedule_set").includes("Puso la mensualidad automática de NutriVida"), "queda en la actividad", lastAudit("platform.billing_schedule_set"));

  // Un día de pago de antes (otro día y otra fecha), para ver qué se mantiene y qué se calcula de nuevo.
  const oldDay = day === 3 ? 4 : 3;
  const oldStart = dayOfMonthISO(addMonthsISO(now, 2), oldDay);
  sql(`update subscriptions set billing_day = ${oldDay}, billing_start = '${oldStart}' where business_id = '${NUTRI}'`);
  r = await changePlan("business");
  billing = await ficha(NUTRI);
  ok(
    r.status === 200 && billing.monthlyFee === 29.99 && billing.billingDay === oldDay && billing.billingStart === oldStart,
    "de Pro a Business: el precio del plan nuevo, y el día de pago se mantiene",
    billing,
  );
  r = await changePlan("free");
  billing = await ficha(NUTRI);
  ok(r.status === 200 && billing.monthlyFee === 0 && billing.nextDueDate === null, "a Free: sin cobros", billing);
  r = await changePlan("pro");
  billing = await ficha(NUTRI);
  ok(
    r.status === 200 && billing.billingDay === day && billing.billingStart === monthLater,
    "al volver de Free, el día de pago se calcula de nuevo desde ese cambio",
    billing,
  );
  await changePlan("free");
}

/* ------------------------------------------------------------ El precio especial ---- */

console.log("El precio especial");
{
  const auto = await ficha(CENTRO);
  const schedule = { billingDay: auto.billingDay, billingStart: auto.billingStart };
  const put = (input: unknown) => admin("PUT", `/admin/businesses/${CENTRO}/billing`, input);
  let r = await owner("PUT", `/admin/businesses/${CENTRO}/billing`, { customFee: 20, ...schedule });
  ok(r.status === 403, "sólo el super admin lo pone", r.status);
  const tomorrow = addDaysISO(today(), 1);
  const day = Number(tomorrow.slice(8));
  const yesterday = addDaysISO(today(), -1);
  for (const [input, pattern, label] of [
    [{ customFee: -1, ...schedule }, /negativo/, "un precio negativo"],
    [{ customFee: 9.999, ...schedule }, /dos decimales/, "más de dos decimales"],
    [{ customFee: "", ...schedule }, /precio especial/, "un precio vacío"],
    [{ customFee: null, billingDay: day, billingStart: null }, /primer cobro/, "un día de pago sin el primer cobro"],
    [{ customFee: null, billingDay: day === 28 ? 27 : 28, billingStart: tomorrow }, /tiene que caer en su día de pago/, "un primer cobro fuera del día de pago"],
    [{ customFee: null, billingDay: Number(yesterday.slice(8)), billingStart: yesterday }, /anterior a hoy/, "un primer cobro anterior a hoy"],
  ] as const) {
    r = await put(input);
    ok(r.status === 400 && pattern.test(r.body.error.message), `${label} → 400`, r.body);
  }
  ok(
    sql(`select coalesce(monthly_fee::text, 'null') || ' ' || billing_day || ' ' || billing_start from subscriptions where business_id = '${CENTRO}'`) ===
      `null ${auto.billingDay} ${auto.billingStart}`,
    "y no se guarda nada",
  );

  const before = audits("platform.billing_fee_changed");
  r = await put({ customFee: 20, ...schedule });
  ok(r.status === 200 && r.body.monthlyFee === 20 && r.body.customFee === 20 && r.body.planPrice === 14.99, "con precio especial, se cobra ése", r.body);
  ok(audits("platform.billing_fee_changed") === before + 1, "queda en la actividad");
  let audit = lastAudit("platform.billing_fee_changed");
  ok(
    audit.startsWith(`sin negocio | Admin`) &&
      audit.includes(`Puso a ${centroName} el precio especial de $20,00 | `) &&
      audit.includes('"before": "El de su plan"') &&
      audit.includes('"after": "$20,00"') &&
      !audit.includes("Día de pago"),
    "en la de la plataforma (sin el negocio: sus administradores no la ven), con lo que cambió",
    audit,
  );
  r = await put({ customFee: 20, ...schedule });
  ok(r.status === 200 && audits("platform.billing_fee_changed") === before + 1, "lo mismo otra vez no anota nada");
  ok((await ownerBilling()).monthlyFee === 20, "el propietario ve su total: $20,00");

  r = await put({ customFee: null, ...schedule });
  ok(r.status === 200 && r.body.monthlyFee === 14.99 && r.body.customFee === null, "«Quitar»: vuelve al precio de su plan", r.body);
  audit = lastAudit("platform.billing_fee_changed");
  ok(audit.includes(`Quitó el precio especial de ${centroName}: vuelve al de su plan (Pro, $14,99)`), "queda en la actividad", audit);

  r = await put({ customFee: 0, ...schedule });
  ok(r.status === 200 && r.body.monthlyFee === 0 && r.body.nextDueDate === null, "0: cortesía, sin cobros", r.body);
  ok(lastAudit("platform.billing_fee_changed").includes(`Puso a ${centroName} en cortesía: sin cobros`), "queda en la actividad", lastAudit("platform.billing_fee_changed"));
  let state = await ownerBilling();
  ok(state.monthlyFee === 0 && state.nextDueDate === null && state.billingDay === null, "el propietario ya no tiene mensualidad", state);
  sql(`update subscriptions set billing_day = ${Number(today().slice(8))}, billing_start = '${today()}' where business_id = '${CENTRO}'`);
  ok((await ensureAt(CENTRO, new Date().toISOString())) === 0, "aunque llegue su día de pago, no hay cobro");
  sql(`update subscriptions set billing_day = ${auto.billingDay}, billing_start = '${auto.billingStart}' where business_id = '${CENTRO}'`);

  // Lo que siguen las pruebas: $9,99 desde mañana.
  r = await put({ customFee: 9.99, billingDay: day, billingStart: tomorrow });
  ok(r.status === 200 && r.body.monthlyFee === 9.99 && r.body.billingDay === day && r.body.billingStart === tomorrow, "un precio especial con otro día de pago", r.body);
  ok(r.body.nextDueDate === tomorrow && r.body.openCharges === 0, "el próximo día de pago es el primer cobro", r.body);
  audit = lastAudit("platform.billing_fee_changed");
  ok(
    audit.includes(`Puso a ${centroName} el precio especial de $9,99; el ${day} de cada mes desde el `) && audit.includes('"label": "Primer cobro"'),
    "la actividad dice el precio y el día",
    audit,
  );
  const detail = (await admin("GET", `/admin/businesses/${CENTRO}`)).body as AdminBusinessDetail;
  ok(detail.billing?.monthlyFee === 9.99 && detail.billing.nextDueDate === tomorrow, "la ficha la muestra", detail.billing);
  ok(!("monthlyFee" in (detail.subscription ?? {})) && !("customFee" in (detail.subscription ?? {})), "y no va en la suscripción", detail.subscription);

  const subscription = await andrea("GET", `${B}/subscription`);
  ok(
    subscription.status === 200 && !JSON.stringify(subscription.body).includes("9.99") && !("monthlyFee" in subscription.body),
    "la suscripción que ve el equipo no trae la mensualidad",
    subscription.body,
  );

  state = await ownerBilling();
  ok(
    state.monthlyFee === 9.99 && state.billingDay === day && state.nextDueDate === tomorrow && state.pending === null && !state.blocked,
    "el propietario ve su mensualidad y su próximo pago, todavía sin cobro",
    state,
  );
  ok(state.bankAccounts.length === 2 && state.receiptsEnabled, "con las cuentas para transferir", state.bankAccounts);
  ok(
    Object.keys(state).sort().join(",") === "bankAccounts,billingDay,blocked,charges,monthlyFee,nextDueDate,pending,receiptsEnabled",
    "sólo lo suyo: nunca planes ni precios (ni días de gracia: no tiene)",
    Object.keys(state),
  );
}

/* ----------------------------------------------------------------- Quién ---- */

console.log("Quién ve la mensualidad");
{
  for (const [browser, label] of [
    [andrea, "un administrador"],
    [miguel, "Recepción"],
  ] as const) {
    const r = await browser("GET", `${B}/billing`);
    ok(r.status === 403, `${label} no la ve (403)`, r.status);
  }
  let r = await valeria("GET", `/businesses/${DENTAL}/billing`);
  ok(r.status === 403, "el rol Profesional, tampoco", r.status);
  r = await ricardo("GET", `${B}/billing`);
  ok(r.status === 403, "ni el propietario de otro negocio", r.status);
  r = await admin("GET", `${B}/billing`);
  ok(r.status === 200 && r.body.monthlyFee === 9.99, "el super admin en modo soporte la ve, como el propietario", r.status);
  ok(r.headers.get("cache-control") === "no-store", "sin caché", r.headers.get("cache-control"));
  r = await owner("GET", "/admin/billing");
  ok(r.status === 403, "un propietario no ve /admin → Cobros", r.status);
}

/* ------------------------------------------------------------ El recordatorio ---- */

console.log("El recordatorio de tres días antes");
{
  const before = emails("billing_reminder");
  const run = await tasks.runMonthlyBilling();
  ok(run.reminders >= 1 && emails("billing_reminder") === before + 1, "mañana es su día de pago: le llega el email", run);
  const email = lastEmail("billing_reminder");
  ok(
    email.startsWith("sin negocio | jhordan@demo.com | Tu mensualidad de Agenda360 vence el ") &&
      email.includes("$9,99") &&
      email.includes("2200123456") &&
      email.includes("1005566778"),
    "«Tu mensualidad de Agenda360 vence el…», con el monto y las cuentas, sin negocio (sólo lo ve el propietario)",
    email.slice(0, 400),
  );
  ok(
    email.includes("al entrar a tu panel, tendrás que subirlo para seguir usándolo") && !/días desde el día de pago|Más tarde/.test(email),
    "dice que ese día tendrá que subir el comprobante para seguir usando el panel (sin días de gracia)",
    email,
  );
  await tasks.runMonthlyBilling();
  ok(emails("billing_reminder") === before + 1, "una sola vez, aunque el cron pase otra vez");
  const outbox = await andrea("GET", `${B}/notifications`);
  ok(
    outbox.status === 403 || !(outbox.body as { type: string }[]).some((item) => item.type === "billing_reminder"),
    "la bandeja del negocio no se la muestra a un administrador",
    outbox.status,
  );
  const mine = await owner("GET", `${B}/notifications`);
  ok(mine.status === 200 && (mine.body as { type: string }[]).some((item) => item.type === "billing_reminder"), "al propietario, sí");
}

/* ------------------------------------------------- El estado del propietario ---- */

console.log("El día de pago y el bloqueo (sin gracia); «Por pagar» y «Atrasados» en /admin");
let chargeId = "";
{
  const day = Number(today().slice(8));
  let r = await admin("PUT", `/admin/businesses/${CENTRO}/billing`, { customFee: 9.99, billingDay: day, billingStart: today() });
  ok(r.status === 200, "el primer cobro pasa a hoy (hoy sí se puede)", r.body);
  let state = await ownerBilling();
  chargeId = state.pending?.id ?? "";
  ok(
    state.pending?.dueDate === today() && state.pending.amount === 9.99 && state.pending.status === "due" && state.blocked,
    "su día de pago: al entrar, el cobro del mes ya está (sin esperar al cron) y bloquea, sin «Más tarde» ni gracia",
    state,
  );
  ok(count(`select count(*) from billing_charges where business_id = '${CENTRO}'`) === 1, "un solo cobro");
  state = await ownerBilling();
  ok(count(`select count(*) from billing_charges where business_id = '${CENTRO}'`) === 1, "entrar otra vez no crea otro");
  ok(state.nextDueDate !== null && state.nextDueDate > today(), "y el próximo pago ya es el del mes siguiente", state.nextDueDate);

  /** El cobro (y con él el día de pago) pasa a ser de hace `days` días. */
  const moveDue = (days: number) => {
    const due = addDaysISO(today(), -days);
    sql(`update billing_charges set due_date = '${due}' where id = '${chargeId}'`);
    sql(`update subscriptions set billing_day = ${Number(due.slice(8))}, billing_start = '${due}' where business_id = '${CENTRO}'`);
  };
  /** Dónde lo ve el super admin en /admin → Cobros, con los días que le faltan para «Atrasados». */
  const inAdmin = async () => {
    const [due, overdue] = [await adminList("due"), await adminList("overdue")];
    const row = [...due.charges, ...overdue.charges].find((charge) => charge.id === chargeId);
    const where = due.charges.some((charge) => charge.id === chargeId) ? "due" : overdue.charges.some((charge) => charge.id === chargeId) ? "overdue" : "";
    return { where, overdueInDays: row?.overdueInDays, counts: due.counts, home: (await stats()).billing };
  };
  let seen = await inAdmin();
  ok(
    seen.where === "due" && seen.overdueInDays === 5 && seen.home?.overdue === 0,
    "el super admin lo ve en «Por pagar» (5 días para «Atrasados»), y el Inicio no cuenta atrasados",
    seen,
  );
  moveDue(4);
  state = await ownerBilling();
  ok(state.blocked && state.pending?.id === chargeId, "el quinto día: sigue bloqueado", state);
  seen = await inAdmin();
  ok(seen.where === "due" && seen.overdueInDays === 1 && seen.home?.overdue === 0, "en /admin, todavía «Por pagar» (pasa a «Atrasados» mañana)", seen);
  moveDue(5);
  state = await ownerBilling();
  ok(state.blocked && state.pending?.id === chargeId, "el sexto día, igual: bloqueado", state);
  ok(count(`select count(*) from billing_charges where business_id = '${CENTRO}'`) === 1, "y sigue siendo un solo cobro");
  seen = await inAdmin();
  ok(seen.where === "overdue" && seen.overdueInDays === 0 && seen.counts.overdue >= 1, "a los 5 días, en «Atrasados» (y ya no en «Por pagar»)", seen);
  ok(seen.home?.overdue === 1, "el Inicio de /admin cuenta 1 atrasado", seen.home);

  // CE-003: sólo la pantalla del propietario se bloquea; la API, su equipo y su página de reservas siguen.
  r = await andrea("GET", `${B}/clients`);
  ok(r.status === 200, "su equipo sigue trabajando", r.status);
  r = await owner("GET", `${B}/appointments?from=${today()}&to=${today()}`);
  ok(r.status === 200, "y la API no le bloquea nada al propietario", r.status);
  const page = await fetch(`${BASE}/public/businesses/jhordan`);
  ok(page.status === 200, "su página de reservas sigue abierta", page.status);
}

/* ------------------------------------------------------------ El comprobante ---- */

console.log("El comprobante");
let firstReceipt = "";
{
  const R = `${B}/billing/charges/${chargeId}/receipt`;
  let r = await owner("POST", R, { ...receiptInput, contentType: "text/html" });
  ok(r.status === 400, "un tipo que no es foto ni PDF → 400", r.body);
  r = await owner("POST", R, { ...receiptInput, sizeBytes: 11 * 1024 * 1024 });
  ok(r.status === 400 && /10 MB/.test(r.body.error.message), "más de 10 MB → 400", r.body);
  r = await admin("POST", R, receiptInput);
  ok(r.status === 403 && /lo sube el propietario/.test(r.body.error.message), "el super admin en modo soporte no lo sube", r.body);
  r = await andrea("POST", R, receiptInput);
  ok(r.status === 403, "un administrador, tampoco", r.status);
  r = await ricardo("POST", `/businesses/${DENTAL}/billing/charges/${chargeId}/receipt`, receiptInput);
  ok(r.status === 404, "el cobro de otro negocio no existe para él", r.status);

  r = await owner("POST", R, receiptInput);
  ok(r.status === 200 && r.body.upload.method === "PUT", "pide la URL de subida", r.body);
  const pending = r.body;
  firstReceipt = pending.receipt.id;
  r = await owner("POST", `${R}/${pending.receipt.id}/complete`);
  ok(r.status === 409, "completar sin haber subido → 409", r.body);
  ok((await put(pending.upload, PNG)).ok, "el navegador sube el archivo");
  const uploads = audits("platform.billing_receipt_uploaded");
  r = await owner("POST", `${R}/${pending.receipt.id}/complete`);
  ok(r.status === 200 && r.body.status === "in_review" && r.body.receipt?.fileName === "transferencia.png", "el cobro pasa a «En revisión»", r.body);
  const storagePath = sql(`select storage_path from billing_receipts where id = '${pending.receipt.id}'`);
  ok(
    storagePath.startsWith(`${CENTRO}/mensualidades/${chargeId}/`) && !storagePath.includes("transferencia") &&
      existsSync(join(process.env.LOCAL_STORAGE_DIR!, "comprobantes", storagePath)),
    "el archivo va al bucket privado de comprobantes, en la carpeta del negocio (se borra con él)",
    storagePath,
  );
  ok(audits("platform.billing_receipt_uploaded") === uploads + 1, "la subida queda en la actividad");
  const audit = lastAudit("platform.billing_receipt_uploaded");
  ok(
    audit.startsWith("sin negocio | Jhordan Huera | Subió el comprobante de la mensualidad de ") && audit.includes(`de ${centroName} ($9,99)`),
    "con el propietario como autor, en la de la plataforma",
    audit,
  );

  const state = await ownerBilling();
  ok(state.pending === null && !state.blocked && state.charges[0]?.status === "in_review", "ya puede usar el sistema: no queda nada pendiente", state);
  const bell = (await admin("GET", "/admin/notices")).body as PanelNoticePage;
  const notice = bell.notices.find((item) => item.kind === "billing_receipt");
  ok(
    notice?.title === "Comprobante de mensualidad" && notice.body.startsWith(`${centroName} · $9,99 · mensualidad de `) && notice.url === "/admin/billing",
    "al super admin le llega a su campana",
    notice,
  );
  ok(
    count(`select count(*) from panel_notices where kind = 'billing_receipt' and business_id is null`) === 1,
    "un aviso de la plataforma, sin negocio",
  );
  const ownerBell = (await owner("GET", `${B}/notices`)).body as PanelNoticePage;
  ok(!ownerBell.notices.some((item) => item.kind === "billing_receipt"), "el negocio no lo ve en su campana");
  ok((await stats()).billing?.inReview === 1, "el Inicio de /admin cuenta 1 comprobante por revisar");
  const list = await adminList("in_review");
  ok(list.charges.length === 1 && list.charges[0].id === chargeId && list.charges[0].business.name === centroName, "y está en «En revisión»", list);

  r = await owner("GET", R);
  let file = await fetch(ORIGIN + r.body.url);
  ok(r.status === 200 && file.ok && Buffer.from(await file.arrayBuffer()).equals(PNG), "el propietario abre su comprobante (URL firmada)", r.status);
  r = await andrea("GET", R);
  ok(r.status === 403, "su administrador, no", r.status);
  r = await admin("GET", `/admin/billing/charges/${chargeId}/receipt`);
  file = await fetch(ORIGIN + r.body.url);
  ok(r.status === 200 && file.ok, "el super admin, sí", r.status);
  r = await owner("POST", R, receiptInput);
  ok(r.status === 409 && /Ya enviaste el comprobante/.test(r.body.error.message), "otro comprobante del mismo cobro → 409", r.body);
}

/* --------------------------------------------------------------- Rechazar ---- */

console.log("Rechazar");
{
  let r = await owner("POST", `/admin/billing/charges/${chargeId}/reject`, { reason: "No llegó la transferencia" });
  ok(r.status === 403, "sólo el super admin", r.status);
  r = await admin("POST", `/admin/billing/charges/${chargeId}/reject`, { reason: "" });
  ok(r.status === 400, "sin motivo → 400", r.body);
  const before = emails("billing_rejected");
  r = await admin("POST", `/admin/billing/charges/${chargeId}/reject`, { reason: "No llegó la transferencia" });
  ok(r.status === 204, "rechaza con un motivo", r.body);
  ok(
    sql(`select status || ' | ' || rejection_reason || ' | ' || (reviewed_by is not null) from billing_charges where id = '${chargeId}'`) ===
      "rejected | No llegó la transferencia | true",
    "queda rechazado, con el motivo y quién lo hizo",
  );
  ok(emails("billing_rejected") === before + 1, "al propietario le llega un email");
  const email = lastEmail("billing_rejected");
  ok(
    email.startsWith("sin negocio | jhordan@demo.com | No pudimos confirmar el pago de tu mensualidad de ") && email.includes("No llegó la transferencia"),
    "con el motivo",
    email.slice(0, 300),
  );
  ok(
    email.includes("al entrar a tu panel, tendrás que volver a subir el comprobante para seguir usándolo") && !/te quedan? \d+ d[ií]as?|Más tarde/.test(email),
    "y que al entrar tendrá que volver a subirlo (sin días de gracia)",
    email,
  );
  const audit = lastAudit("platform.billing_charge_rejected");
  ok(audit.startsWith("sin negocio | Admin") && audit.includes("No llegó la transferencia"), "queda en la actividad, con quién lo hizo", audit);
  const state = await ownerBilling();
  ok(
    state.pending?.id === chargeId && state.pending.status === "rejected" && state.pending.rejectionReason === "No llegó la transferencia" && state.blocked,
    "al entrar, se le vuelve a abrir la pantalla, con el motivo, y no se cierra hasta subir otro",
    state,
  );
  r = await admin("POST", `/admin/billing/charges/${chargeId}/reject`, { reason: "Otra vez" });
  ok(r.status === 409, "rechazar uno que ya no está en revisión → 409", r.body);
  r = await admin("POST", `/admin/billing/charges/${chargeId}/approve`);
  ok(r.status === 409, "ni aprobarlo sin comprobante nuevo", r.body);

  // Vuelve a subirlo: otra vez en revisión.
  const R = `${B}/billing/charges/${chargeId}/receipt`;
  const pending = (await owner("POST", R, receiptInput)).body;
  await put(pending.upload, PNG);
  r = await owner("POST", `${R}/${pending.receipt.id}/complete`);
  ok(r.status === 200 && r.body.status === "in_review" && r.body.receipt?.id === pending.receipt.id, "sube otro comprobante: en revisión", r.body);
  const list = await adminList("in_review");
  ok(list.charges[0]?.rejectionReason === "No llegó la transferencia", "el super admin ve el motivo del rechazo anterior", list.charges[0]);
}

/* ---------------------------------------------------------------- Aprobar ---- */

console.log("Aprobar");
{
  let r = await owner("POST", `/admin/billing/charges/${chargeId}/approve`);
  ok(r.status === 403, "sólo el super admin", r.status);
  const before = emails("billing_paid");
  r = await admin("POST", `/admin/billing/charges/${chargeId}/approve`);
  ok(r.status === 204, "«Pagado»", r.body);
  ok(
    sql(`select status || ' ' || paid_method || ' ' || (paid_at is not null) from billing_charges where id = '${chargeId}'`) === "paid transfer true",
    "queda pagado por transferencia",
  );
  ok(emails("billing_paid") === before + 1 && lastEmail("billing_paid").includes("Recibimos tu pago, gracias"), "«Recibimos tu pago, gracias»", lastEmail("billing_paid").slice(0, 200));
  ok(lastAudit("platform.billing_charge_paid").includes(`Confirmó el pago de la mensualidad de`), "queda en la actividad", lastAudit("platform.billing_charge_paid"));
  r = await admin("POST", `/admin/billing/charges/${chargeId}/approve`);
  ok(r.status === 409, "otra vez → 409", r.body);
  const state = await ownerBilling();
  ok(state.pending === null && !state.blocked && state.charges[0]?.status === "paid", "su historial: «Pagado»", state.charges[0]);
  ok((await stats()).billing?.inReview === 0 && (await stats()).billing?.overdue === 0, "el Inicio ya no cuenta nada");
}

/* -------------------------------------------- Pagado sin comprobante y anular ---- */

console.log("Pagado sin comprobante y anular");
{
  // Dos meses sin pagar: cada uno aparte, y la pantalla muestra el más antiguo.
  const older = addDaysISO(today(), -70);
  const newer = addDaysISO(today(), -40);
  const insert = (due: string) =>
    sql(`insert into billing_charges (business_id, due_date, base_amount, amount) values ('${CENTRO}', '${due}', 9.99, 9.99) returning id`).split("\n")[0];
  const olderId = insert(older);
  const newerId = insert(newer);
  let state = await ownerBilling();
  ok(state.pending?.id === olderId && state.blocked, "varios meses sin pagar: la pantalla muestra el más antiguo", state.pending);

  let r = await admin("POST", `/admin/billing/charges/${olderId}/mark-paid`, { note: "Efectivo en la oficina" });
  ok(r.status === 204, "«Pagado sin comprobante»", r.body);
  ok(
    sql(`select status || ' | ' || paid_method || ' | ' || paid_note from billing_charges where id = '${olderId}'`) === "paid | other | Efectivo en la oficina",
    "pagado por otra vía, con su nota",
  );
  ok(lastEmail("billing_paid").includes("Recibimos tu pago, gracias"), "al propietario le llega «Recibimos tu pago»");
  ok(lastAudit("platform.billing_charge_paid_other").includes("Efectivo en la oficina"), "queda en la actividad", lastAudit("platform.billing_charge_paid_other"));
  state = await ownerBilling();
  ok(state.pending?.id === newerId, "ahora el pendiente es el siguiente mes", state.pending);
  ok(!JSON.stringify(state).includes("Efectivo en la oficina"), "la nota sólo la ve el super admin");

  r = await admin("POST", `/admin/billing/charges/${newerId}/void`, {});
  ok(r.status === 400, "anular sin motivo → 400", r.body);
  const before = emails("billing_voided");
  r = await admin("POST", `/admin/billing/charges/${newerId}/void`, { reason: "Pasó al plan gratis" });
  ok(r.status === 204, "«Anular», con el motivo", r.body);
  ok(sql(`select status || ' | ' || void_reason from billing_charges where id = '${newerId}'`) === "void | Pasó al plan gratis", "queda anulado, con el motivo");
  ok(emails("billing_voided") === before + 1 && lastEmail("billing_voided").includes("Pasó al plan gratis"), "al propietario le llega un email", lastEmail("billing_voided").slice(0, 200));
  ok(lastAudit("platform.billing_charge_voided").includes("Pasó al plan gratis"), "queda en la actividad");
  r = await admin("POST", `/admin/billing/charges/${newerId}/void`, { reason: "Otra vez" });
  ok(r.status === 409, "anular uno anulado → 409", r.body);
  r = await admin("POST", `/admin/billing/charges/${newerId}/mark-paid`, {});
  ok(r.status === 409, "ni marcarlo pagado", r.body);
  r = await admin("POST", `/admin/billing/charges/${chargeId}/void`, { reason: "Ya pagó" });
  ok(r.status === 409, "un cobro pagado no se anula", r.body);
  r = await admin("POST", `/admin/billing/charges/no-es-un-id/void`, { reason: "Nada" });
  ok(r.status === 404, "un cobro que no existe → 404", r.status);

  state = await ownerBilling();
  ok(state.pending === null && !state.blocked, "sin pendientes, el panel queda libre", state);
  const voided = state.charges.find((charge) => charge.id === newerId);
  ok(voided?.status === "void" && voided.voidReason === "Pasó al plan gratis", "y su historial dice «Anulado» con el motivo", voided);

  const paid = await adminList("paid");
  ok(paid.charges.some((charge) => charge.id === olderId && charge.paidNote === "Efectivo en la oficina" && charge.reviewedByName), "«Pagados», con la nota y quién", paid.charges[0]);
  ok((await adminList("void")).charges.some((charge) => charge.id === newerId), "«Anulados»");
  r = await admin("GET", "/admin/billing?status=otro");
  ok(r.status === 400, "un filtro que no existe → 400", r.status);
}

/* --------------------------------------------------- El cron: ntfy y el registro ---- */

console.log("El cron");
{
  const ntfy = await fakeNtfy();
  const run = await runCron(ntfy.url);
  ntfy.close();
  ok(run.code === 0, "la pasada del cron termina bien", run.output.slice(-500));
  ok(/mensualidades: cobros \d+ · recordatorios \d+ · comprobantes 2 \(borrados, más de 12 meses: \d+\)/.test(run.output), "el registro trae las cifras de las mensualidades", run.output.match(/mensualidades[^·]*·[^·]*·[^)]*\)/)?.[0]);
  const notices = ntfy.received.filter((notice) => notice.title === "Agenda360: comprobante de mensualidad");
  ok(notices.length === 2 && notices[0].message.startsWith(`${centroName}\n`) && notices[0].message.includes("$9,99"), "un ntfy por comprobante, con el negocio en la primera línea y el monto", ntfy.received.map((n) => n.title));
  ok(!run.output.includes(centroName), "el registro público del cron no nombra al negocio");
}

/* -------------------------------------------- El cobro de cada mes (con `at`) ---- */

console.log("El cobro de cada mes");
{
  // El Centro, sin mensualidad: lo que sigue mueve el reloj a 2030 y no debe crearle cobros.
  sql(`update subscriptions set monthly_fee = 0 where business_id = '${CENTRO}'`);
  sql(`update subscriptions set plan = 'pro', monthly_fee = 9.99, billing_day = 31, billing_start = '2030-10-31' where business_id = '${FISIO}'`);
  ok((await ensureAt(FISIO, "2030-10-30T17:00:00Z")) === 0, "antes del primer cobro, nada");
  ok((await ensureAt(FISIO, "2030-10-31T17:00:00Z")) === 1 && chargeOf(FISIO, "2030-10-31").endsWith(" 9.99 0.00 9.99 0 due"), "el primer cobro, en su día de pago", chargeOf(FISIO, "2030-10-31"));
  ok((await ensureAt(FISIO, "2030-11-29T17:00:00Z")) === 0, "el 29 de noviembre, todavía no");
  // 23:00 del 29 en Ecuador (04:00 del 30 en UTC): su día de pago se cuenta en la zona del negocio.
  ok((await ensureAt(FISIO, "2030-11-30T04:00:00Z")) === 0, "a las 23:00 del 29 en Ecuador, tampoco (aunque en UTC ya sea el 30)");
  ok((await ensureAt(FISIO, "2030-11-30T05:30:00Z")) === 1 && chargeOf(FISIO, "2030-11-30") !== "", "el 31 cae el 30 en noviembre");
  const run1 = await tasks.runMonthlyBilling(new Date("2030-11-30T18:00:00Z"));
  const run2 = await tasks.runMonthlyBilling(new Date("2030-11-30T19:00:00Z"));
  ok(run1.charges === 0 && run2.charges === 0 && count(`select count(*) from billing_charges where business_id = '${FISIO}' and due_date = '2030-11-30'`) === 1, "una sola vez aunque el cron pase varias veces", [run1, run2]);

  sql(`update businesses set status = 'suspended' where id = '${FISIO}'`);
  ok((await ensureAt(FISIO, "2030-12-31T17:00:00Z")) === 0, "suspendido, no genera cobros");
  sql(`update businesses set status = 'active' where id = '${FISIO}'`);
  ok((await ensureAt(FISIO, "2031-01-06T17:00:00Z")) === 0, "reactivado a los 6 días del día de pago, ese mes no se cobra después");
  sql(`update subscriptions set monthly_fee = 0 where business_id = '${FISIO}'`);
  ok((await ensureAt(FISIO, "2031-01-31T17:00:00Z")) === 0, "con mensualidad 0, nada");
  sql(`update subscriptions set monthly_fee = 9.99, plan = 'free' where business_id = '${FISIO}'`);
  ok((await ensureAt(FISIO, "2031-01-31T17:00:00Z")) === 0, "en el plan gratis, nada");
  sql(`update subscriptions set plan = 'pro' where business_id = '${FISIO}'`);
  const fisioOwner = sql(`select owner_id from businesses where id = '${FISIO}'`);
  sql(`update businesses set owner_id = null where id = '${FISIO}'`);
  ok((await ensureAt(FISIO, "2031-01-31T17:00:00Z")) === 0, "sin propietario, nada");
  sql(`update businesses set owner_id = '${fisioOwner}' where id = '${FISIO}'`);
}

/* ----------------------------------------------------- El descuento de referidos ---- */

console.log("El descuento de referidos");
{
  let created = 0;
  const referred = async () => {
    created++;
    const r = await admin("POST", "/admin/businesses", businessInput({ name: `Recomendado Cobro ${created}`, slug: `recomendado-cobro-${created}`, referredBy: FISIO }));
    sql(`update businesses set created_at = now() - interval '40 days' where id = '${r.body.business.id}'`);
    return r.body.business.id as string;
  };
  const [first, second] = [await referred(), await referred()];
  const rewards = async () => ((await admin("GET", "/admin/referral-rewards")).body as ReferralReward[]).filter((reward) => reward.referrer.id === FISIO);
  ok((await rewards()).length === 2, "dos recomendaciones ganadas, todavía libres");

  ok((await ensureAt(FISIO, "2031-01-31T17:00:00Z")) === 1, "el cobro de enero");
  const january = chargeOf(FISIO, "2031-01-31").split(" ");
  ok(january.slice(1).join(" ") === "9.99 3.00 6.99 2 due", "con dos recomendaciones: $9,99 − $3,00 = $6,99", january);
  ok((await rewards()).length === 0, "ya no salen en «Descuentos por referidos»: van en el cobro");
  let r = await admin("POST", `/admin/referral-rewards/${first}/apply`);
  ok(r.status === 409 && /ya va en un cobro/.test(r.body.error.message), "ni se marcan a mano", r.body);

  ok((await ensureAt(FISIO, "2031-02-28T17:00:00Z")) === 1 && chargeOf(FISIO, "2031-02-28").endsWith(" 9.99 0.00 9.99 0 due"), "el de febrero no las reusa", chargeOf(FISIO, "2031-02-28"));

  sql(`update billing_charges set status = 'in_review' where id = '${january[0]}'`);
  r = await admin("POST", `/admin/billing/charges/${january[0]}/approve`);
  ok(r.status === 204, "se aprueba el de enero");
  ok(
    count(`select count(*) from businesses where id in ('${first}', '${second}') and referral_reward_applied_at is not null`) === 2,
    "y sus dos recomendaciones quedan aplicadas",
  );

  // Anular un cobro libera sus recomendaciones para el siguiente.
  const third = await referred();
  ok((await ensureAt(FISIO, "2031-03-31T17:00:00Z")) === 1 && chargeOf(FISIO, "2031-03-31").includes(" 9.99 1.50 8.49 1 due"), "marzo, con la tercera: $8,49", chargeOf(FISIO, "2031-03-31"));
  r = await admin("POST", `/admin/billing/charges/${chargeOf(FISIO, "2031-03-31").split(" ")[0]}/void`, { reason: "Error en el monto" });
  ok(r.status === 204 && (await rewards()).some((reward) => reward.business.id === third), "al anularlo, la recomendación vuelve a quedar libre");
  ok((await ensureAt(FISIO, "2031-04-30T17:00:00Z")) === 1 && chargeOf(FISIO, "2031-04-30").includes(" 1.50 8.49 1 due"), "y la usa el cobro siguiente", chargeOf(FISIO, "2031-04-30"));

  // El descuento no pasa de la mensualidad: si la cubre, el cobro nace pagado y quedan aplicadas.
  sql(`update subscriptions set monthly_fee = 2 where business_id = '${FISIO}'`);
  ok(chargeOf(FISIO, "2031-04-30").includes(" 9.99 1.50 8.49 "), "cambiar la mensualidad no cambia los cobros ya creados");
  const [fourth, fifth] = [await referred(), await referred()];
  ok((await ensureAt(FISIO, "2031-05-31T17:00:00Z")) === 1, "el cobro de mayo");
  ok(chargeOf(FISIO, "2031-05-31").endsWith(" 2.00 2.00 0.00 2 paid"), "con $2 de mensualidad y dos recomendaciones: $0, ya pagado", chargeOf(FISIO, "2031-05-31"));
  ok(count(`select count(*) from businesses where id in ('${fourth}', '${fifth}') and referral_reward_applied_at is not null`) === 2, "y las dos quedan aplicadas");
  sql(`update subscriptions set monthly_fee = 9.99 where business_id = '${FISIO}'`);
}

/* ------------------------------------------- El recordatorio (con `at`) ---- */

console.log("El recordatorio, tres días antes y una sola vez");
{
  const key = `billing-reminder:${FISIO}:2031-06-30`;
  ok((await reminderAt(FISIO, "2031-06-26T17:00:00Z")) === 0, "a cuatro días, todavía no");
  ok((await reminderAt(FISIO, "2031-06-27T17:00:00Z")) === 1, "a tres días, sí");
  ok((await reminderAt(FISIO, "2031-06-27T18:00:00Z")) === 0 && (await reminderAt(FISIO, "2031-06-28T17:00:00Z")) === 0, "una sola vez");
  const email = sql(`select coalesce(business_id::text, 'sin negocio') || ' | ' || to_email || ' | ' || subject from notifications where dedupe_key = '${key}'`);
  ok(email === "sin negocio | tomas@demo.com | Tu mensualidad de Agenda360 vence el 30 de junio", "al propietario, con su día de pago (el 31 cae el 30)", email);
}

/* ------------------------------------- Los precios del plan en los cobros (con `at`) ---- */

console.log("Los precios de los planes en los cobros: desde el siguiente");
{
  sql(`update subscriptions set plan = 'pro', monthly_fee = null, max_professionals = null, billing_day = 15, billing_start = '2032-01-15' where business_id = '${FISIO}'`);
  ok(
    (await ensureAt(FISIO, "2032-01-15T17:00:00Z")) === 1 && chargeOf(FISIO, "2032-01-15").endsWith(" 14.99 0.00 14.99 0 due"),
    "sin precio especial, el cobro lleva el de su plan: Pro, $14,99",
    chargeOf(FISIO, "2032-01-15"),
  );
  await setPrices({ ...DEFAULT_PRICES, proPrice: 15.99 });
  ok(chargeOf(FISIO, "2032-01-15").endsWith(" 14.99 0.00 14.99 0 due"), "cambiar el precio de Pro no cambia el cobro ya creado");
  ok(
    (await ensureAt(FISIO, "2032-02-15T17:00:00Z")) === 1 && chargeOf(FISIO, "2032-02-15").endsWith(" 15.99 0.00 15.99 0 due"),
    "el siguiente ya lleva el precio nuevo",
    chargeOf(FISIO, "2032-02-15"),
  );
  sql(`update subscriptions set plan = 'business', max_professionals = 5 where business_id = '${FISIO}'`);
  ok(
    (await ensureAt(FISIO, "2032-03-15T17:00:00Z")) === 1 && chargeOf(FISIO, "2032-03-15").endsWith(" 45.99 0.00 45.99 0 due"),
    "pasa a Business con 5 agendas: el siguiente, $45,99",
    chargeOf(FISIO, "2032-03-15"),
  );

  // Los referidos restan del precio del plan, como de cualquier mensualidad.
  const r = await admin("POST", "/admin/businesses", businessInput({ name: "Recomendado Precio", slug: "recomendado-precio", referredBy: FISIO }));
  sql(`update businesses set created_at = now() - interval '40 days' where id = '${r.body.business.id}'`);
  ok(
    (await ensureAt(FISIO, "2032-04-15T17:00:00Z")) === 1 && chargeOf(FISIO, "2032-04-15").endsWith(" 45.99 1.50 44.49 1 due"),
    "con una recomendación ganada: $45,99 − $1,50 = $44,49",
    chargeOf(FISIO, "2032-04-15"),
  );
  sql(`update subscriptions set plan = 'free' where business_id = '${FISIO}'`);
  ok((await ensureAt(FISIO, "2032-05-15T17:00:00Z")) === 0, "en Free, no hay más cobros");
  await setPrices(DEFAULT_PRICES);
}

/* ------------------------------------------------------------------ La purga ---- */

console.log("La purga de los comprobantes de más de 12 meses");
{
  const paths = sql(`select storage_path from billing_receipts where charge_id = '${chargeId}' order by created_at`).split("\n");
  ok(paths.length === 2, "el cobro del Centro tiene sus dos comprobantes", paths);
  sql(`update billing_receipts set created_at = now() - interval '13 months' where id = '${firstReceipt}'`);
  const purged = await billing.purgeOldBillingReceipts();
  ok(purged === 1, "el cron borra el de hace 13 meses (y sólo ése)", purged);
  ok(!existsSync(join(process.env.LOCAL_STORAGE_DIR!, "comprobantes", paths[0])), "su archivo ya no existe");
  ok(count(`select count(*) from billing_receipts where id = '${firstReceipt}'`) === 0, "ni su registro");
  ok(existsSync(join(process.env.LOCAL_STORAGE_DIR!, "comprobantes", paths[1])), "el reciente se conserva");
  ok(sql(`select status from billing_charges where id = '${chargeId}'`) === "paid", "y el cobro queda como historial");
}

/* ------------------------------------------------------------- La campana ---- */

console.log("La campana de /admin acepta el aviso nuevo");
{
  const rejects = (query: string) => {
    try {
      sql(query);
      return false;
    } catch {
      return true;
    }
  };
  ok(
    rejects(`insert into panel_notices (business_id, kind, title, body, url) values ('${CENTRO}', 'billing_receipt', 'a', 'b', '/admin')`) &&
      rejects(`insert into panel_notices (kind) values ('billing_receipt')`),
    "billing_receipt es de la plataforma: sin negocio y con su texto",
  );
}

await pool.end();
done("del cobro de las mensualidades");
