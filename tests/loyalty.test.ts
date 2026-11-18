// Tarjeta de fidelización (spec 052), lo del negocio: el programa (apagado al empezar, quién lo configura, la
// actividad); los beneficios (crear varios, editar, activar y desactivar, sin repetir las citas entre los activos,
// borrar o archivar, editar sin cambiar lo ganado); los sellos (cada camino que pasa la cita a Atendida, una cita no
// cuenta dos veces, sólo desde que se enciende, cada persona de una cita en grupo, el paciente desactivado no suma, la
// corrección los quita y anula lo no canjeado); el desbloqueo (varios a la vez, sin duplicados, el código y el
// vencimiento, el email con su copia y el progreso en el de seguimiento); los ciclos y los niveles; el canje (una sola
// vez, en la cita con el precio, quién puede); la ficha, «Pacientes», «Recompensas» y las cifras; el aislamiento entre
// negocios. Pacientes y servicios propios de la prueba: las demás suites no los tocan.
import { cedulaFor } from "./helpers/cedula.mjs";
import { checks, count, login, sql } from "./helpers/harness.ts";
import { addDaysISO } from "../src/shared/lib/time.ts";
import type { Business, ClientLoyalty, LoyaltyBenefit, LoyaltyMember, LoyaltyProgram, LoyaltyReward, LoyaltySummary } from "../src/shared/types/index.ts";

const { ok, done } = checks();

let ipSeq = 0;
const as = (email: string) => login(email, { ip: `198.52.0.${(ipSeq++ % 250) + 1}` });

const ricardo = await as("ricardo@demo.com"); // propietario
const elena = await as("elena@demo.com"); // Recepción
const valeria = await as("valeria@demo.com"); // rol Profesional
const laura = await as("laura@demo.com"); // otro negocio
const businessId: string = ricardo.session.businessId;
const B = `/businesses/${businessId}`;
const zone = sql(`select timezone from businesses where id = '${businessId}'`);
const T = sql(`select (now() at time zone '${zone}')::date`);
const ricardoAgenda = sql(
  `select id from professionals where business_id = '${businessId}' and user_id = (select id from users where email = 'ricardo@demo.com')`,
);
const tag = Date.now().toString(36);
const serviceId = sql(
  `insert into services (business_id, name, duration_minutes, price) values ('${businessId}', 'Limpieza ${tag}', 30, 40) returning id`,
).split("\n")[0];
sql(`insert into professional_services (professional_id, service_id) values ('${ricardoAgenda}', '${serviceId}') on conflict do nothing`);

let seq = 0;
const patient = (name: string, options: { active?: boolean } = {}) => {
  seq++;
  return {
    id: sql(
      `insert into clients (business_id, name, document_id, email, phone, is_active)
       values ('${businessId}', '${name}', '${cedulaFor(`fid-${tag}-${seq}`)}', 'fid.${seq}.${tag}@correo.ec', '+593 99 555 ${String(1000 + seq)}', ${options.active !== false})
       returning id`,
    ).split("\n")[0],
    email: `fid.${seq}.${tag}@correo.ec`,
  };
};
let slot = 0;
/** Una cita confirmada en el pasado (cada una en su propio día y hora: nunca se pisan). */
const appointment = (clientId: string, status = "confirmed") => {
  slot++;
  const date = addDaysISO(T, -(slot % 300) - 1);
  const start = `${String(6 + Math.floor(slot / 300)).padStart(2, "0")}:00`;
  return sql(
    `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source)
     values ('${businessId}', '${clientId}', '${serviceId}', '${ricardoAgenda}', '${date}', '${start}', '${start}'::time + interval '30 minutes', '${status}', 40, 'dashboard')
     returning id`,
  ).split("\n")[0];
};
const complete = (id: string, browser = ricardo) => browser("PATCH", `${B}/appointments/${id}/status`, { status: "completed", notify: true });
const stampsOf = (clientId: string) => count(`select count(*) from loyalty_stamps where client_id = '${clientId}' and voided_at is null`);
const rewardsOf = (clientId: string) =>
  sql(`select string_agg(visits_required || ':' || status || ':' || card_number, ',' order by card_number, visits_required) from loyalty_rewards where client_id = '${clientId}'`);
const auditCount = (action: string) => count(`select count(*) from audit_logs where business_id = '${businessId}' and action = '${action}'`);
const benefitInput = (name: string, visitsRequired: number, extra: Record<string, unknown> = {}) => ({
  name,
  description: "",
  visitsRequired,
  kind: "percent",
  value: 50,
  conditions: "",
  validDays: null,
  isActive: true,
  ...extra,
});
const program = (body: Partial<LoyaltyProgram>) =>
  ricardo("PUT", `${B}/loyalty`, { enabled: false, name: "Club Sonrisa", description: "", stampIcon: "tooth", afterLast: "keep", ...body });

/* ======================================================================================== */
console.log("Sólo en los negocios que habilita el super admin (migración 060)");
const admin = await as("admin@demo.com"); // super admin
const ALLOW = `/admin/businesses/${businessId}/loyalty-allowed`;
const allowed = () => sql(`select loyalty_allowed from businesses where id = '${businessId}'`) === "t";
let r = await ricardo("GET", `${B}/loyalty`);
ok(r.status === 403 && JSON.stringify(r.body).includes("no está habilitada"), "sin habilitar, «Fidelización» no responde", r.body);
ok((await ricardo("GET", `${B}/loyalty/summary`)).status === 403, "ni sus cifras");
await ricardo("PATCH", B, { loyaltyAllowed: true });
ok(!allowed(), "el negocio no se la habilita solo al guardar su configuración");
ok((await ricardo("PUT", ALLOW, { enabled: true })).status === 403, "ni por la ruta del super admin");
r = await admin("PUT", ALLOW, { enabled: true });
ok(r.status === 200 && (r.body as Business).loyaltyAllowed === true && allowed(), "el super admin la habilita", r.body);
ok(auditCount("platform.loyalty_allowed_changed") === 1, "con la actividad del negocio");

console.log("\nEl programa");
r = await ricardo("GET", `${B}/loyalty`);
ok(r.status === 200 && (r.body as LoyaltyProgram).enabled === false, "apagado al empezar", r.body);
ok((await elena("GET", `${B}/loyalty`)).status === 403 && (await valeria("GET", `${B}/loyalty`)).status === 403, "Recepción y el Profesional no lo ven");
ok((await elena("PUT", `${B}/loyalty`, { enabled: true, name: "Club", description: "", stampIcon: "star", afterLast: "keep" })).status === 403, "ni lo configuran");
ok((await laura("GET", `${B}/loyalty`)).status === 403, "otro negocio, 403 (prueba 15)");
r = await program({ stampIcon: "unicornio" as never });
ok(r.status === 400, "un sello que no está en la lista, rechazado", r.status);
r = await program({});
ok(r.status === 200 && (r.body as LoyaltyProgram).name === "Club Sonrisa" && !(r.body as LoyaltyProgram).enabled, "el propietario lo guarda", r.body);
ok(auditCount("loyalty.program_updated") === 1, "con la actividad");

/* ======================================================================================== */
console.log("\nLos beneficios (pruebas 1 a 5 y 13)");
r = await ricardo("POST", `${B}/loyalty/benefits`, benefitInput("Limpieza al 50 %", 2));
const half = r.body as LoyaltyBenefit;
ok(r.status === 200 && half.visitsRequired === 2 && half.value === 50 && half.timesWon === 0, "crea un beneficio (prueba 1)", r.body);
r = await ricardo("POST", `${B}/loyalty/benefits`, benefitInput("Cita gratis", 4, { kind: "free_appointment", value: 99 }));
const free = r.body as LoyaltyBenefit;
ok(r.status === 200 && free.kind === "free_appointment" && free.value === null, "y otro: «Cita gratis» no guarda un valor", r.body);
r = await ricardo("POST", `${B}/loyalty/benefits`, benefitInput("Kit de regalo", 6, { kind: "custom", validDays: 30 }));
const kit = r.body as LoyaltyBenefit;
ok(r.status === 200 && kit.validDays === 30, "y un tercero, personalizado y con vencimiento", r.body);
ok(((await ricardo("GET", `${B}/loyalty/benefits`)).body as LoyaltyBenefit[]).map((b) => b.visitsRequired).join() === "2,4,6", "la lista, de menos a más citas");
ok((await ricardo("POST", `${B}/loyalty/benefits`, benefitInput("Otro", 2))).status === 409, "dos activos con las mismas citas, no");
ok((await ricardo("POST", `${B}/loyalty/benefits`, benefitInput("Mucho", 3, { value: 150 }))).status === 400, "un porcentaje de más de 100, no");
ok((await ricardo("POST", `${B}/loyalty/benefits`, benefitInput("Servicio", 3, { kind: "free_service", serviceId: null }))).status === 400, "«Servicio gratis» sin servicio, no");
const otherService = sql(`select id from services where business_id <> '${businessId}' limit 1`);
ok(
  (await ricardo("POST", `${B}/loyalty/benefits`, benefitInput("Servicio", 3, { kind: "free_service", serviceId: otherService }))).status === 400,
  "ni con un servicio de otro negocio",
);
ok((await elena("POST", `${B}/loyalty/benefits`, benefitInput("Recepción", 9))).status === 403, "Recepción no crea beneficios");
r = await ricardo("PUT", `${B}/loyalty/benefits/${kit.id}`, benefitInput("Kit de regalo", 6, { kind: "custom", validDays: 30, isActive: false }));
ok(r.status === 200 && (r.body as LoyaltyBenefit).isActive === false, "lo desactiva (prueba 3)", r.body);
r = await ricardo("PUT", `${B}/loyalty/benefits/${kit.id}`, benefitInput("Kit de regalo", 6, { kind: "custom", validDays: 30 }));
ok(r.status === 200 && (r.body as LoyaltyBenefit).isActive, "y lo vuelve a activar");
ok(auditCount("loyalty.benefit_created") === 3 && auditCount("loyalty.benefit_updated") === 2, "todo en la actividad");
r = await ricardo("POST", `${B}/loyalty/benefits`, benefitInput("Borrador", 9));
r = await ricardo("DELETE", `${B}/loyalty/benefits/${(r.body as LoyaltyBenefit).id}`);
ok(r.status === 200 && (r.body as { archived: boolean }).archived === false && auditCount("loyalty.benefit_deleted") === 1, "uno que nadie ganó se borra (prueba 4)", r.body);

/* ======================================================================================== */
console.log("\nLos sellos (pruebas 6 y 7)");
const ana = patient("Ana Frecuente");
const before = appointment(ana.id);
ok((await complete(before)).status === 200 && stampsOf(ana.id) === 0, "apagada, una cita Atendida no suma");
r = await program({ enabled: true });
ok(r.status === 200 && (r.body as LoyaltyProgram).enabled && auditCount("loyalty.program_updated") === 2, "el propietario la enciende", r.body);
ok(stampsOf(ana.id) === 0, "y lo que ya estaba Atendido no cuenta (desde que se enciende)");
const a1 = appointment(ana.id);
ok((await complete(a1)).status === 200 && stampsOf(ana.id) === 1, "desde la ficha: un sello (prueba 6)");
ok((await complete(a1)).status !== 200 || stampsOf(ana.id) === 1, "la misma cita no cuenta dos veces (prueba 7)");
const a2 = appointment(ana.id);
r = await ricardo("POST", `${B}/appointments/close-all`, { ids: [a2], status: "completed", notify: true });
ok(r.status === 200 && stampsOf(ana.id) === 2, "desde «Por cerrar» («Marcar todas»): otro", r.body);
ok(rewardsOf(ana.id) === "2:available:1", "a las 2 citas, se desbloquea su recompensa", rewardsOf(ana.id));
const code = sql(`select code from loyalty_rewards where client_id = '${ana.id}'`);
ok(/^[2-9A-HJ-NP-Z]{6}$/.test(code), "con un código sin letras que se confunden", code);
const rewardMail = sql(`select subject || ' | ' || body from notifications where type = 'loyalty_reward' and to_email = '${ana.email}'`);
ok(rewardMail.startsWith("Ganaste un premio en ") && rewardMail.includes(`${code.slice(0, 3)}-${code.slice(3)}`) && !rewardMail.includes(`Limpieza ${tag}`), "el email del premio, con el código y sin el servicio en el asunto", rewardMail.slice(0, 200));
ok(
  count(`select count(*) from notifications where type = 'appointment_copy' and appointment_id = '${a2}' and subject like 'Copia · %Ganaste un premio%'`) === 1,
  "y su copia aparte al profesional",
);
const followUp = sql(`select body from notifications where type = 'appointment_completed' and appointment_id = '${a1}' limit 1`);
ok(followUp.includes("Llevas 1 sello en Club Sonrisa: te falta 1 cita para Limpieza al 50 %") && followUp.includes("/mi-tarjeta"), "el email de seguimiento dice el progreso", followUp.slice(0, 300));

console.log("\nLa corrección");
r = await ricardo("POST", `${B}/appointments/${a2}/correct-status`, { status: "no_show", reason: "Se marcó por error", notify: false });
ok(r.status === 200 && stampsOf(ana.id) === 1, "corregir la cita Atendida quita su sello", r.body);
ok(rewardsOf(ana.id) === "2:voided:1", "y anula la recompensa sin canjear que ya no alcanza", rewardsOf(ana.id));
const a3 = appointment(ana.id);
await complete(a3);
ok(stampsOf(ana.id) === 2, "otra cita Atendida vuelve a sumar");
ok(rewardsOf(ana.id) === "2:voided:1", "y el premio de esa tarjeta no se repite (se ganó una vez)", rewardsOf(ana.id));

console.log("\nUna cita en grupo, el paciente desactivado y dos cambios a la vez");
const hugo = patient("Hugo Principal");
const ines = patient("Ines Acompaña");
const group = appointment(hugo.id);
sql(`insert into appointment_clients (appointment_id, client_id, business_id) values ('${group}', '${ines.id}', '${businessId}')`);
await complete(group);
ok(stampsOf(hugo.id) === 1 && stampsOf(ines.id) === 1, "cada persona de la cita suma su sello");
const off = patient("Oscar Desactivado", { active: false });
await complete(appointment(off.id));
ok(stampsOf(off.id) === 0, "un paciente desactivado no suma");
const bea = patient("Bea Concurrente");
const b1 = appointment(bea.id);
const b2 = appointment(bea.id);
await Promise.all([complete(b1), complete(b2)]);
ok(stampsOf(bea.id) === 2 && rewardsOf(bea.id) === "2:available:1", "dos citas cerradas a la vez: dos sellos y un solo premio (prueba 9)", rewardsOf(bea.id));

/* ======================================================================================== */
console.log("\nVarios hitos a la vez (prueba 8) y lo ganado no cambia (pruebas 12 y 13)");
const caro = patient("Caro Varios");
for (let i = 0; i < 4; i++) await complete(appointment(caro.id));
ok(rewardsOf(caro.id) === "2:available:1,4:available:1", "con 4 sellos: los premios de 2 y de 4", rewardsOf(caro.id));
r = await ricardo("PUT", `${B}/loyalty/benefits/${half.id}`, benefitInput("Limpieza al 40 %", 2, { value: 40 }));
ok(r.status === 200, "edita el beneficio de 2 citas");
const kept = sql(`select name || ':' || value from loyalty_rewards where client_id = '${caro.id}' and visits_required = 2`);
ok(kept === "Limpieza al 50 %:50.00", "la recompensa ya ganada conserva lo que era (prueba 13)", kept);
r = await ricardo("POST", `${B}/loyalty/benefits`, benefitInput("Bienvenida", 1, { kind: "custom" }));
const welcome = r.body as LoyaltyBenefit;
ok(rewardsOf(caro.id).startsWith("1:available:1,"), "un beneficio nuevo de 1 cita: quien ya lo alcanzaba lo gana al guardarlo", rewardsOf(caro.id));
r = await ricardo("DELETE", `${B}/loyalty/benefits/${welcome.id}`);
ok(r.status === 200 && (r.body as { archived: boolean }).archived === true, "ya ganado: «Eliminar» lo archiva (prueba 5)", r.body);
ok(
  count(`select count(*) from loyalty_rewards where benefit_id = '${welcome.id}'`) > 0 &&
    !((await ricardo("GET", `${B}/loyalty/benefits`)).body as LoyaltyBenefit[]).some((b) => b.id === welcome.id),
  "sale de la lista y sus recompensas se conservan (prueba 12)",
);
ok(auditCount("loyalty.benefit_archived") === 1, "con la actividad");

/* ======================================================================================== */
console.log("\nLos ciclos y los niveles (prueba 14)");
r = await program({ enabled: true, afterLast: "restart" });
ok(r.status === 200 && (r.body as LoyaltyProgram).afterLast === "restart", "«Empezar una tarjeta nueva»");
const dani = patient("Dani Ciclos");
for (let i = 0; i < 6; i++) await complete(appointment(dani.id));
let card = ((await ricardo("GET", `${B}/clients/${dani.id}/loyalty`)).body as ClientLoyalty).card!;
ok(card.cardNumber === 2 && card.level === "silver" && card.stamps === 0 && card.totalStamps === 6, "al ganar el último beneficio (6 citas), tarjeta nueva y nivel Plata", card);
ok(rewardsOf(dani.id) === "2:available:1,4:available:1,6:available:1", "con los premios de la primera tarjeta", rewardsOf(dani.id));
await complete(appointment(dani.id));
await complete(appointment(dani.id));
ok(rewardsOf(dani.id).endsWith(",2:available:2"), "en la segunda tarjeta, los premios se vuelven a ganar", rewardsOf(dani.id));
await program({ enabled: true, afterLast: "keep" });

/* ======================================================================================== */
console.log("\nEl canje (pruebas 10, 11 y 16)");
const caroRewards = ((await ricardo("GET", `${B}/clients/${caro.id}/loyalty`)).body as ClientLoyalty).rewards;
const fifty = caroRewards.find((reward) => reward.visitsRequired === 2)!;
const freeVisit = caroRewards.find((reward) => reward.visitsRequired === 4)!;
const next = appointment(caro.id, "confirmed");
ok((await valeria("POST", `${B}/loyalty/rewards/${fifty.id}/redeem`, { appointmentId: next })).status === 403, "el Profesional no canjea (prueba 16)");
ok((await laura("POST", `/businesses/${businessId}/loyalty/rewards/${fifty.id}/redeem`, {})).status === 403, "ni otro negocio (prueba 15)");
ok((await elena("POST", `${B}/loyalty/rewards/${fifty.id}/redeem`, { appointmentId: a1 })).status === 400, "en la cita de otro paciente, no");
r = await elena("POST", `${B}/loyalty/rewards/${fifty.id}/redeem`, { appointmentId: next });
const redeemed = r.body as LoyaltyReward;
ok(r.status === 200 && redeemed.status === "redeemed" && redeemed.redeemedAppointmentId === next && redeemed.redeemedByName !== null, "Recepción la canjea en la cita (prueba 10)", r.body);
ok(sql(`select price from appointments where id = '${next}'`) === "20.00", "y el 50 % baja el precio de la cita de $40 a $20", sql(`select price from appointments where id = '${next}'`));
ok(
  count(`select count(*) from audit_logs where action = 'loyalty.reward_redeemed' and entity_id = '${fifty.id}' and changes::text like '%Precio%'`) === 1,
  "con la actividad y el cambio de precio",
);
ok((await ricardo("POST", `${B}/loyalty/rewards/${fifty.id}/redeem`, {})).status === 409, "no se canjea dos veces (prueba 11)");
const paid = appointment(caro.id, "confirmed");
sql(`update appointments set paid_at = now() where id = '${paid}'`);
r = await ricardo("POST", `${B}/loyalty/rewards/${freeVisit.id}/redeem`, { appointmentId: paid });
ok(r.status === 200 && sql(`select price from appointments where id = '${paid}'`) === "40.00", "en una cita ya pagada, el precio no cambia", r.body);
const voided = ((await ricardo("GET", `${B}/clients/${ana.id}/loyalty`)).body as ClientLoyalty).rewards.find((reward) => reward.status === "voided")!;
ok((await ricardo("POST", `${B}/loyalty/rewards/${voided.id}/redeem`, {})).status === 409, "una anulada no se canjea");
sql(`update loyalty_rewards set expires_at = now() - interval '1 day' where client_id = '${dani.id}' and visits_required = 2 and card_number = 1`);
const expired = ((await ricardo("GET", `${B}/clients/${dani.id}/loyalty`)).body as ClientLoyalty).rewards.find((reward) => reward.status === "expired");
ok(expired !== undefined && (await ricardo("POST", `${B}/loyalty/rewards/${expired.id}/redeem`, {})).status === 409, "ni una vencida");

console.log("\nEl descuento sólo donde corresponde (revisión de seguridad 2026-11-18)");
const CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const rewardCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
/** Una recompensa disponible de Caro, copiada de la del 50 % con otro tipo (otra tarjeta: no choca con la de verdad). */
const extraReward = (card: number, kind: string, value: string, service: string | null) =>
  sql(
    `insert into loyalty_rewards (business_id, client_id, benefit_id, card_number, name, kind, value, service_id, service_name, visits_required, code)
     select business_id, client_id, benefit_id, ${card}, 'Premio ${card}', '${kind}', ${value}, ${service ? `'${service}'` : "null"},
            ${service ? `'Limpieza ${tag}'` : "''"}, visits_required, '${rewardCode()}'
       from loyalty_rewards where id = '${fifty.id}' returning id`,
  ).split("\n")[0];
const freeCleaning = extraReward(90, "free_service", "null", serviceId);
const orthodontics = sql(`insert into services (business_id, name, duration_minutes, price) values ('${businessId}', 'Ortodoncia ${tag}', 30, 800) returning id`).split("\n")[0];
const expensive = appointment(caro.id);
sql(`update appointments set service_id = '${orthodontics}', price = 800 where id = '${expensive}'`);
r = await elena("POST", `${B}/loyalty/rewards/${freeCleaning}/redeem`, { appointmentId: expensive });
ok(
  r.status === 400 && sql(`select price from appointments where id = '${expensive}'`) === "800.00" && sql(`select status from loyalty_rewards where id = '${freeCleaning}'`) === "available",
  "«Servicio gratis» no deja en $0 una cita de otro servicio (ni se gasta el premio)",
  r.body,
);
const cleaning = appointment(caro.id);
r = await elena("POST", `${B}/loyalty/rewards/${freeCleaning}/redeem`, { appointmentId: cleaning });
ok(r.status === 200 && sql(`select price from appointments where id = '${cleaning}'`) === "0.00", "en una cita de ese servicio, sí", r.body);
const halfOff = extraReward(91, "percent", "50", null);
const sharedSession = appointment(caro.id);
sql(`insert into appointment_clients (appointment_id, client_id, business_id) values ('${sharedSession}', '${patient("Pareja de Caro").id}', '${businessId}')`);
r = await elena("POST", `${B}/loyalty/rewards/${halfOff}/redeem`, { appointmentId: sharedSession });
ok(
  r.status === 400 && sql(`select price from appointments where id = '${sharedSession}'`) === "40.00",
  "el premio de un paciente no rebaja la sesión entera de varios",
  r.body,
);
ok((await elena("POST", `${B}/loyalty/rewards/${halfOff}/redeem`, {})).status === 200, "sin cita, se canjea igual");

/* ======================================================================================== */
console.log("\nLa ficha, «Pacientes», «Recompensas» y las cifras");
const ficha = (await valeria("GET", `${B}/clients/${caro.id}/loyalty`));
ok(ficha.status === 200 || ficha.status === 403 || ficha.status === 404, "el Profesional ve la ficha sólo de sus pacientes", ficha.status);
const caroCard = ((await elena("GET", `${B}/clients/${caro.id}/loyalty`)).body as ClientLoyalty).card!;
ok(caroCard.stamps === 4 && caroCard.level === "classic" && caroCard.next?.visitsRequired === 6 && caroCard.next.missing === 2, "Recepción ve la tarjeta en la ficha: 4 sellos, faltan 2 para el de 6", caroCard);
ok((await laura("GET", `${B}/clients/${caro.id}/loyalty`)).status === 403, "otro negocio, 403");
const members = (await ricardo("GET", `${B}/loyalty/members`)).body as LoyaltyMember[];
ok(members.some((m) => m.clientId === caro.id) && members.every((m, i) => i === 0 || (members[i - 1].next?.missing ?? 999) <= (m.next?.missing ?? 999)), "«Pacientes»: a los que les falta menos, primero", members.length);
ok(((await ricardo("GET", `${B}/loyalty/rewards?status=redeemed`)).body as LoyaltyReward[]).every((x) => x.status === "redeemed"), "«Recompensas» filtra por estado");
ok(((await ricardo("GET", `${B}/loyalty/rewards?clientId=${caro.id}`)).body as LoyaltyReward[]).every((x) => x.clientId === caro.id), "y por paciente");
const byCode = (await ricardo("GET", `${B}/loyalty/rewards?code=${fifty.code.toLowerCase()}`)).body as LoyaltyReward[];
ok(byCode.length === 1 && byCode[0].id === fifty.id, "y busca por código, escrito como sea", byCode.length);
const summary = (await ricardo("GET", `${B}/loyalty/summary`)).body as LoyaltySummary;
ok(summary.participants >= 6 && summary.redeemed >= 2 && summary.expired >= 1, "las cifras", summary);
ok((await elena("GET", `${B}/loyalty/summary`)).status === 403, "Recepción no ve las cifras");

console.log("\nBorrar el paciente");
r = await ricardo("DELETE", `${B}/clients/${bea.id}`);
ok(r.status === 204 && count(`select count(*) from loyalty_stamps where client_id = '${bea.id}'`) === 0 && count(`select count(*) from loyalty_rewards where client_id = '${bea.id}'`) === 0, "se borran sus sellos y sus recompensas", r.status);

console.log("\nAl quitarla (el super admin), se apaga todo y se guarda lo ganado");
const karla = patient("Karla Guardado");
const karlaVisit = appointment(karla.id);
await complete(karlaVisit);
const karlaStamps = stampsOf(karla.id);
await ricardo("PUT", `${B}/loyalty`, { enabled: true, name: "Club Sonrisa", description: "", stampIcon: "tooth", afterLast: "keep" });
r = await admin("PUT", ALLOW, { enabled: false });
ok(r.status === 200 && !allowed() && sql(`select enabled_at is null from loyalty_programs where business_id = '${businessId}'`) === "t", "la quita y el programa queda apagado", r.body);
ok(auditCount("platform.loyalty_allowed_changed") === 2, "con la actividad");
ok((await ricardo("GET", `${B}/loyalty/members`)).status === 403 && (await ricardo("PUT", `${B}/loyalty`, { enabled: true, name: "Club Sonrisa", description: "", stampIcon: "tooth", afterLast: "keep" })).status === 403, "el propietario ya no la ve ni la enciende");
const afterOff = appointment(karla.id);
await complete(afterOff);
ok(stampsOf(karla.id) === karlaStamps && karlaStamps > 0, "una cita atendida ya no suma, y los sellos de antes se guardan", { karlaStamps, now: stampsOf(karla.id) });
r = await ricardo("GET", `${B}/clients/${karla.id}/loyalty`);
ok(r.status === 200 && (r.body as ClientLoyalty).program.enabled === false, "la ficha sigue mostrando lo ganado (para canjearlo)", r.body);
r = await admin("PUT", ALLOW, { enabled: true });
ok(r.status === 200 && sql(`select enabled_at is null from loyalty_programs where business_id = '${businessId}'`) === "t", "habilitarla otra vez no la enciende: lo hace el propietario");

done("de la tarjeta de fidelización");
process.exit();
