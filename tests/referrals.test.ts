// El programa de referidos (spec 023): el código de cada negocio (también los que ya existían, con la
// migración 046), la tarjeta del propietario (los demás roles, 403), «Recomendado por» en el alta y en la
// ficha de /admin (con su actividad; nunca él mismo), el descuento de $1,50 (no antes de 30 días ni
// suspendido, sí a los 30 días activo, se suman, «Marcar como aplicado» lo saca de pendientes, queda en la
// actividad y nunca se repite) y la ruta pública, que sólo da el nombre de un negocio activo.
import { execFileSync } from "node:child_process";
import { businessInput } from "./helpers/business.mjs";
import { checks, count, login, sql } from "./helpers/harness.ts";
import type { AdminBusinessDetail, AdminBusinessSummary, BusinessReferrals, ReferralReward } from "../src/shared/types/index.ts";

const { ok, done } = checks();

const CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const MIGRATION = new URL("../db/migrations/046_referrals.sql", import.meta.url).pathname;

const admin = await login("admin@demo.com");
const owner = await login("jhordan@demo.com"); // Propietario de «Centro Profesional».
const ricardo = await login("ricardo@demo.com"); // Propietario de «Clínica Dental Sonrisa».

const idOf = (slug: string) => sql(`select id from businesses where slug = '${slug}'`);
const codeOf = (businessId: string) => sql(`select referral_code from businesses where id = '${businessId}'`);
const CENTRO = idOf("jhordan");
const DENTAL = idOf("dental-sonrisa");
const SUSPENDED = idOf("carolina-vega");
const centroName = sql(`select name from businesses where id = '${CENTRO}'`);
const dentalName = sql(`select name from businesses where id = '${DENTAL}'`);

/** Lo que devuelve psql al correr `script` (con la migración incluida, si la pide con \i). */
const psql = (script: string) =>
  execFileSync("psql", [process.env.TEST_DATABASE_URL!, "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: script,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();

/** Un negocio nuevo desde /admin (con «Recomendado por», si se da). */
let created = 0;
async function createBusiness(referredBy?: string | null) {
  created++;
  return admin(
    "POST",
    "/admin/businesses",
    businessInput({ name: `Referido Prueba ${created}`, slug: `referido-prueba-${created}`, ...(referredBy === undefined ? {} : { referredBy }) }),
  );
}
const ageDays = (businessId: string, days: number) =>
  sql(`update businesses set created_at = now() - interval '${days} days' where id = '${businessId}'`);
const rewards = async () => (await admin("GET", "/admin/referral-rewards")).body as ReferralReward[];
const pendingFor = async (businessId: string) => (await rewards()).filter((reward) => reward.business.id === businessId);
const lastAudit = (action: string) =>
  sql(`select coalesce(business_id::text, 'sin negocio') || ' | ' || summary || ' | ' || coalesce(changes::text, '')
         from audit_logs where action = '${action}' order by created_at desc, id desc limit 1`);

/* ---------------------------------------------------------------- Códigos ---- */

console.log("Códigos");
{
  const total = count("select count(*) from businesses");
  ok(total > 0 && count("select count(distinct referral_code) from businesses") === total, "cada negocio demo tiene un código distinto", total);
  ok(count(`select count(*) from businesses where referral_code !~ '^[A-HJ-NP-Z2-9]{6}$'`) === 0, "6 caracteres, sin I, O, 0 ni 1");

  // La migración sobre negocios que ya existían: se quitan sus columnas y se vuelve a correr la 046 en
  // una transacción que se deshace al final.
  const migrated = psql(`begin;
alter table businesses drop column referral_code, drop column referred_by, drop column referral_reward_applied_at;
drop function new_referral_code();
\\i ${MIGRATION}
select count(*) || ' ' || count(distinct referral_code) || ' ' || bool_and(referral_code ~ '^[A-HJ-NP-Z2-9]{6}$') from businesses;
rollback;`);
  ok(migrated === `${total} ${total} true`, "la 046 da un código distinto y válido a cada negocio que ya existía", migrated);

  const r = await createBusiness();
  ok(r.status === 200 && CODE.test(codeOf(r.body.business.id)), "un negocio nuevo nace con su código", r.body);
  ok(sql(`select referred_by is null from businesses where id = '${r.body.business.id}'`) === "t", "sin «Recomendado por», nadie");
}

/* -------------------------------------------------------------- La tarjeta ---- */

console.log("La tarjeta del propietario");
{
  const r = await owner("GET", `/businesses/${CENTRO}/referrals`);
  const card = r.body as BusinessReferrals;
  ok(r.status === 200 && card.code === codeOf(CENTRO), "el propietario ve su código", r.body);
  ok(card.link?.endsWith(`/?ref=${card.code}`), "y su enlace a la portada con ?ref=", card.link);
  ok(card.referred === 0 && card.qualified === 0, "todavía sin recomendados", card);
  ok(Object.keys(card).sort().join(",") === "code,link,qualified,referred", "sólo código, enlace y cifras", Object.keys(card));

  for (const [email, label] of [
    ["andrea@demo.com", "un administrador"],
    ["miguel@demo.com", "Recepción"],
  ] as const) {
    const member = await login(email);
    const denied = await member("GET", `/businesses/${CENTRO}/referrals`);
    ok(denied.status === 403, `${label} recibe 403`, denied.status);
  }
  const valeria = await login("valeria@demo.com");
  const professional = await valeria("GET", `/businesses/${DENTAL}/referrals`);
  ok(professional.status === 403, "el rol Profesional recibe 403", professional.status);
  const other = await ricardo("GET", `/businesses/${CENTRO}/referrals`);
  ok(other.status === 403, "el propietario de otro negocio, también", other.status);
  const support = await admin("GET", `/businesses/${CENTRO}/referrals`);
  ok(support.status === 200 && support.body.code === card.code, "el super admin en modo soporte la ve, como el propietario", support.status);
}

/* -------------------------------------------------------- Recomendado por ---- */

console.log("«Recomendado por»");
let referido = "";
{
  let r = await createBusiness("no-es-un-id");
  ok(r.status === 400, "un id que no es de un negocio → 400", r.body);
  r = await createBusiness("00000000-0000-4000-8000-000000000000");
  ok(r.status === 400 && /Elige el negocio/.test(r.body.error.message), "un negocio que no existe → 400", r.body);
  ok(count("select count(*) from businesses where name like 'Referido Prueba%'") === 1, "y no se crea nada");

  const before = count("select count(*) from audit_logs where action = 'platform.referred_by_changed'");
  r = await owner("POST", "/admin/businesses", businessInput({ name: "Intruso", slug: "intruso-referido", referredBy: CENTRO }));
  ok(r.status === 403, "un propietario no crea negocios ni anota referidos", r.status);

  r = await createBusiness(CENTRO);
  referido = r.body.business?.id;
  const referidoName = r.body.business?.name;
  ok(r.status === 200 && sql(`select referred_by from businesses where id = '${referido}'`) === CENTRO, "el alta guarda quién lo recomendó", r.body);
  ok(count("select count(*) from audit_logs where action = 'platform.referred_by_changed'") === before + 1, "con su entrada en la actividad");
  ok(
    lastAudit("platform.referred_by_changed").startsWith(`${referido} | Anotó que ${referidoName} fue recomendado por ${centroName} |`),
    "«Anotó que <A> fue recomendado por <B>», en la actividad de A",
    lastAudit("platform.referred_by_changed"),
  );

  r = await admin("PUT", `/admin/businesses/${referido}/referred-by`, { referredBy: referido });
  ok(r.status === 400 && /a sí mismo/.test(r.body.error.message), "un negocio no puede recomendarse a sí mismo", r.body);
  ok(sql(`select referred_by from businesses where id = '${referido}'`) === CENTRO, "y no cambia");

  r = await owner("PUT", `/admin/businesses/${referido}/referred-by`, { referredBy: DENTAL });
  ok(r.status === 403, "sólo el super admin lo cambia", r.status);

  r = await admin("PUT", `/admin/businesses/${referido}/referred-by`, { referredBy: DENTAL });
  ok(r.status === 200 && r.body.referredBy?.id === DENTAL, "el super admin lo cambia", r.body);
  const changed = lastAudit("platform.referred_by_changed");
  ok(
    changed.includes(`Anotó que ${referidoName} fue recomendado por ${dentalName}`) && changed.includes(`"before": "${centroName}"`),
    "el cambio queda en la actividad, con el de antes",
    changed,
  );
  const same = count("select count(*) from audit_logs where action = 'platform.referred_by_changed'");
  r = await admin("PUT", `/admin/businesses/${referido}/referred-by`, { referredBy: DENTAL });
  ok(r.status === 200 && count("select count(*) from audit_logs where action = 'platform.referred_by_changed'") === same, "el mismo otra vez no anota nada");

  r = await admin("PUT", `/admin/businesses/${referido}/referred-by`, { referredBy: null });
  ok(r.status === 200 && r.body.referredBy === null, "se puede quitar", r.body);
  ok(lastAudit("platform.referred_by_changed").includes(`Quitó que ${referidoName} fue recomendado por ${dentalName}`), "y quitarlo también se anota");

  r = await admin("PUT", `/admin/businesses/${referido}/referred-by`, { referredBy: CENTRO });
  ok(r.status === 200, "vuelve a quedar recomendado por el Centro");

  const detail = (await admin("GET", `/admin/businesses/${referido}`)).body as AdminBusinessDetail;
  ok(detail.referrals?.referredBy?.id === CENTRO && detail.referrals.referredBy.name === centroName, "la ficha dice quién lo recomendó", detail.referrals);
  ok(detail.referralCode === codeOf(referido) && detail.referredBy === CENTRO, "y su código", detail.referralCode);
  const centro = (await admin("GET", `/admin/businesses/${CENTRO}`)).body as AdminBusinessDetail;
  ok(
    centro.referrals?.referred.length === 1 && centro.referrals.referred[0].id === referido && centro.referrals.referred[0].qualified === false,
    "y la del Centro, a quién recomendó (todavía sin quedarse)",
    centro.referrals,
  );
  const list = (await admin("GET", "/admin/businesses")).body as AdminBusinessSummary[];
  ok(list.every((summary) => CODE.test(summary.referralCode)), "la lista de negocios trae el código de cada uno");
}

/* ------------------------------------------------------------ El descuento ---- */

console.log("El descuento");
{
  ok((await pendingFor(referido)).length === 0, "recién creado, no hay descuento");
  let r = await admin("POST", `/admin/referral-rewards/${referido}/apply`);
  ok(r.status === 409 && /todavía no se ganó/.test(r.body.error.message), "marcarlo aplicado antes de ganarlo → 409", r.body);

  ageDays(referido, 29);
  ok((await pendingFor(referido)).length === 0, "a los 29 días, todavía no");

  ageDays(referido, 31);
  let pending = await pendingFor(referido);
  ok(
    pending.length === 1 && pending[0].referrer.id === CENTRO && pending[0].referrer.name === centroName && pending[0].amount === 1.5,
    "a los 31 días y activo, el Centro gana $1,50",
    pending,
  );
  const earned = sql(`select to_char((created_at + interval '30 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') from businesses where id = '${referido}'`);
  ok(new Date(pending[0]?.earnedAt).toISOString().startsWith(earned), "ganado a los 30 días del alta", { earned, got: pending[0]?.earnedAt });
  let card = (await owner("GET", `/businesses/${CENTRO}/referrals`)).body as BusinessReferrals;
  ok(card.referred === 1 && card.qualified === 1, "la tarjeta del Centro: 1 recomendado, 1 se quedó", card);

  r = await admin("PATCH", `/admin/businesses/${referido}/status`, { status: "suspended" });
  ok(r.status === 200, "se suspende el recomendado");
  ok((await pendingFor(referido)).length === 0, "suspendido, no hay descuento");
  card = (await owner("GET", `/businesses/${CENTRO}/referrals`)).body as BusinessReferrals;
  ok(card.referred === 1 && card.qualified === 0, "y en la tarjeta no se quedó", card);
  r = await admin("POST", `/admin/referral-rewards/${referido}/apply`);
  ok(r.status === 409, "ni se puede marcar aplicado", r.status);
  await admin("PATCH", `/admin/businesses/${referido}/status`, { status: "active" });
  ok((await pendingFor(referido)).length === 1, "reactivado y con el mes cumplido, vuelve a estar");

  // Otro recomendado del Centro: dos descuentos el mismo mes se suman.
  const second = (await createBusiness(CENTRO)).body.business.id as string;
  ageDays(second, 40);
  const centroRewards = (await rewards()).filter((reward) => reward.referrer.id === CENTRO);
  ok(
    centroRewards.length === 2 && centroRewards.reduce((total, reward) => total + reward.amount, 0) === 3,
    "dos referidos que se quedaron son $3,00",
    centroRewards,
  );
  ok(centroRewards[0].business.id === second, "el más antiguo primero", centroRewards.map((reward) => reward.business.id));

  const owners = await owner("GET", "/admin/referral-rewards");
  ok(owners.status === 403, "sólo el super admin ve los descuentos", owners.status);

  const audits = count("select count(*) from audit_logs where action = 'platform.referral_reward_applied'");
  r = await admin("POST", `/admin/referral-rewards/${referido}/apply`);
  ok(r.status === 204, "«Marcar como aplicado»", r.status);
  ok((await pendingFor(referido)).length === 0, "ya no está pendiente");
  ok(sql(`select referral_reward_applied_at is not null from businesses where id = '${referido}'`) === "t", "guarda cuándo se aplicó");
  ok(count("select count(*) from audit_logs where action = 'platform.referral_reward_applied'") === audits + 1, "queda en la actividad");
  ok(
    lastAudit("platform.referral_reward_applied").startsWith(
      `sin negocio | Aplicó el descuento de $1,50 a ${centroName} por recomendar a ${sql(`select name from businesses where id = '${referido}'`)}`,
    ),
    "en la de la plataforma, sin el negocio (sus administradores no ven el descuento)",
    lastAudit("platform.referral_reward_applied"),
  );
  r = await admin("POST", `/admin/referral-rewards/${referido}/apply`);
  ok(r.status === 409 && /ya se aplicó/.test(r.body.error.message), "otra vez → 409", r.body);

  card = (await owner("GET", `/businesses/${CENTRO}/referrals`)).body as BusinessReferrals;
  ok(card.referred === 2 && card.qualified === 2, "la tarjeta sigue contando los que se quedaron", card);

  // Nunca se repite: ni cambiando quién lo recomendó y volviéndolo a poner, ni años después.
  await admin("PUT", `/admin/businesses/${referido}/referred-by`, { referredBy: DENTAL });
  ok((await pendingFor(referido)).length === 0, "cambiar quién lo recomendó no da otro descuento");
  await admin("PUT", `/admin/businesses/${referido}/referred-by`, { referredBy: CENTRO });
  ageDays(referido, 800);
  ok((await pendingFor(referido)).length === 0, "ni volverlo a poner, ni años después");

  r = await admin("POST", "/admin/referral-rewards/no-es-un-id/apply");
  ok(r.status === 404, "un negocio que no existe → 404", r.status);
}

/* -------------------------------------------------------- La ruta pública ---- */

console.log("La ruta pública");
{
  const code = codeOf(CENTRO);
  let r = await fetch(`${process.env.TEST_API_URL}/public/referrals/${code}`);
  const body = await r.json();
  ok(r.status === 200 && body.name === centroName && Object.keys(body).join(",") === "name", "sólo da el nombre del negocio", body);
  ok(/public/.test(r.headers.get("cache-control") ?? "") && /s-maxage=30/.test(r.headers.get("cache-control") ?? ""), "y va en la CDN", r.headers.get("cache-control"));
  r = await fetch(`${process.env.TEST_API_URL}/public/referrals/${code.toLowerCase()}`);
  ok(r.status === 200, "en minúsculas también");
  r = await fetch(`${process.env.TEST_API_URL}/public/referrals/${codeOf(SUSPENDED)}`);
  ok(r.status === 404 && !/public/.test(r.headers.get("cache-control") ?? ""), "un negocio suspendido → 404, sin caché", r.status);
  const unused = ["ZZZZZZ", "YYYYYY", "XXXXXX"].find((candidate) => count(`select count(*) from businesses where referral_code = '${candidate}'`) === 0);
  r = await fetch(`${process.env.TEST_API_URL}/public/referrals/${unused}`);
  ok(r.status === 404, "un código que no existe → 404", r.status);
  r = await fetch(`${process.env.TEST_API_URL}/public/referrals/${encodeURIComponent("' or 1=1 --")}`);
  ok(r.status === 404, "algo que no es un código → 404", r.status);
}

done("del programa de referidos");
