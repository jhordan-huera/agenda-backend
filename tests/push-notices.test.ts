// Avisos en el celular (spec 013): quién los puede activar, a quién le llegan y qué dicen (siempre con el
// paciente a medias), la cola con sus reintentos y bajas, lo que sale del cron (citas por cerrar, el
// resumen de las 8 y los del super admin) y que un fallo de los avisos nunca rompe una reserva (RF-011).
// Desde la spec 017, también el resumen de las 8 en el celular de cada profesional, con su agenda.
// El servicio de avisos es uno falso en 127.0.0.1 (tests/helpers/harness.ts) que descifra lo que recibe.
import { businessInput, createBusinessWithOwner } from "./helpers/business.mjs";
import { cedulaFor } from "./helpers/cedula.mjs";
import { BASE, agent, checks, count, fakeNtfy, fakePushService, login, runCron, sleep, sql, startApi, type ReceivedPush } from "./helpers/harness.ts";
import { getAvailableSlots, scopeToProfessional } from "../src/shared/lib/availability.ts";
import { AGENDA_PUSH_KINDS, OWNER_PUSH_KINDS, PLATFORM_PUSH_KINDS } from "../src/shared/lib/constants/push.ts";
import { getPlan } from "../src/shared/lib/constants/plans.ts";
import { capitalize, formatShortDate } from "../src/shared/lib/format.ts";
import { addDaysISO, getZonedNow } from "../src/shared/lib/time.ts";
import type { Appointment, PublicBusinessProfile } from "../src/shared/types/index.ts";

const { ok, done } = checks();
const push = await fakePushService();
const { pool, transaction } = await import("../src/db/pool.ts");
const delivery = await import("../src/services/push-delivery.ts");
const notices = await import("../src/services/push-notices.ts");
// Lo que esta prueba pone en cola desde aquí (el cron simulado) lo envía ella misma con processPushQueue.
delivery.disableImmediatePushDelivery();
const ORIGIN = new URL(BASE).origin;

// Cada navegador con su IP (por el proxy firmado): los límites de una prueba no gastan los de otra.
let ipSeq = 0;
const nextIp = () => `192.0.2.${(ipSeq++ % 250) + 1}`;
const as = (email: string, options: { base?: string } = {}) => login(email, { ip: nextIp(), ...options });
const visitor = (base?: string) => agent({ ip: nextIp(), base });
type Browser = Awaited<ReturnType<typeof as>>;
type Device = ReturnType<typeof push.device>;
type Payload = NonNullable<ReceivedPush["payload"]>;

const SECRET_NOTE = "Me duele la muela del juicio desde el lunes";
const tag = Date.now().toString(36);
let seq = 0;
/** Un paciente con nombre y apellidos largos, email, teléfono y cédula propios (CE-003). */
const people: { name: string; email: string; phone: string; documentId: string }[] = [];
const person = (name: string) => {
  seq++;
  const who = {
    documentId: cedulaFor(`${tag}-${seq}`),
    name,
    email: `${name.split(" ")[0].normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()}.${seq}.${tag}@correo.ec`,
    phone: `+593 98 ${String(200 + seq)} 4567`,
  };
  people.push(who);
  return who;
};

/** Lo que recibió un aparato que cumple `match`, esperando hasta `ms` (el envío sale 1 s después). */
async function receive(device: Device, match: (payload: Payload) => boolean, ms = 8000): Promise<ReceivedPush | undefined> {
  const end = Date.now() + ms;
  for (;;) {
    const found = push.to(device.endpoint).find((item) => item.payload && match(item.payload));
    if (found || Date.now() > end) return found;
    await sleep(100);
  }
}
const withTag = (value: string) => (payload: Payload) => payload.tag === value;
/** Avisos en cola o enviados a ese aparato con ese tag (la cola se escribe en la misma transacción). */
const queuedFor = (device: Device, tagValue: string) =>
  count(
    `select count(*) from push_messages m join push_subscriptions s on s.id = m.subscription_id
      where s.endpoint = '${device.endpoint}' and m.tag = '${tagValue}'`,
  );
const deviceExists = (device: Device) => count(`select count(*) from push_subscriptions where endpoint = '${device.endpoint}'`) === 1;
async function until(condition: () => boolean, ms = 8000): Promise<boolean> {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) return false;
    await sleep(100);
  }
  return true;
}

/** «Hoy 16:00», «Mañana 16:00» o «Mar 20 oct 16:00», como lo cuenta el aviso. */
function whenText(date: string, time: string, timezone = "America/Guayaquil"): string {
  const today = getZonedNow(timezone).date;
  const day = date === today ? "hoy" : date === addDaysISO(today, 1) ? "mañana" : formatShortDate(date);
  return `${capitalize(day)} ${time}`;
}

/** Reservar en la página pública de un negocio: el servicio, la agenda y las horas libres. */
async function bookingPage(businessId: string, options: { professionalName?: string } = {}) {
  sql(
    `update businesses set booking_settings = booking_settings
            || '{"minNoticeHours": 0, "maxClientBookingsPerDay": 0, "chooseProfessional": true, "allowCancellations": true, "cancellationNoticeHours": 0}'
      where id = '${businessId}'`,
  );
  sql(`update subscriptions set plan = 'business' where business_id = '${businessId}'`);
  const slug = sql(`select slug from businesses where id = '${businessId}'`);
  const read = async (): Promise<PublicBusinessProfile> => (await visitor()("GET", `/public/businesses/${slug}?t=${Date.now()}`)).body;
  const profile = await read();
  const professional = options.professionalName
    ? profile.professionals.find((p) => p.displayName === options.professionalName)!
    : profile.professionals[0];
  const service = profile.services.find((s) => s.modes.includes("business") && s.peoplePerSession === 1 && professional.serviceIds.includes(s.id)) ??
    profile.services.find((s) => s.modes.includes("business") && s.peoplePerSession === 1)!;
  const used = new Set<string>();
  /** Una hora libre de esa agenda, desde mañana, que no se haya usado en esta prueba. */
  async function freeSlot(fromDay = 1, durationMinutes = service.durationMinutes): Promise<{ date: string; startTime: string }> {
    const current = await read();
    const now = getZonedNow(current.business.timezone);
    const context = scopeToProfessional({ ...current, settings: current.business.bookingSettings, now }, professional.id);
    for (let d = fromDay; d < 60; d++) {
      const date = addDaysISO(now.date, d);
      for (const startTime of getAvailableSlots(date, durationMinutes, context)) {
        if (used.has(`${date} ${startTime}`)) continue;
        used.add(`${date} ${startTime}`);
        return { date, startTime };
      }
    }
    throw new Error(`No hay horas libres en ${slug}`);
  }
  const book = async (who: ReturnType<typeof person>, extra: Record<string, unknown> = {}, base?: string) => {
    const slot = await freeSlot();
    const r = await visitor(base)("POST", `/public/businesses/${slug}/bookings`, {
      serviceId: service.id,
      professionalId: professional.id,
      ...slot,
      notes: SECRET_NOTE,
      ...who,
      extraPatients: [],
      ...extra,
    });
    return { ...r, slot };
  };
  return { slug, profile, professional, service, freeSlot, book };
}

const activate = (browser: Browser, device: Device, extra: Record<string, unknown> = {}) => browser("PUT", "/push/device", { ...device, ...extra });

/* ======================================================================================== */
console.log("Quién puede activar los avisos");
const ricardo = await as("ricardo@demo.com"); // propietario de la Clínica Dental Sonrisa (3 agendas)
const dental: string = ricardo.session.businessId;
const jhordan = await as("jhordan@demo.com"); // propietario de su negocio (una sola agenda)
const jhordanBusiness: string = jhordan.session.businessId;
const admin = await as("admin@demo.com");
let r = await ricardo("GET", "/push/config");
ok(
  r.status === 200 && r.body.available === true && r.body.publicKey === process.env.VAPID_PUBLIC_KEY && r.body.publicKey.length === 87,
  "el propietario recibe la clave pública (87 caracteres)",
  r.body,
);
ok(JSON.stringify(r.body.kinds) === JSON.stringify(OWNER_PUSH_KINDS), "con los ocho tipos del propietario, en el orden de la tarjeta", r.body.kinds);
const ricardoA = push.device();
r = await activate(ricardo, ricardoA);
ok(r.status === 200 && Array.isArray(r.body.mutedKinds) && r.body.mutedKinds.length === 0 && r.body.createdAt, "activa su aparato con todos los tipos encendidos", r.body);
ok(Object.keys(r.body).sort().join() === "createdAt,mutedKinds", "la respuesta nunca devuelve la dirección ni las claves", r.body);
r = await admin("GET", "/push/config");
ok(r.status === 200 && JSON.stringify(r.body.kinds) === JSON.stringify(PLATFORM_PUSH_KINDS), "el super admin recibe sus seis tipos (con los comprobantes de mensualidades, spec 029)", r.body);
const adminDevice = push.device();
ok((await activate(admin, adminDevice)).status === 200, "y activa el suyo");
// El rol Profesional con su agenda sí (spec 017): ver «El resumen de las 8 en el celular de cada profesional».
const NOT_FOR_ROLE = "Los avisos en el celular son sólo para el propietario del negocio y los profesionales con su agenda.";
for (const [email, label] of [
  ["elena@demo.com", "Recepción"],
  ["andrea@demo.com", "un administrador"],
] as const) {
  const browser = await as(email);
  const config = await browser("GET", "/push/config");
  const saved = await activate(browser, push.device());
  ok(config.status === 403 && saved.status === 403 && saved.body.error.message === NOT_FOR_ROLE, `${label}: 403`, { config: config.body, saved: saved.body });
}
ok((await visitor()("GET", "/push/config")).status === 401 && (await visitor()("PUT", "/push/device", push.device())).status === 401, "sin sesión: 401");
const strict = await startApi({ SUPER_ADMIN_2FA: "required" });
const adminStrict = await as("admin@demo.com", { base: strict.base });
r = await adminStrict("GET", "/push/config");
const r2 = await adminStrict("PUT", "/push/device", push.device());
ok(r.status === 403 && r.body.error.code === "two_factor_required" && r2.body?.error?.code === "two_factor_required", "un super admin sin la verificación en dos pasos (obligatoria): two_factor_required", [r.body, r2.body]);
strict.stop();
const keyless = await startApi({ VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "" });
const jhordanKeyless = await as("jhordan@demo.com", { base: keyless.base });
r = await jhordanKeyless("GET", "/push/config");
const health = await (await fetch(`${keyless.base}/health`)).json();
ok(r.status === 200 && r.body.available === false && r.body.publicKey === null, "sin claves VAPID: available false y sin clave pública", r.body);
ok(health.push === false && health.ok === true, "y /api/health dice push: false (la API funciona igual)", health);
ok((await (await fetch(`${BASE}/health`)).json()).push === true, "con claves, push: true");
r = await jhordanKeyless("PUT", "/push/device", push.device());
ok(r.status === 503 && r.body.error.message === "Los avisos en el celular todavía no están disponibles.", "activar sin claves: 503", r.body);
ok(
  keyless.output().includes("Avisos en el celular desactivados: faltan VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY.") &&
    !keyless.output().includes(process.env.VAPID_PRIVATE_KEY!),
  "el registro dice qué falta, sin ningún valor",
  keyless.output().slice(0, 400),
);
keyless.stop();

console.log("Direcciones y claves que no se aceptan (R4)");
const good = push.device();
for (const [label, endpoint] of [
  ["otro sitio", "https://ejemplo.com/push/1"],
  ["un dominio parecido", "https://fcm.googleapis.com.ejemplo.net/fcm/send/1"],
  ["localhost", "http://localhost:4100/push"],
  ["la IP de los metadatos de la nube", "http://169.254.169.254/latest/meta-data"],
] as const) {
  r = await activate(jhordan, { endpoint, keys: good.keys });
  ok(
    r.status === 400 &&
      r.body.error.message === "Este navegador usa un servicio de avisos que no reconocemos. Prueba con Chrome, Safari, Edge o Firefox.",
    `${label}: 400 con el mensaje claro`,
    r.body,
  );
}
r = await activate(jhordan, { endpoint: good.endpoint, keys: { p256dh: good.keys.p256dh, auth: Buffer.alloc(15, 7).toString("base64url") } });
ok(r.status === 400, "un secreto auth de 15 bytes: 400", r.body);
r = await activate(jhordan, { endpoint: good.endpoint, keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"), auth: good.keys.auth } });
ok(r.status === 400 && !deviceExists(good), "una clave que no es un punto P-256: 400 y no se guarda", r.body);

/* ======================================================================================== */
console.log("Aparatos: varios por persona, tipos, desactivar y hasta 10");
const dentalPage = await bookingPage(dental, { professionalName: "Dra. Valeria Cruz" });
sql(`update professionals set all_services = true where business_id = '${dental}'`);
const ricardoB = push.device();
const CHROME_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const chromeMac = { "User-Agent": CHROME_MAC };
await ricardo("PUT", "/push/device", ricardoB, chromeMac);
const ana = person("Ana María Salazar Quiroga");
let booking = await dentalPage.book(ana);
ok(booking.status === 200, "reserva online en la clínica", booking.body);
let appointmentId: string = booking.body.appointmentId;
const [onA, onB] = await Promise.all([receive(ricardoA, withTag(`reserva-${appointmentId}`)), receive(ricardoB, withTag(`reserva-${appointmentId}`))]);
ok(Boolean(onA && onB), "los dos aparatos del propietario la reciben", push.received.length);
ok(
  onA?.payload?.body === `${whenText(booking.slot.date, booking.slot.startTime)} · ${dentalPage.service.name} · Ana M. · con Dra. Valeria Cruz`,
  "con varias agendas, el aviso dice de quién es («· con Dra. Valeria Cruz»)",
  onA?.payload,
);
ok(!push.received.some((item) => item.endpoint === adminDevice.endpoint && item.payload?.tag === `reserva-${appointmentId}`), "el super admin no recibe las reservas de los negocios");
r = await ricardo("PATCH", "/push/device", { endpoint: ricardoB.endpoint, mutedKinds: ["booking"] }, chromeMac);
ok(r.status === 200 && JSON.stringify(r.body.mutedKinds) === '["booking"]', "apaga «Reservas online» en un aparato", r.body);
booking = await dentalPage.book(person("Bruno Ernesto Castillo Vera"));
appointmentId = booking.body.appointmentId;
ok(Boolean(await receive(ricardoA, withTag(`reserva-${appointmentId}`))) && queuedFor(ricardoB, `reserva-${appointmentId}`) === 0, "ese aparato ya no la recibe; el otro sí");
r = await ricardo("PATCH", "/push/device", { endpoint: ricardoB.endpoint, mutedKinds: ["test"] });
const r3 = await ricardo("PATCH", "/push/device", { endpoint: ricardoB.endpoint, mutedKinds: ["new_business"] });
const r4 = await ricardo("PATCH", "/push/device", { endpoint: push.device().endpoint, mutedKinds: [] });
ok(r.status === 400 && r3.status === 400 && r4.status === 404, "el aviso de prueba no se apaga, un tipo de otro rol tampoco y un aparato ajeno: 404", [r.body, r3.body, r4.body]);
r = await ricardo("POST", "/push/device/off", { endpoint: ricardoB.endpoint }, chromeMac);
const again = await ricardo("POST", "/push/device/off", { endpoint: ricardoB.endpoint }, chromeMac);
ok(r.status === 204 && again.status === 204 && !deviceExists(ricardoB), "«Desactivar en este celular» lo borra (y un doble toque no da error)", [r.status, again.status]);

console.log("Auditoría de los avisos (todo lo que hace la persona queda en la actividad)");
type PushAuditRow = { action: string; summary: string; actorName: string; businessId: string | null; changes: string | null };
const pushAudit = (userId: string): PushAuditRow[] =>
  JSON.parse(
    sql(
      `select coalesce(json_agg(json_build_object('action', action, 'summary', summary, 'actorName', actor_name, 'businessId', business_id, 'changes', changes::text) order by created_at), '[]')
         from audit_logs where actor_id = '${userId}' and action like 'push.%'`,
    ),
  );
let ricardoAudit = pushAudit(ricardo.session.userId);
ok(
  ricardoAudit.filter((row) => row.action === "push.device_enabled").map((row) => row.summary).join(" | ") ===
    "Activó los avisos en el celular en un aparato | Activó los avisos en el celular en Chrome en Mac" &&
    ricardoAudit.every((row) => row.businessId === dental && row.actorName === "Ricardo Paredes"),
  "activar queda en la actividad del negocio, con el navegador («Chrome en Mac») o «un aparato»",
  ricardoAudit,
);
const kindsRow = ricardoAudit.filter((row) => row.action === "push.kinds_changed");
ok(
  kindsRow.length === 1 &&
    kindsRow[0].summary === "Cambió qué avisos llegan a Chrome en Mac" &&
    JSON.stringify(
      (JSON.parse(kindsRow[0].changes ?? "[]") as { label: string; before: string; after: string }[]).map(({ label, before, after }) => [label, before, after]),
    ) === JSON.stringify([["Reservas online", "Encendido", "Apagado"]]),
  "cambiar los tipos queda con cada interruptor («Reservas online: Encendido → Apagado»); los cambios rechazados, no",
  kindsRow,
);
ok(
  ricardoAudit.filter((row) => row.action === "push.device_disabled").map((row) => row.summary).join() === "Desactivó los avisos en el celular en Chrome en Mac",
  "desactivar queda una vez (el doble toque no repite)",
  ricardoAudit,
);
const enabledBefore = ricardoAudit.filter((row) => row.action === "push.device_enabled").length;
await activate(ricardo, ricardoA);
await ricardo("PATCH", "/push/device", { endpoint: ricardoA.endpoint, mutedKinds: [] });
ricardoAudit = pushAudit(ricardo.session.userId);
ok(
  ricardoAudit.filter((row) => row.action === "push.device_enabled").length === enabledBefore &&
    ricardoAudit.filter((row) => row.action === "push.kinds_changed").length === 1,
  "la puesta al día silenciosa al abrir el panel y un cambio que no cambia nada no llenan la actividad",
  ricardoAudit,
);
const ownerActivity = await ricardo("GET", `/businesses/${dental}/audit-logs?entityType=user`);
ok(
  ownerActivity.status === 200 &&
    JSON.stringify(ownerActivity.body).includes("Activó los avisos en el celular en Chrome en Mac") &&
    JSON.stringify(ownerActivity.body).includes("Desactivó los avisos en el celular en Chrome en Mac"),
  "el propietario lo ve en Actividad (Usuarios)",
  ownerActivity.status,
);
const adminAudit = pushAudit(admin.session.userId);
ok(
  adminAudit.length === 1 && adminAudit[0].action === "push.device_enabled" && adminAudit[0].businessId === null && adminAudit[0].actorName.endsWith("(Super admin)"),
  "los del super admin quedan en la actividad de la plataforma",
  adminAudit,
);
const laura = await as("laura@demo.com");
const lauraDevices: Device[] = [];
for (let i = 0; i < 11; i++) {
  const device = push.device();
  lauraDevices.push(device);
  await activate(laura, device);
}
ok(
  count(`select count(*) from push_subscriptions where user_id = '${laura.session.userId}'`) === 10 && !deviceExists(lauraDevices[0]) && deviceExists(lauraDevices[10]),
  "el undécimo aparato quita el más antiguo (hasta 10)",
);
const shared = lauraDevices[10];
await laura("PATCH", "/push/device", { endpoint: shared.endpoint, mutedKinds: ["unclosed"] });
const tomas = await as("tomas@demo.com");
r = await activate(tomas, shared);
ok(
  r.status === 200 && r.body.mutedKinds.length === 0 && sql(`select user_id from push_subscriptions where endpoint = '${shared.endpoint}'`) === tomas.session.userId,
  "la misma dirección guardada por otra persona pasa a ella, con los tipos de fábrica",
  r.body,
);
r = await activate(laura, lauraDevices[9]);
ok(r.status === 200 && count(`select count(*) from push_subscriptions where user_id = '${laura.session.userId}'`) === 9, "volver a guardar el mismo aparato no suma otro");

/* ======================================================================================== */
console.log("Reserva online (R8)");
const jhordanPage = await bookingPage(jhordanBusiness);
const jhordanDevice = push.device();
await activate(jhordan, jhordanDevice);
const juan = person("Juan Pérez López");
booking = await jhordanPage.book(juan);
appointmentId = booking.body.appointmentId;
const bookingPush = await receive(jhordanDevice, withTag(`reserva-${appointmentId}`));
ok(
  bookingPush?.payload?.title === "Nueva reserva" &&
    bookingPush.payload.body === `${whenText(booking.slot.date, booking.slot.startTime)} · ${jhordanPage.service.name} · Juan P.`,
  "«Nueva reserva · {día} {hora} · {servicio} · Juan P.» (con una sola agenda, sin «· con …»)",
  bookingPush?.payload,
);
ok(
  bookingPush?.payload?.url === `/dashboard/calendar?date=${booking.slot.date}&appointment=${appointmentId}` && bookingPush.payload.kind === "booking",
  "al tocarlo abre la cita en la agenda",
  bookingPush?.payload,
);
ok(
  bookingPush?.headers.urgency === "high" &&
    bookingPush.headers.contentEncoding === "aes128gcm" &&
    Number(bookingPush.headers.ttl) > 86_000 &&
    Number(bookingPush.headers.ttl) <= 86_400 &&
    /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/.test(bookingPush.headers.authorization ?? ""),
  "va cifrado (aes128gcm), firmado con VAPID, urgente y con 24 h de vida",
  bookingPush?.headers,
);
const retry = await visitor()("POST", `/public/businesses/${jhordanPage.slug}/bookings`, {
  serviceId: jhordanPage.service.id,
  professionalId: jhordanPage.professional.id,
  ...booking.slot,
  notes: SECRET_NOTE,
  ...juan,
  extraPatients: [],
});
await sleep(1500);
ok(retry.body.appointmentId === appointmentId && queuedFor(jhordanDevice, `reserva-${appointmentId}`) === 1, "un reintento de la misma reserva no avisa otra vez", retry.body);
const real = person("Rosa Elvira Real Montes");
sql(
  `insert into clients (business_id, name, document_id, email, phone) values ('${jhordanBusiness}', '${real.name}', '${real.documentId}', '${real.email}', '${real.phone}')`,
);
const claimer = { ...person("Otra Persona Distinta"), documentId: real.documentId };
booking = await jhordanPage.book(claimer);
const verifyPush = await receive(jhordanDevice, withTag(`reserva-${booking.body.appointmentId}`));
ok(/ · Otra P\. · Por verificar$/.test(verifyPush?.payload?.body ?? ""), "una reserva «Por verificar» (spec 009) lo dice", verifyPush?.payload);
ok(!(verifyPush?.payload?.body ?? "").includes("Rosa"), "sin nada de la ficha de la cédula", verifyPush?.payload);

// Sesión en pareja (specs 004 y 005): un servicio para 2 en un negocio con el interruptor del super admin.
sql(`update businesses set multi_client_appointments = true where id = '${jhordanBusiness}'`);
const coupleService = sql(
  `insert into services (business_id, name, duration_minutes, price, people_per_session) values ('${jhordanBusiness}', 'Terapia de pareja', 60, 40, 2) returning id`,
).split("\n")[0];
const coupleSlot = await jhordanPage.freeSlot(3, 60);
const partner = person("Luis Ramírez Soto");
r = await visitor()("POST", `/public/businesses/${jhordanPage.slug}/bookings`, {
  serviceId: coupleService,
  professionalId: jhordanPage.professional.id,
  ...coupleSlot,
  notes: "",
  ...person("Carla Mena Ortiz"),
  extraPatients: [partner],
});
const couplePush = r.status === 200 ? await receive(jhordanDevice, withTag(`reserva-${r.body.appointmentId}`)) : undefined;
ok(
  couplePush?.payload?.body === `${whenText(coupleSlot.date, coupleSlot.startTime)} · Terapia de pareja · Carla M. y Luis R.`,
  "una sesión en pareja: un solo aviso con las dos personas a medias",
  [couplePush?.payload, r.status, push.to(jhordanDevice.endpoint).slice(-2).map((item) => item.payload)],
);
sql(`update services set is_active = false where id = '${coupleService}'`);

/* ======================================================================================== */
console.log("Comprobante de pago (R9) y cancelación del paciente (spec 010, R10)");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const paidBooking = await jhordanPage.book(person("Pedro Pablo Andrade Lugo"));
const paidId: string = paidBooking.body.appointmentId;
const payToken: string = paidBooking.body.payment?.token;
const payer = visitor();
const uploadReceipt = async () => {
  const request = await payer("POST", `/public/payments/${payToken}/receipts`, { fileName: "transferencia.png", contentType: "image/png", sizeBytes: PNG.length });
  if (request.status !== 200) return request;
  await fetch(ORIGIN + request.body.upload.url, { method: "PUT", headers: request.body.upload.headers, body: PNG });
  return payer("POST", `/public/payments/${payToken}/receipts/${request.body.receipt.id}/complete`);
};
r = await uploadReceipt();
const receiptPush = await receive(jhordanDevice, withTag(`comprobante-${paidId}`));
ok(
  r.status === 200 && receiptPush?.payload?.title === "Comprobante de pago" &&
    receiptPush.payload.body === `Pedro P. · ${whenText(paidBooking.slot.date, paidBooking.slot.startTime)}`,
  "«Comprobante de pago · Pedro P. · {día} {hora}»",
  [r.status, receiptPush?.payload],
);
r = await uploadReceipt();
await sleep(1500);
ok(r.status === 409 && queuedFor(jhordanDevice, `comprobante-${paidId}`) === 1, "una segunda subida descartada no avisa", r.body);
r = await visitor()("POST", `/public/appointments/${payToken}/confirm`);
const confirmPush = r.status === 200 ? await receive(jhordanDevice, (payload) => payload.tag?.startsWith(`confirmo-${paidId}-`) ?? false) : undefined;
ok(
  confirmPush?.payload?.title === "El paciente confirmó" &&
    confirmPush.payload.body === `${whenText(paidBooking.slot.date, paidBooking.slot.startTime)} · Pedro P.` &&
    confirmPush.payload.url === `/dashboard/calendar?date=${paidBooking.slot.date}&appointment=${paidId}`,
  "«Confirmo que voy»: «El paciente confirmó · {día} {hora} · Pedro P.», que abre la cita",
  [r.status, r.body, confirmPush?.payload],
);
r = await visitor()("POST", `/public/appointments/${payToken}/confirm`);
await sleep(1500);
ok(
  r.body?.already === true &&
    count(`select count(*) from push_messages where kind = 'patient_confirm' and tag like 'confirmo-${paidId}-%'`) === 1,
  "confirmar otra vez no repite el aviso",
  r.body,
);
r = await visitor()("POST", `/public/appointments/${payToken}/cancel`);
const cancelPush = await receive(jhordanDevice, withTag(`cancelada-${paidId}`));
ok(
  r.status === 200 && cancelPush?.payload?.title === "Cita cancelada por el paciente" &&
    cancelPush.payload.body === `${whenText(paidBooking.slot.date, paidBooking.slot.startTime)} · Pedro P.`,
  "«Cita cancelada por el paciente · {día} {hora} · Pedro P.»",
  [r.status, r.body, cancelPush?.payload],
);
r = await visitor()("POST", `/public/appointments/${payToken}/cancel`);
await sleep(1500);
ok(r.body?.already === true && queuedFor(jhordanDevice, `cancelada-${paidId}`) === 1, "un doble toque no repite", r.body);

/* ======================================================================================== */
console.log("Cita nueva en la agenda del propietario (R11)");
const elena = await as("elena@demo.com");
const agendas = (await ricardo("GET", `/businesses/${dental}/professionals`)).body as { id: string; displayName: string; userId: string | null }[];
const ricardoAgenda = agendas.find((agenda) => agenda.userId === ricardo.session.userId)!;
const valeriaAgenda = agendas.find((agenda) => agenda.displayName === "Dra. Valeria Cruz")!;
const dentalService = sql(`select id from services where business_id = '${dental}' and is_active order by created_at limit 1`);
const patientRow = (name: string) => {
  const who = person(name);
  return sql(
    `insert into clients (business_id, name, document_id, email, phone) values ('${dental}', '${who.name}', '${who.documentId}', '${who.email}', '${who.phone}') returning id`,
  ).split("\n")[0];
};
const juanDental = patientRow("Juan Pérez Guzmán");
const tomorrow = addDaysISO(getZonedNow("America/Guayaquil").date, 1);
let late = 21 * 60;
const newAppointment = (browser: Browser, professionalId: string, date = tomorrow) => {
  const startTime = `${String(Math.floor(late / 60)).padStart(2, "0")}:${String(late % 60).padStart(2, "0")}`;
  late += 30;
  return browser("POST", `/businesses/${dental}/appointments`, {
    clientId: juanDental,
    serviceId: dentalService,
    professionalId,
    date,
    startTime,
    durationMinutes: 30,
    price: 20,
    status: "confirmed",
    notes: SECRET_NOTE,
    homeVisit: null,
    isVirtual: false,
  });
};
r = await newAppointment(elena, ricardoAgenda.id);
const newPush = r.status === 200 ? await receive(ricardoA, withTag(`cita-nueva-${r.body.id}`)) : undefined;
ok(
  newPush?.payload?.title === "Cita nueva en tu agenda" && newPush.payload.body === `Mañana ${r.body.startTime} · Juan P.`,
  "Recepción le agenda una cita: «Cita nueva en tu agenda · Mañana {hora} · Juan P.»",
  [r.status, r.body?.error, newPush?.payload],
);
r = await newAppointment(ricardo, ricardoAgenda.id);
ok(r.status === 200 && queuedFor(ricardoA, `cita-nueva-${r.body.id}`) === 0, "si la agenda él mismo, no", r.body?.error);
r = await newAppointment(elena, valeriaAgenda.id);
ok(r.status === 200 && queuedFor(ricardoA, `cita-nueva-${r.body.id}`) === 0, "en la agenda de otro profesional, no", r.body?.error);
r = await newAppointment(admin, ricardoAgenda.id);
const supportPush = r.status === 200 ? await receive(ricardoA, withTag(`cita-nueva-${r.body.id}`)) : undefined;
ok(Boolean(supportPush) && queuedFor(adminDevice, `cita-nueva-${r.body.id}`) === 0, "el super admin en modo soporte la agenda: le llega al propietario y no al super admin", r.body?.error);

// Una serie de la spec 011 (el enganche notifyNewSeries): 8 citas, un solo aviso.
const firstSeriesDate = addDaysISO(tomorrow, 20);
const series: Pick<Appointment, "id" | "businessId" | "date" | "startTime">[] = [];
for (let week = 7; week >= 0; week--) {
  const date = addDaysISO(firstSeriesDate, week * 7);
  const id = sql(
    `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source)
     values ('${dental}', '${juanDental}', '${dentalService}', '${ricardoAgenda.id}', '${date}', '06:10', '06:40', 'confirmed', 20, 'dashboard') returning id`,
  ).split("\n")[0];
  series.push({ id, businessId: dental, date, startTime: "06:10" });
}
const queuedSeries = await transaction((db) => notices.notifyNewSeries(db, series, elena.session.userId));
await delivery.processPushQueue();
const firstId = series.find((item) => item.date === firstSeriesDate)!.id;
const seriesPush = push.to(ricardoA.endpoint).filter((item) => item.payload?.title === "Citas nuevas en tu agenda");
ok(
  queuedSeries === 1 && seriesPush.length === 1 && seriesPush[0].payload?.body === `8 citas desde el ${formatShortDate(firstSeriesDate)} 06:10 · Juan P.`,
  "una serie de 8: un solo «Citas nuevas en tu agenda · 8 citas desde el {día} {hora} · Juan P.»",
  [queuedSeries, seriesPush.map((item) => item.payload)],
);
ok(seriesPush[0]?.payload?.url === `/dashboard/calendar?date=${firstSeriesDate}&appointment=${firstId}`, "y abre la primera", seriesPush[0]?.payload);
ok((await transaction((db) => notices.notifyNewSeries(db, series, ricardo.session.userId))) === 0, "una serie que agenda el propio propietario no avisa");
// Y por la ruta de la serie: Recepción le agenda 4 citas semanales (un miércoles, a las 11:00).
let seriesStart = addDaysISO(tomorrow, 90);
while (new Date(`${seriesStart}T12:00:00Z`).getUTCDay() !== 3) seriesStart = addDaysISO(seriesStart, 1);
const seriesBody = {
  appointment: {
    clientId: juanDental,
    extraClientIds: [],
    serviceId: dentalService,
    professionalId: ricardoAgenda.id,
    date: seriesStart,
    startTime: "11:00",
    durationMinutes: 30,
    price: 20,
    status: "confirmed",
    notes: SECRET_NOTE,
    homeVisit: null,
    isVirtual: false,
  },
  repeat: { frequency: "weekly", count: 4 },
};
r = await elena("POST", `/businesses/${dental}/appointment-series/preview`, seriesBody);
const seriesDates = r.status === 200
  ? (r.body.dates as { date: string; startTime: string; status: string; freeTimes: string[] }[]).flatMap((row) =>
      row.status === "free" ? [{ date: row.date, startTime: row.startTime }] : row.freeTimes.length > 0 ? [{ date: row.date, startTime: row.freeTimes[0] }] : [],
    )
  : [];
r = await elena("POST", `/businesses/${dental}/appointment-series`, { ...seriesBody, dates: seriesDates });
const viaRoute = (r.status === 201 ? r.body.created : []) as Appointment[];
const [routeFirst] = [...viaRoute].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
ok(
  viaRoute.length >= 2 &&
    queuedFor(ricardoA, `cita-nueva-${routeFirst.id}`) === 1 &&
    viaRoute.every((appointment) => appointment === routeFirst || queuedFor(ricardoA, `cita-nueva-${appointment.id}`) === 0),
  "la serie creada desde el panel (spec 011) deja un solo aviso en la cola",
  [r.status, r.body?.error, viaRoute.length],
);

/* ======================================================================================== */
console.log("Propietario que cambia y negocio sin propietario (RF-009)");
sql(`update businesses set owner_id = (select id from users where email = 'andrea@demo.com') where id = '${jhordanBusiness}'`);
booking = await jhordanPage.book(person("Marta Lucía Ibarra Paz"));
ok(booking.status === 200 && queuedFor(jhordanDevice, `reserva-${booking.body.appointmentId}`) === 0, "los aparatos de quien deja de ser propietario no reciben nada");
sql(`update businesses set owner_id = '${jhordan.session.userId}' where id = '${jhordanBusiness}'`);
const created = await admin(
  "POST",
  "/admin/businesses",
  businessInput({
    name: `Sin Dueno ${tag}`,
    slug: `sin-dueno-${tag}`,
    plan: "business",
    schedules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, isActive: true, intervals: [{ start: "08:00", end: "20:00" }] })),
  }),
);
if (created.status !== 200) console.log("  ! alta del negocio sin propietario:", JSON.stringify(created.body));
const orphan: string = created.body.business.id;
ok(created.status === 200 && count(`select count(*) from businesses where id = '${orphan}' and owner_id is null`) === 1, "un negocio sin propietario (alta del super admin)", created.body);
const orphanPage = await bookingPage(orphan);
const messagesBefore = count("select count(*) from push_messages");
booking = await orphanPage.book(person("Nora Isabel Tapia Ruiz"));
ok(booking.status === 200 && count("select count(*) from push_messages") === messagesBefore, "una reserva no avisa a nadie (tampoco al super admin)", booking.body);
r = await admin("POST", `/admin/businesses/${orphan}/owner`, { firstName: "Olga", lastName: "Nueva", email: `olga.${tag}@correo.ec`, password: "demo1234" });
ok(r.status === 200, "el super admin le asigna propietario", r.body);
const olga = await as(`olga.${tag}@correo.ec`);
const olgaDevice = push.device();
ok((await activate(olga, olgaDevice)).status === 200, "la nueva propietaria activa sus avisos");
booking = await orphanPage.book(person("Pablo Andrés Ochoa Vélez"));
ok(Boolean(await receive(olgaDevice, withTag(`reserva-${booking.body.appointmentId}`))), "y la siguiente reserva le llega a ella");

/* ======================================================================================== */
console.log("Cerrar sesión pausa el aparato (R3)");
const jhordanOther = await as("jhordan@demo.com");
const shared2 = push.device();
await activate(jhordanOther, shared2);
await jhordanOther("PATCH", "/push/device", { endpoint: shared2.endpoint, mutedKinds: ["unclosed"] });
r = await jhordanOther("POST", "/auth/logout");
ok(r.status === 204 && count(`select count(*) from push_subscriptions where endpoint = '${shared2.endpoint}' and signed_out_at is not null`) === 1, "«Cerrar sesión» pausa los aparatos activados desde esa sesión");
booking = await jhordanPage.book(person("Raúl Esteban Cordero Lima"));
ok(
  Boolean(await receive(jhordanDevice, withTag(`reserva-${booking.body.appointmentId}`))) && queuedFor(shared2, `reserva-${booking.body.appointmentId}`) === 0,
  "una reserva no le llega al aparato en pausa (sí al otro, con su sesión abierta)",
  [booking.status, booking.body?.error, queuedFor(jhordanDevice, `reserva-${booking.body?.appointmentId}`), queuedFor(shared2, `reserva-${booking.body?.appointmentId}`)],
);
const jhordanBack = await as("jhordan@demo.com");
r = await activate(jhordanBack, shared2);
ok(r.status === 200 && JSON.stringify(r.body.mutedKinds) === '["unclosed"]', "al volver a entrar y guardar la misma dirección se reanuda con sus tipos", r.body);
booking = await jhordanPage.book(person("Sofía Inés Valdez Mora"));
ok(Boolean(await receive(shared2, withTag(`reserva-${booking.body.appointmentId}`))), "y vuelve a recibir", [booking.status, booking.body?.error]);

/* ======================================================================================== */
console.log("Aviso de prueba");
r = await jhordan("POST", "/push/device/test", { endpoint: jhordanDevice.endpoint });
const testPush = await receive(jhordanDevice, withTag("prueba"), 1000);
ok(
  r.status === 200 && r.body.sent === true && testPush?.payload?.title === "Avisos activados" &&
    testPush.payload.body === "Listo: aquí te avisaremos de las reservas." && testPush.payload.url === "/dashboard",
  "«Listo: aquí te avisaremos de las reservas.» al momento (sin cola)",
  [r.body, testPush?.payload],
);
r = await admin("POST", "/push/device/test", { endpoint: adminDevice.endpoint });
const adminTest = await receive(adminDevice, withTag("prueba"), 1000);
ok(r.status === 200 && adminTest?.payload?.body === "Listo: aquí te avisaremos de lo importante de la plataforma." && adminTest.payload.url === "/admin", "el del super admin abre /admin", adminTest?.payload);
ok(
  pushAudit(jhordan.session.userId).filter((row) => row.action === "push.test_sent" && row.businessId === jhordanBusiness).length === 1 &&
    pushAudit(admin.session.userId).filter((row) => row.action === "push.test_sent" && row.businessId === null).length === 1,
  "el aviso de prueba también queda en la actividad (del negocio y de la plataforma)",
  [pushAudit(jhordan.session.userId), pushAudit(admin.session.userId)],
);
/** Un aparato guardado hace 10 minutos (no «recién activado»). */
const ageDevice = (device: Device) => sql(`update push_subscriptions set updated_at = now() - interval '10 minutes' where endpoint = '${device.endpoint}'`);
const goneDevice = push.device();
await activate(jhordan, goneDevice);
ageDevice(goneDevice);
push.always(goneDevice.endpoint, 410);
r = await jhordan("POST", "/push/device/test", { endpoint: goneDevice.endpoint });
ok(r.status === 409 && r.body.error.message === "Este aparato ya no recibe avisos. Vuelve a activarlos." && !deviceExists(goneDevice), "con el servicio respondiendo 410: 409 y el aparato se borra", r.body);
// Recién activado: Google a veces responde 410 en los primeros segundos y después lo acepta.
const justActivated = push.device();
await activate(jhordan, justActivated);
push.respond(justActivated.endpoint, 410);
const testStarted = Date.now();
r = await jhordan("POST", "/push/device/test", { endpoint: justActivated.endpoint });
ok(
  r.status === 200 && push.to(justActivated.endpoint).map((item) => item.status).join() === "410,201" && deviceExists(justActivated) && Date.now() - testStarted >= 2900,
  "recién activado, un 410 se reintenta a los 3 s: llega y el aparato sigue",
  [r.status, push.to(justActivated.endpoint).map((item) => item.status)],
);
const stillGone = push.device();
await activate(jhordan, stillGone);
push.always(stillGone.endpoint, 410);
r = await jhordan("POST", "/push/device/test", { endpoint: stillGone.endpoint });
ok(r.status === 502 && r.body.error.code === "push_failed" && deviceExists(stillGone), "si sigue con 410 recién activado: 502 y no se borra todavía", r.body);
await jhordan("POST", "/push/device/off", { endpoint: stillGone.endpoint });
const brokenDevice = push.device();
await activate(jhordan, brokenDevice);
push.respond(brokenDevice.endpoint, 500);
r = await jhordan("POST", "/push/device/test", { endpoint: brokenDevice.endpoint });
ok(r.status === 502 && r.body.error.code === "push_failed" && deviceExists(brokenDevice), "con un 500: 502 push_failed y el aparato sigue", r.body);
await jhordan("POST", "/push/device/off", { endpoint: brokenDevice.endpoint });

/* ======================================================================================== */
console.log("Respuestas del servicio de avisos (R6)");
const vanished = push.device();
await activate(jhordan, vanished);
ageDevice(vanished);
push.always(vanished.endpoint, 410);
booking = await jhordanPage.book(person("Teresa Gabriela Núñez Rey"));
ok(booking.status === 200 && (await until(() => !deviceExists(vanished))), "410: el aparato se borra solo (RF-008) y la reserva respondió 200 igual", booking.status);
const newcomer = push.device();
await activate(jhordan, newcomer);
push.respond(newcomer.endpoint, 410);
booking = await jhordanPage.book(person("Wendy Paola Suárez Ríos"));
const newcomerTag = `reserva-${booking.body.appointmentId}`;
// Con su motivo (last_error): el primer intento ya terminó. «queued|1» solo también se ve mientras la API lo
// tiene reservado y aún no lo envió, y entonces el reintento de abajo se cruzaba con él (2026-10-22).
ok(
  (await until(
    () =>
      sql(
        `select m.status || '|' || m.attempts || '|' || (m.last_error is not null) from push_messages m join push_subscriptions s on s.id = m.subscription_id where s.endpoint = '${newcomer.endpoint}' and m.tag = '${newcomerTag}'`,
      ) === "queued|1|true",
  )) && deviceExists(newcomer),
  "un aparato recién activado con un 410 no se borra: el aviso queda para reintentar",
);
sql(`update push_messages set next_attempt_at = now() where tag = '${newcomerTag}'`);
await delivery.processPushQueue();
ok(Boolean(push.to(newcomer.endpoint).find((item) => item.status === 201 && item.payload?.tag === newcomerTag)), "y el reintento llega");
await jhordan("POST", "/push/device/off", { endpoint: newcomer.endpoint });
const flaky = push.device();
await activate(jhordan, flaky);
push.respond(flaky.endpoint, 500);
booking = await jhordanPage.book(person("Ulises Fernando Paz Lara"));
const flakyTag = `reserva-${booking.body.appointmentId}`;
const retrying = await until(
  () =>
    sql(
      `select m.status || '|' || m.attempts || '|' || (m.next_attempt_at > now()) || '|' || coalesce(m.last_error, '')
         from push_messages m join push_subscriptions s on s.id = m.subscription_id
        where s.endpoint = '${flaky.endpoint}' and m.tag = '${flakyTag}'`,
    ).startsWith("queued|1|true|Respondió 500"),
);
ok(retrying, "500: el aviso queda en cola para reintentar (al minuto)", sql(`select status, attempts, last_error from push_messages m join push_subscriptions s on s.id = m.subscription_id where s.endpoint = '${flaky.endpoint}'`));
sql(`update push_messages set next_attempt_at = now() where tag = '${flakyTag}'`);
let report = await delivery.processPushQueue();
ok(
  report.sent >= 1 && Boolean(push.to(flaky.endpoint).find((item) => item.status === 201 && item.payload?.tag === flakyTag)) &&
    count(`select count(*) from push_messages where tag = '${flakyTag}' and status = 'sent'`) >= 1,
  "y el reintento sale",
  report,
);
const refused = push.device();
await activate(jhordan, refused);
push.always(refused.endpoint, 403);
const refusedId = sql(`select id from push_subscriptions where endpoint = '${refused.endpoint}'`);
for (let i = 0; i < 5; i++) {
  sql(`insert into push_messages (subscription_id, kind, title, body, url, tag) values ('${refusedId}', 'booking', 'Prueba', 'Prueba', '/dashboard', 'rechazo-${i}')`);
}
report = await delivery.processPushQueue();
ok(!deviceExists(refused) && report.failed >= 5 && report.removedDevices >= 1, "403 cinco veces seguidas: el aparato se borra", report);
ok(report.errors.some((error) => error === "127.0.0.1, 403") && !report.errors.some((error) => error.includes("/aparato")), "el informe dice el servicio y el código, nunca la dirección", report.errors);
const stale = push.device();
await activate(jhordan, stale);
sql(
  `insert into push_messages (subscription_id, kind, title, body, url, tag, created_at, expires_at)
   select id, 'booking', 'Vieja', 'Vieja', '/dashboard', 'caducada', now() - interval '25 hours', now() - interval '1 hour' from push_subscriptions where endpoint = '${stale.endpoint}'`,
);
report = await delivery.processPushQueue();
ok(
  sql(`select status || '|' || last_error from push_messages where tag = 'caducada'`) === "failed|Caducó: no salió en 24 horas." && push.to(stale.endpoint).length === 0,
  "un aviso de más de 24 h queda «Caducó» y no se envía",
  report,
);
// La limpieza del cron (cleanupPush): los avisos de más de 7 días y los aparatos en pausa hace más de 90.
sql(`update push_messages set created_at = now() - interval '8 days' where tag = 'caducada'`);
const recentMessages = count("select count(*) from push_messages where created_at >= now() - interval '7 days'");
const pausedOld = push.device();
const pausedRecent = push.device();
await activate(jhordan, pausedOld);
await activate(jhordan, pausedRecent);
sql(`update push_subscriptions set signed_out_at = now() - interval '91 days' where endpoint = '${pausedOld.endpoint}'`);
sql(`update push_subscriptions set signed_out_at = now() - interval '89 days' where endpoint = '${pausedRecent.endpoint}'`);
const cleaned = await delivery.cleanupPush();
ok(
  count("select count(*) from push_messages where tag = 'caducada'") === 0 &&
    count("select count(*) from push_messages where created_at >= now() - interval '7 days'") === recentMessages &&
    cleaned.messages >= 1,
  "la limpieza borra los avisos de más de 7 días y deja los recientes",
  cleaned,
);
ok(!deviceExists(pausedOld) && deviceExists(pausedRecent) && cleaned.devices === 1, "y los aparatos en pausa hace más de 90 días (el de 89 se queda)", cleaned);

/* ======================================================================================== */
console.log("Nunca rompe la reserva (RF-011)");
const other = await startApi({});
sql("alter table push_messages rename to push_messages_aparte");
let broken: Awaited<ReturnType<typeof jhordanPage.book>>;
try {
  broken = await jhordanPage.book(person("Valentina Sofía Ortega Cano"), {}, other.base);
} finally {
  sql("alter table push_messages_aparte rename to push_messages");
}
ok(broken.status === 200 && count(`select count(*) from appointments where id = '${broken.body.appointmentId}'`) === 1, "sin la tabla de avisos (como si faltara la migración) la reserva responde 200 y la cita queda", broken.body);
ok(count(`select count(*) from notifications where appointment_id = '${broken.body.appointmentId}'`) > 0, "con sus emails en la cola");
await sleep(300);
ok(/\[avisos\] No se pudo poner en cola el aviso en el celular \(booking\)/.test(other.output()), "el registro dice que el aviso no se pudo poner en cola", other.output().slice(-500));
other.stop();

/* ======================================================================================== */
console.log("Citas por cerrar (cron, R12)");
const madridCreated = await createBusinessWithOwner(
  admin,
  { name: `Madrid ${tag}`, category: "beauty", slug: `madrid-${tag}`, timezone: "Europe/Madrid", plan: "business" },
  { firstName: "Mercedes", lastName: "Madrid", email: `mercedes.${tag}@correo.ec`, password: "demo1234" },
);
const madrid: string = madridCreated.body.business.id;
const mercedes = await as(`mercedes.${tag}@correo.ec`);
const madridDevice = push.device();
await activate(mercedes, madridDevice);
const businessParts = (businessId: string) => {
  const [service, professional] = sql(
    `select (select id from services where business_id = '${businessId}' order by created_at limit 1) || '|' ||
            (select id from professionals where business_id = '${businessId}' order by created_at limit 1)`,
  ).split("|");
  const who = person("Juan Pérez Mejía");
  const client = sql(
    `insert into clients (business_id, name, document_id, email, phone) values ('${businessId}', '${who.name}', '${who.documentId}', '${who.email}', '${who.phone}') returning id`,
  ).split("\n")[0];
  return { service, professional, client };
};
const orphanParts = businessParts(orphan);
const madridParts = businessParts(madrid);
const appointmentAt = (businessId: string, parts: typeof orphanParts, date: string, start: string, end: string, status = "confirmed") =>
  sql(
    `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source)
     values ('${businessId}', '${parts.client}', '${parts.service}', '${parts.professional}', '${date}', '${start}', '${end}', '${status}', 25, 'dashboard') returning id`,
  ).split("\n")[0];
/** El instante (ISO) de una hora de pared en una zona. */
const instant = (date: string, time: string, zone: string) =>
  new Date(sql(`select to_char(((date '${date}' + time '${time}') at time zone '${zone}') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`)).toISOString();
const GYE = "America/Guayaquil";
const orphanService = sql(`select name from services where id = '${orphanParts.service}'`);
const day1 = addDaysISO(getZonedNow(GYE).date, 30);
const due = appointmentAt(orphan, orphanParts, day1, "10:00", "10:30");
const closedEarly = appointmentAt(orphan, orphanParts, day1, "10:30", "11:00");
sql(`update appointments set status = 'completed' where id = '${closedEarly}'`);
let queued = await notices.queueUnclosedNotices(instant(day1, "10:55", GYE), instant(day1, "11:05", GYE));
await delivery.processPushQueue();
const unclosedPush = push.to(olgaDevice.endpoint).find((item) => item.payload?.tag === `por-cerrar-${due}`);
ok(
  queued === 1 && unclosedPush?.payload?.title === "Cita por cerrar" &&
    unclosedPush.payload.body === `10:00 · ${orphanService} · Juan P.: márcala Completada o No asistió`,
  "una cita Confirmada que terminó hace 30 min: «Cita por cerrar · 10:00 · {servicio} · Juan P.: márcala Completada o No asistió»",
  [queued, unclosedPush?.payload],
);
ok(unclosedPush?.payload?.url === `/dashboard/calendar?date=${day1}&appointment=${due}` && unclosedPush.headers.urgency === "normal", "abre la cita (con sus botones de estado), sin urgencia", unclosedPush?.payload);
ok((await notices.queueUnclosedNotices(instant(day1, "10:55", GYE), instant(day1, "11:05", GYE))) === 0, "un reintento de la misma pasada no duplica");
ok((await notices.queueUnclosedNotices(instant(day1, "11:05", GYE), instant(day1, "11:35", GYE))) === 0, "en la pasada siguiente no se repite, y la que se cerró antes no avisa");
const day2 = addDaysISO(day1, 1);
const oldOne = appointmentAt(orphan, orphanParts, day2, "12:00", "12:30");
const recent = appointmentAt(orphan, orphanParts, day2, "16:00", "16:30");
queued = await notices.queueUnclosedNotices(instant(day2, "12:00", GYE), instant(day2, "18:00", GYE));
ok(
  queued === 1 && queuedFor(olgaDevice, `por-cerrar-${recent}`) === 1 && queuedFor(olgaDevice, `por-cerrar-${oldOne}`) === 0,
  "con el cron parado 6 h, sólo avisan las de las últimas 3 h",
  queued,
);
const day3 = addDaysISO(day1, 2);
const midnight = appointmentAt(orphan, orphanParts, day3, "23:15", "23:45");
queued = await notices.queueUnclosedNotices(instant(addDaysISO(day3, 1), "00:10", GYE), instant(addDaysISO(day3, 1), "00:20", GYE));
await delivery.processPushQueue();
ok(
  queued === 1 && push.to(olgaDevice.endpoint).find((item) => item.payload?.tag === `por-cerrar-${midnight}`)?.payload?.body.startsWith("23:15 · "),
  "una que termina a las 23:45 avisa a las 00:15 del día siguiente",
  queued,
);
await olga("PATCH", "/push/device", { endpoint: olgaDevice.endpoint, mutedKinds: ["unclosed"] });
const muted = appointmentAt(orphan, orphanParts, day3, "09:00", "09:30");
ok((await notices.queueUnclosedNotices(instant(day3, "09:55", GYE), instant(day3, "10:05", GYE))) === 0 && queuedFor(olgaDevice, `por-cerrar-${muted}`) === 0, "con «Citas por cerrar» apagado, no llega");

console.log("Resumen de las 8 de la noche (cron, R13)");
await olga("PATCH", "/push/device", { endpoint: olgaDevice.endpoint, mutedKinds: ["unclosed"] }); // el resumen sigue encendido
const day4 = addDaysISO(day1, 3);
appointmentAt(orphan, orphanParts, day4, "09:00", "10:00");
appointmentAt(orphan, orphanParts, day4, "11:00", "12:00", "pending");
appointmentAt(orphan, orphanParts, day4, "13:00", "14:00", "completed");
appointmentAt(orphan, orphanParts, day4, "20:00", "20:30");
appointmentAt(madrid, madridParts, day4, "09:00", "10:00");
const gyeEight = instant(day4, "20:00", GYE);
const madridEight = instant(day4, "20:00", "Europe/Madrid");
const plus = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();
queued = await notices.queueEveningSummaries(plus(gyeEight, -5), plus(gyeEight, 5));
const madridQueuedEarly = queuedFor(madridDevice, `resumen-${day4}`);
queued += await notices.queueEveningSummaries(plus(madridEight, -5), plus(madridEight, 5));
await delivery.processPushQueue();
const gyeSummary = push.to(olgaDevice.endpoint).find((item) => item.payload?.tag === `resumen-${day4}`);
const madridSummary = push.to(madridDevice.endpoint).find((item) => item.payload?.tag === `resumen-${day4}`);
ok(
  gyeSummary?.payload?.title === "Tienes 2 citas de hoy sin cerrar" &&
    gyeSummary.payload.body === "Márcalas Completada o No asistió para que la agenda y los reportes cuadren." &&
    gyeSummary.payload.url === `/dashboard/calendar?date=${day4}`,
  "Guayaquil, a sus 20:00: «Tienes 2 citas de hoy sin cerrar» (la que termina a las 20:30 y la completada no cuentan)",
  gyeSummary?.payload,
);
ok(madridQueuedEarly === 0 && madridSummary?.payload?.title === "Tienes 1 cita de hoy sin cerrar", "Madrid, a las 20:00 de Madrid (y no a las de Guayaquil): «Tienes 1 cita de hoy sin cerrar»", madridSummary?.payload);
ok(madridSummary?.payload?.body.startsWith("Márcala Completada"), "en singular");
ok(
  (await notices.queueEveningSummaries(plus(gyeEight, -5), plus(gyeEight, 5))) === 0 &&
    (await notices.queueEveningSummaries(plus(gyeEight, 5), plus(gyeEight, 15))) === 0,
  "una sola vez por día",
);
const day5 = addDaysISO(day1, 4);
appointmentAt(orphan, orphanParts, day5, "09:00", "10:00", "completed");
await notices.queueEveningSummaries(plus(instant(day5, "20:00", GYE), -5), plus(instant(day5, "20:00", GYE), 5));
ok(queuedFor(olgaDevice, `resumen-${day5}`) === 0, "con 0 citas sin cerrar no sale nada");
await olga("PATCH", "/push/device", { endpoint: olgaDevice.endpoint, mutedKinds: ["evening_summary"] });
const day6 = addDaysISO(day1, 5);
appointmentAt(orphan, orphanParts, day6, "09:00", "10:00");
await notices.queueEveningSummaries(plus(instant(day6, "20:00", GYE), -5), plus(instant(day6, "20:00", GYE), 5));
const unclosedStillOn = appointmentAt(orphan, orphanParts, day6, "11:00", "11:30");
await notices.queueUnclosedNotices(instant(day6, "11:55", GYE), instant(day6, "12:05", GYE));
ok(
  queuedFor(olgaDevice, `resumen-${day6}`) === 0 && queuedFor(olgaDevice, `por-cerrar-${unclosedStillOn}`) === 1,
  "con «Resumen de las 8» apagado no llega, y «Citas por cerrar» sigue llegando",
);

/* ======================================================================================== */
console.log("El resumen de las 8 en el celular de cada profesional (spec 017)");
const valeria = await as("valeria@demo.com");
r = await valeria("GET", "/push/config");
ok(
  r.status === 200 && r.body.available === true && JSON.stringify(r.body.kinds) === JSON.stringify(AGENDA_PUSH_KINDS) &&
    JSON.stringify(r.body.kinds) === '["evening_summary","morning_summary"]',
  "el rol Profesional con su agenda puede activarlos, sólo con «Resumen de las 8 de la noche» y «Resumen al empezar el día» (spec 021)",
  r.body,
);
const valeriaDevice = push.device();
r = await valeria("PUT", "/push/device", valeriaDevice, chromeMac);
ok(r.status === 200 && r.body.mutedKinds.length === 0, "activa su aparato", r.body);
r = await valeria("PATCH", "/push/device", { endpoint: valeriaDevice.endpoint, mutedKinds: ["booking"] }, chromeMac);
ok(r.status === 400 && r.body.error.message === "Ese tipo de aviso no es para tu cuenta.", "un tipo del propietario no es para su cuenta: 400", r.body);
r = await valeria("PATCH", "/push/device", { endpoint: valeriaDevice.endpoint, mutedKinds: ["evening_summary"] }, chromeMac);
const valeriaOn = await valeria("PATCH", "/push/device", { endpoint: valeriaDevice.endpoint, mutedKinds: [] }, chromeMac);
ok(r.status === 200 && JSON.stringify(r.body.mutedKinds) === '["evening_summary"]' && valeriaOn.status === 200 && valeriaOn.body.mutedKinds.length === 0, "lo apaga y lo vuelve a encender", [r.body, valeriaOn.body]);
r = await valeria("POST", "/push/device/test", { endpoint: valeriaDevice.endpoint }, chromeMac);
const valeriaTest = await receive(valeriaDevice, withTag("prueba"), 1000);
ok(
  r.status === 200 && valeriaTest?.payload?.title === "Avisos activados" &&
    valeriaTest.payload.body === "Listo: aquí te avisaremos de las citas que quedan sin cerrar." && valeriaTest.payload.url === "/dashboard",
  "su aviso de prueba: «Listo: aquí te avisaremos de las citas que quedan sin cerrar.», que abre /dashboard",
  [r.body, valeriaTest?.payload],
);
const valeriaSecond = push.device();
await valeria("PUT", "/push/device", valeriaSecond, chromeMac);
r = await valeria("POST", "/push/device/off", { endpoint: valeriaSecond.endpoint }, chromeMac);
ok(r.status === 204 && !deviceExists(valeriaSecond), "desactiva el otro aparato", r.status);
const valeriaAudit = pushAudit(valeria.session.userId);
ok(
  JSON.stringify(valeriaAudit.map((row) => row.action)) ===
    JSON.stringify(["push.device_enabled", "push.kinds_changed", "push.kinds_changed", "push.test_sent", "push.device_enabled", "push.device_disabled"]) &&
    valeriaAudit[0].summary === "Activó los avisos en el celular en Chrome en Mac" &&
    valeriaAudit.every((row) => row.businessId === dental && row.actorName === "Valeria Cruz"),
  "activar, los tipos, la prueba y desactivar quedan en la actividad de su negocio, a su nombre (RF-006)",
  valeriaAudit,
);
ok(
  JSON.stringify((JSON.parse(valeriaAudit[1].changes ?? "[]") as { label: string; before: string; after: string }[]).map(({ label, before, after }) => [label, before, after])) ===
    JSON.stringify([["Resumen de las 8 de la noche", "Encendido", "Apagado"]]),
  "con el interruptor que cambió («Resumen de las 8 de la noche: Encendido → Apagado»)",
  valeriaAudit[1],
);
const ownerSees = await ricardo("GET", `/businesses/${dental}/audit-logs?entityType=user`);
ok(ownerSees.status === 200 && JSON.stringify(ownerSees.body).includes("Envió un aviso de prueba a Chrome en Mac"), "el propietario lo ve en Actividad (Usuarios)", ownerSees.status);

// Otra profesional de la clínica: la agenda del Dr. Andrés Vega pasa a tener usuario.
const andresAgenda = agendas.find((agenda) => agenda.displayName === "Dr. Andrés Vega")!;
const newProfessional = (firstName: string, lastName: string, email: string) => {
  const id = sql(
    `insert into users (first_name, last_name, email, password_hash)
     select '${firstName}', '${lastName}', '${email}', password_hash from users where email = 'valeria@demo.com' returning id`,
  ).split("\n")[0];
  sql(`insert into business_users (business_id, user_id, role, clinical_access) values ('${dental}', '${id}', 'professional', true)`);
  return id;
};
const andresId = newProfessional("Andrés", "Vega", `andres.${tag}@demo.com`);
sql(`update professionals set user_id = '${andresId}' where id = '${andresAgenda.id}'`);
const andres = await as(`andres.${tag}@demo.com`);
const andresDevice = push.device();
ok(andres.session.professionalId === andresAgenda.id && (await activate(andres, andresDevice)).status === 200, "la otra profesional activa el suyo");

const dentalZone = sql(`select timezone from businesses where id = '${dental}'`);
const summaryPatient = patientRow("Gabriela Fernanda Ortiz Paz");
let summaryDay = addDaysISO(getZonedNow(dentalZone).date, 200);
while (count(`select count(*) from appointments where business_id = '${dental}' and date between '${summaryDay}' and '${addDaysISO(summaryDay, 3)}'`) > 0) {
  summaryDay = addDaysISO(summaryDay, 7);
}
const dentalAt = (professionalId: string, date: string, start: string, end: string, status = "confirmed") =>
  sql(
    `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source)
     values ('${dental}', '${summaryPatient}', '${dentalService}', '${professionalId}', '${date}', '${start}', '${end}', '${status}', 20, 'dashboard') returning id`,
  ).split("\n")[0];
/** El cron simulado a las 20:00 de ese día en la zona de la clínica (una pasada de 10 minutos). */
const eveningRun = (date: string, shift = 0) => {
  const eight = instant(date, "20:00", dentalZone);
  return notices.queueEveningSummaries(plus(eight, shift - 5), plus(eight, shift + 5));
};
const summaryOf = (device: Device, date: string) => push.to(device.endpoint).filter((item) => item.payload?.tag === `resumen-${date}`);
dentalAt(valeriaAgenda.id, summaryDay, "08:00", "08:30");
dentalAt(valeriaAgenda.id, summaryDay, "09:00", "09:30", "pending");
dentalAt(valeriaAgenda.id, summaryDay, "10:00", "10:30", "completed");
dentalAt(valeriaAgenda.id, summaryDay, "19:45", "20:30");
dentalAt(andresAgenda.id, summaryDay, "11:00", "11:30");
dentalAt(ricardoAgenda.id, summaryDay, "12:00", "12:30", "pending");
queued = await eveningRun(summaryDay);
await delivery.processPushQueue();
const [valeriaSummary] = summaryOf(valeriaDevice, summaryDay);
const [andresSummary] = summaryOf(andresDevice, summaryDay);
ok(
  summaryOf(valeriaDevice, summaryDay).length === 1 && valeriaSummary.payload?.title === "Tienes 2 citas de hoy sin cerrar" &&
    valeriaSummary.payload.body === "Márcalas Completada o No asistió para que la agenda y los reportes cuadren." &&
    valeriaSummary.payload.url === `/dashboard/calendar?date=${summaryDay}` && valeriaSummary.headers.urgency === "normal",
  "a las 20:00 la profesional recibe un solo resumen, sólo de su agenda: «Tienes 2 citas de hoy sin cerrar» (la completada y la que termina a las 20:30 no cuentan)",
  valeriaSummary?.payload,
);
ok(
  summaryOf(andresDevice, summaryDay).length === 1 && andresSummary.payload?.title === "Tienes 1 cita de hoy sin cerrar" &&
    andresSummary.payload.body.startsWith("Márcala Completada") && andresSummary.payload.url === `/dashboard/calendar?date=${summaryDay}`,
  "y la otra profesional, el suyo: «Tienes 1 cita de hoy sin cerrar»",
  andresSummary?.payload,
);
ok(
  queuedFor(ricardoA, `resumen-${summaryDay}`) === 1 && summaryOf(ricardoA, summaryDay)[0]?.payload?.title === "Tienes 4 citas de hoy sin cerrar",
  "el propietario sigue recibiendo el del negocio entero (4), sin un segundo aviso por su propia agenda",
  [queuedFor(ricardoA, `resumen-${summaryDay}`), summaryOf(ricardoA, summaryDay).map((item) => item.payload?.title)],
);
ok(
  queuedFor(adminDevice, `resumen-${summaryDay}`) === 0,
  "el super admin (también en modo soporte) no recibe los de los profesionales",
);
ok(
  count(`select count(*) from push_messages where dedupe_key = 'resumen:${valeriaAgenda.id}:${summaryDay}'`) === 1 &&
    count(`select count(*) from push_messages where dedupe_key = 'resumen:${dental}:${summaryDay}'`) >= 1,
  "con la clave resumen:<agenda>:<fecha> (el del propietario, resumen:<negocio>:<fecha>)",
);
ok(
  count(`select count(*) from panel_notices where dedupe_key in ('resumen:${valeriaAgenda.id}:${summaryDay}', 'resumen:${andresAgenda.id}:${summaryDay}', 'resumen:${dental}:${summaryDay}')`) === 3 &&
    count(`select count(*) from panel_notices where dedupe_key = 'resumen:${ricardoAgenda.id}:${summaryDay}'`) === 0,
  "la campana sigue igual: el del negocio y uno por agenda con usuario que no es el propietario",
);
const summaryTexts = sql(`select coalesce(string_agg(title || ' ' || body || ' ' || url, ' | '), '') from push_messages where tag = 'resumen-${summaryDay}'`);
ok(
  summaryTexts.length > 0 && !/Gabriela|Ortiz|Juan|Pérez/.test(summaryTexts) && !summaryTexts.includes(summaryPatient),
  "sin datos de pacientes: sólo la cifra (RF-005)",
  summaryTexts,
);
ok(
  (await eveningRun(summaryDay)) === 0 && (await eveningRun(summaryDay, 10)) === 0 && queuedFor(valeriaDevice, `resumen-${summaryDay}`) === 1 && queuedFor(andresDevice, `resumen-${summaryDay}`) === 1,
  "pasar el cron otra vez (o la pasada siguiente) no lo repite: una vez al día",
);
const quietDay = addDaysISO(summaryDay, 1);
dentalAt(valeriaAgenda.id, quietDay, "08:00", "08:30", "completed");
dentalAt(andresAgenda.id, quietDay, "09:00", "09:30");
await eveningRun(quietDay);
ok(
  queuedFor(valeriaDevice, `resumen-${quietDay}`) === 0 && queuedFor(andresDevice, `resumen-${quietDay}`) === 1 && queuedFor(ricardoA, `resumen-${quietDay}`) === 1,
  "sin citas sin cerrar en su agenda no le llega nada (a la otra sí, y al propietario el del negocio)",
);

console.log("Quién tiene la agenda ese día, y Recepción (spec 017)");
const brunoId = newProfessional("Bruno", "Salas", `bruno.${tag}@demo.com`);
sql(`update professionals set user_id = '${brunoId}' where id = '${andresAgenda.id}'`);
const bruno = await as(`bruno.${tag}@demo.com`);
const brunoDevice = push.device();
await activate(bruno, brunoDevice);
const movedDay = addDaysISO(summaryDay, 2);
dentalAt(andresAgenda.id, movedDay, "09:00", "09:30");
await eveningRun(movedDay);
ok(
  queuedFor(brunoDevice, `resumen-${movedDay}`) === 1 && queuedFor(andresDevice, `resumen-${movedDay}`) === 0,
  "una agenda que pasa a otro usuario: el resumen va a quien la tiene ese día",
);
r = await andres("GET", "/push/config");
const noAgendaSave = await activate(andres, push.device());
ok(
  r.status === 403 && noAgendaSave.status === 403 &&
    r.body.error.message === "Tu usuario no tiene una agenda asignada: los avisos en el celular son para el resumen de tu agenda. Pide al propietario que te la asigne en Profesionales.",
  "un profesional sin agenda activa: 403 con un mensaje claro",
  r.body,
);
sql(`update business_users set role = 'staff' where user_id = '${valeria.session.userId}'`);
const staffDay = addDaysISO(summaryDay, 3);
dentalAt(valeriaAgenda.id, staffDay, "08:00", "08:30");
await eveningRun(staffDay);
r = await valeria("GET", "/push/config");
ok(
  queuedFor(valeriaDevice, `resumen-${staffDay}`) === 0 && r.status === 403 && r.body.error.message === NOT_FOR_ROLE,
  "si pasa a Recepción deja de recibirlo (aunque tenga la agenda y el aparato) y no puede activarlos",
  r.body,
);
sql(`update business_users set role = 'professional' where user_id = '${valeria.session.userId}'`);

/* ======================================================================================== */
console.log("Los del super admin (R14)");
sql(
  `insert into users (first_name, last_name, email, password_hash, platform_role)
   select 'Segundo', 'Soporte', 'segundo.${tag}@demo.com', password_hash, 'super_admin' from users where email = 'admin@demo.com'`,
);
const second = await as(`segundo.${tag}@demo.com`);
const secondDevice = push.device();
ok((await activate(second, secondDevice)).status === 200, "otro super admin activa los suyos");
const signup = visitor();
r = await signup("POST", "/auth/register", { firstName: "Irene", lastName: "Registro", email: `irene.${tag}@correo.ec`, password: "Clave12345", confirmPassword: "Clave12345" });
r = await signup("POST", "/businesses", {
  name: `Mente Abierta ${tag}`,
  category: "psychology",
  timezone: "America/Guayaquil",
  phone: "",
  email: "",
  address: "",
  description: "",
  schedules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, isActive: d !== 0, intervals: [{ start: "09:00", end: "17:00" }] })),
  firstService: { name: "Sesión", description: "", durationMinutes: 50, price: 30, isActive: true },
});
const newBusinessId: string = r.body?.id;
const categoryName = sql("select name from business_categories where id = 'psychology'");
const [toAdmin, toSecond] = await Promise.all([receive(adminDevice, withTag(`negocio-${newBusinessId}`)), receive(secondDevice, withTag(`negocio-${newBusinessId}`))]);
ok(
  r.status === 200 && toAdmin?.payload?.title === "Negocio nuevo" && toAdmin.payload.body === `Mente Abierta ${tag} · ${categoryName}` &&
    toAdmin.payload.url === `/admin/businesses/${newBusinessId}` && Boolean(toSecond),
  "el alta por el onboarding avisa «Negocio nuevo · {negocio} · {categoría}» a cada super admin con aparato",
  [r.status, toAdmin?.payload],
);
ok(!push.received.some((item) => item.endpoint === jhordanDevice.endpoint && item.payload?.kind === "new_business"), "y a nadie más");
const adminCreated = (await admin("POST", "/admin/businesses", businessInput({ name: `Desde Admin ${tag}`, slug: `desde-admin-${tag}` }))).body?.business?.id;
ok(Boolean(adminCreated) && count(`select count(*) from push_messages where tag = 'negocio-${adminCreated}'`) === 0, "uno creado desde /admin, no");
const currentPlan = getPlan(sql(`select plan from subscriptions where business_id = '${jhordanBusiness}'`) as "free");
const wanted = currentPlan.id === "business" ? getPlan("pro") : getPlan("business");
sql(`delete from plan_change_requests where business_id = '${jhordanBusiness}'`);
r = await jhordan("POST", `/businesses/${jhordanBusiness}/subscription/request`, { plan: wanted.id });
const businessName = sql(`select name from businesses where id = '${jhordanBusiness}'`);
const planPush = r.status === 200 ? await receive(adminDevice, withTag(`plan-${r.body.id}`)) : undefined;
ok(
  planPush?.payload?.title === "Solicitud de cambio de plan" && planPush.payload.body === `${businessName} · de ${currentPlan.name} a ${wanted.name}` &&
    planPush.payload.url === `/admin/businesses/${jhordanBusiness}`,
  "una solicitud de plan avisa con el negocio y los planes",
  [r.status, r.body, planPush?.payload],
);
ok(!push.to(jhordanDevice.endpoint).some((item) => item.payload?.kind === "plan_request"), "el negocio no recibe nada de planes");

console.log("El cron de GitHub envía los suyos (R14, R15)");
const ntfy = await fakeNtfy();
const vapidEnv = { VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY };
r = await admin("POST", "/auth/change-password", { currentPassword: "demo1234", newPassword: "demo12345", confirmPassword: "demo12345" });
ok(r.status === 204, "el super admin cambia su contraseña", r.body);
for (let i = 0; i < 10; i++) {
  await agent({ ip: `198.18.0.${i + 1}` })("POST", "/auth/login", { email: "ricardo@demo.com", password: `mala-${i}`, remember: false });
}
let cron = await runCron(ntfy.url, vapidEnv);
const accountPush = await receive(adminDevice, (payload) => payload.kind === "account_security", 1000);
ok(
  cron.code === 0 && accountPush?.payload?.title === "Cambio de seguridad en una cuenta de super admin" && accountPush.payload.body === "ad***@demo.com · Cambió su contraseña" &&
    accountPush.payload.url === "/admin/activity?ver=seguridad",
  "el cambio de seguridad: «ad***@demo.com · Cambió su contraseña», que abre Actividad → Seguridad",
  [cron.code, accountPush?.payload, cron.output.slice(-400)],
);
const attackPush = await receive(adminDevice, (payload) => payload.kind === "login_attack", 1000);
ok(
  attackPush?.payload?.title === "Posibles intentos de adivinar contraseñas" && /^ri\*\*\*@demo\.com: 10 intentos fallidos en la última hora$/.test(attackPush.payload.body) &&
    attackPush.headers.urgency === "high",
  "los intentos fallidos: «ri***@demo.com: 10 intentos fallidos en la última hora»",
  attackPush?.payload,
);
ok(Boolean(push.to(secondDevice.endpoint).find((item) => item.payload?.kind === "login_attack")), "a cada super admin");
ok(ntfy.received.some((n) => /cambio en una cuenta de super admin/.test(n.title)) && ntfy.received.some((n) => /intentos de adivinar/.test(n.title)), "ntfy sigue mandando los suyos", ntfy.received.map((n) => n.title));
ok(/ · avisos en la app: enviados \d+ · fallidos \d+ · aparatos dados de baja \d+/.test(cron.output), "la línea del registro suma los avisos en la app (sólo cifras)", cron.output.slice(-300));
await agent({ ip: "198.18.0.50" })("POST", "/auth/login", { email: "ricardo@demo.com", password: "mala-otra", remember: false });
ntfy.received.length = 0;
cron = await runCron(ntfy.url, vapidEnv);
ok(
  ntfy.received.some((n) => /intentos de adivinar/.test(n.title)) && push.to(adminDevice.endpoint).filter((item) => item.payload?.kind === "login_attack").length === 1,
  "con un intento nuevo ntfy vuelve a avisar, pero en el celular como mucho uno por cuenta y hora",
  ntfy.received.map((n) => n.title),
);
ntfy.close();
r = await admin("POST", "/auth/change-password", { currentPassword: "demo12345", newPassword: "demo1234", confirmPassword: "demo1234" });

/* ======================================================================================== */
console.log("Privacidad (CE-003)");
const payloads = push.received.map((item) => item.payload).filter((payload): payload is Payload => Boolean(payload));
const leaks = payloads.filter((payload) => {
  const text = `${payload.title} ${payload.body}`;
  return (
    text.includes(SECRET_NOTE) ||
    people.some((who) => text.includes(who.name) || text.includes(who.email) || text.includes(who.documentId) || text.includes(who.phone) || text.includes(who.phone.replace(/\D/g, "").slice(-7))) ||
    people.some((who) => who.name.split(" ").length > 1 && text.includes(who.name.split(" ").slice(0, 2).join(" ")))
  );
});
ok(payloads.length > 20 && leaks.length === 0, `en los ${payloads.length} avisos de la suite: ni el nombre completo, ni la cédula, el email, el teléfono o las notas`, leaks.slice(0, 3));
const logs = `${other.output()}${cron.output}`;
ok(
  !logs.includes("/aparato/") && !logs.includes("Nueva reserva") && !logs.includes("Cita por cerrar") && !people.some((who) => logs.includes(who.name) || logs.includes(who.email)),
  "lo que imprimieron la API y el cron no tiene títulos, textos ni direcciones de aparatos",
);

push.close();
await pool.end();
done("de los avisos en el celular");
