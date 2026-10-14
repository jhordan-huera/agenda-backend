// Pago por transferencia: datos bancarios de la agenda, enlace de pago, comprobantes en el
// almacenamiento (bucket privado) y logos y fotos en el bucket público de imágenes.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cedulaFor } from "./helpers/cedula.mjs";
import { getAvailableSlots, scopeToProfessional } from "../src/shared/lib/availability.ts";
import { addDaysISO, getZonedNow } from "../src/shared/lib/time.ts";
import type { Professional, PublicBusinessProfile } from "../src/shared/types/index.ts";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
const ORIGIN = new URL(BASE).origin;
let failures = 0;
const ok = (cond: unknown, label: string, extra?: unknown) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 400));
  }
};
let ipCounter = 10;
function agent() {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "fetch",
        "x-agendo-proxy-secret": process.env.PROXY_SECRET ?? "",
        "x-agendo-client-ip": `198.51.100.${ipCounter++ % 250}`,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) cookie = c.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
}
const sql = (query: string) =>
  execFileSync("psql", [process.env.TEST_DATABASE_URL!, "-qAtc", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
/** Sube el archivo a la URL firmada (almacenamiento local de las pruebas). */
const put = (upload: { url: string; headers: Record<string, string> }, body: Buffer) =>
  fetch(ORIGIN + upload.url, { method: "PUT", headers: upload.headers, body });
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const owner = agent();
const session = (await owner("POST", "/auth/login", { email: "jhordan@demo.com", password: "demo1234", remember: true })).body;
const B = `/businesses/${session.businessId}`;
const business = (await owner("GET", B)).body;
await owner("PATCH", B, { bookingSettings: { ...business.bookingSettings, minNoticeHours: 0, maxClientBookingsPerDay: 0 } });
const visitor = agent();

console.log("Datos bancarios de la agenda");
const professional: Professional = (await owner("GET", `${B}/professionals`)).body.find((p: Professional) => p.userId === session.userId);
/** La ficha tal como la devuelve la API, con otras cuentas (sin `bankAccount`, que es de los fronts viejos). */
const professionalBody = () => {
  const { id: _id, businessId: _b, sortOrder: _s, createdAt: _c, bankAccount: _old, ...rest } = professional as Professional & { bankAccount?: unknown };
  return rest;
};
const professionalInput = (bankAccounts: unknown) => ({ ...professionalBody(), bankAccounts });
const saveAccounts = (bankAccounts: unknown) => owner("PUT", `${B}/professionals/${professional.id}`, professionalInput(bankAccounts));
/** Lo que quedó en la base: el número de cada cuenta y el de `bank_account` (la columna de antes). */
const storedNumbers = () =>
  sql(`select coalesce((select string_agg(a->>'number', ',') from jsonb_array_elements(bank_accounts) a), '') || ' / ' ||
              coalesce(bank_account->>'number', 'null') from professionals where id = '${professional.id}'`);
const lastBankChange = async () =>
  ((await owner("GET", `${B}/audit-logs?entityId=${professional.id}`)).body.entries[0]?.changes ?? []).find(
    (c: { label: string }) => c.label === "Datos bancarios",
  ) as { before: string; after: string } | undefined;

ok(professional.bankAccounts.length === 2 && professional.bankAccounts[0].bank !== professional.bankAccounts[1].bank, "la agenda demo de jhordan tiene 2 cuentas", professional.bankAccounts);
const account = { bank: "Produbanco", accountType: "checking", number: "0200-123 456", holder: "Jhordan Demo", holderId: "1712345678" };
const pichinchaAccount = { bank: "Banco Pichincha", accountType: "savings", number: "2200 987 654", holder: "Jhordan Demo", holderId: "" };
const jepAccount = { bank: "Cooperativa JEP", accountType: "savings", number: "4100555666", holder: "Jhordan Huera", holderId: "" };
let r = await saveAccounts([{ ...account, number: "abc" }]);
ok(r.status === 400 && /número de cuenta/.test(r.body.error.message), "número de cuenta con letras → 400", r.body);
r = await saveAccounts([account, { ...pichinchaAccount, accountType: "otra" }]);
ok(r.status === 400, "tipo de cuenta inválido en la segunda cuenta → 400", r.body);
r = await saveAccounts([account, pichinchaAccount, jepAccount, { ...jepAccount, number: "4100777888" }]);
ok(r.status === 400 && r.body.error.message === "Como máximo 3 cuentas", "4 cuentas → 400 «Como máximo 3 cuentas»", r.body);
r = await saveAccounts(account);
ok(r.status === 400, "una cuenta suelta en lugar de la lista → 400", r.body);
ok(storedNumbers().startsWith(professional.bankAccounts.map((a) => a.number).join(",")), "nada de eso cambió lo guardado", storedNumbers());
r = await saveAccounts([account]);
ok(
  r.status === 200 && r.body.bankAccounts.length === 1 && r.body.bankAccounts[0].number === "0200123456" && r.body.bankAccounts[0].accountType === "checking",
  "se guarda una cuenta (el número, sólo con dígitos)",
  r.body,
);
ok(r.body.bankAccount?.number === "0200123456", "la respuesta trae también `bankAccount` (la primera) para los fronts viejos", r.body.bankAccount);
ok(storedNumbers() === "0200123456 / 0200123456", "la columna bank_account guarda la primera", storedNumbers());
let change = await lastBankChange();
ok(change && /Produbanco · Corriente/.test(change.after), "la actividad registra el cambio", change);
r = await saveAccounts([account, pichinchaAccount]);
ok(r.status === 200 && r.body.bankAccounts.map((a: { number: string }) => a.number).join(",") === "0200123456,2200987654", "se guardan 2 cuentas, en su orden", r.body.bankAccounts);
ok(storedNumbers() === "0200123456,2200987654 / 0200123456", "bank_account sigue siendo la primera", storedNumbers());
change = await lastBankChange();
ok(
  change?.before === "Produbanco · Corriente · 0200123456 · Jhordan Demo" &&
    change.after === "Produbanco · Corriente · 0200123456 · Jhordan Demo, Banco Pichincha · Ahorros · 2200987654 · Jhordan Demo",
  "la actividad muestra antes y después con varias cuentas",
  change,
);
r = await saveAccounts([pichinchaAccount, account, jepAccount]);
ok(r.status === 200 && r.body.bankAccounts.length === 3 && r.body.bankAccount.number === "2200987654", "se guardan 3 cuentas (la principal, la que va primero)", r.body.bankAccounts);
ok(storedNumbers() === "2200987654,0200123456,4100555666 / 2200987654", "al ordenarlas, bank_account pasa a ser la nueva primera", storedNumbers());

console.log("Fronts viejos en caché (sólo conocen `bankAccount`)");
const { bankAccounts: _accounts, ...legacyBody } = professionalBody();
r = await owner("PUT", `${B}/professionals/${professional.id}`, { ...legacyBody, bankAccount: { ...account, bank: "Banco del Austro" } });
ok(
  r.status === 200 && r.body.bankAccounts.map((a: { bank: string }) => a.bank).join(",") === "Banco del Austro,Produbanco,Cooperativa JEP",
  "se acepta `bankAccount`: reemplaza la primera y conserva las demás (ese front no las veía)",
  r.body.bankAccounts,
);
ok(storedNumbers() === "0200123456,0200123456,4100555666 / 0200123456", "y bank_account queda sincronizada", storedNumbers());
r = await owner("PUT", `${B}/professionals/${professional.id}`, { ...legacyBody, bankAccount: { ...account, number: "12" } });
ok(r.status === 400, "la cuenta antigua también se valida", r.body);
r = await owner("PUT", `${B}/professionals/${professional.id}`, { ...legacyBody, bankAccount: null });
ok(r.status === 200 && r.body.bankAccounts.length === 0 && r.body.bankAccount === null, "`bankAccount: null` quita el cobro por transferencia", r.body);
ok(storedNumbers() === "/ null", "sin cuentas: lista vacía y bank_account null", storedNumbers());
r = await owner("PUT", `${B}/professionals/${professional.id}`, { ...legacyBody, bankAccounts: [account, pichinchaAccount], bankAccount: null });
ok(r.status === 200 && r.body.bankAccounts.length === 2, "si vienen las dos, manda `bankAccounts`", r.body.bankAccounts);
r = await owner("GET", `${B}/professionals`);
const listed = r.body.find((p: Professional) => p.id === professional.id);
ok(listed.bankAccounts.length === 2 && listed.bankAccount.number === "0200123456", "la lista de profesionales trae `bankAccounts` y `bankAccount`", listed);

console.log("Reserva con pago por transferencia");
const services = (await owner("GET", `${B}/services`)).body;
const paid = services.find((s: { price: number; showPrice: boolean; isActive: boolean; modes: string[] }) => s.price > 0 && s.showPrice && s.isActive && s.modes.includes("business"));
const free = (
  await owner("POST", `${B}/services`, {
    name: "Valoración gratuita", description: "", durationMinutes: 30, price: 0, showPrice: true, homeVisitFee: 0,
    isActive: true, modes: ["business"],
  })
).body;
const profile: PublicBusinessProfile = (await visitor("GET", `/public/businesses/${business.slug}?t=${Date.now()}`)).body;
const now = getZonedNow(profile.business.timezone);
const context = { ...profile, settings: profile.business.bookingSettings, now };
const slots: { date: string; startTime: string }[] = [];
for (let d = 1; d < 40 && slots.length < 6; d++) {
  const date = addDaysISO(now.date, d);
  for (const startTime of getAvailableSlots(date, Math.max(paid.durationMinutes, 30), scopeToProfessional(context, professional.id)).filter((_, i) => i % 3 === 0).slice(0, 6 - slots.length)) {
    slots.push({ date, startTime });
  }
}
const person = (seed: string) => ({ documentId: cedulaFor(`${seed}@example.com`), name: `Paciente ${seed} Prueba`, email: `${seed}@example.com`, phone: "+593 99 444 5555", notes: "" });
const book = (serviceId: string, slot: object, seed: string) =>
  visitor("POST", `/public/businesses/${business.slug}/bookings`, { serviceId, professionalId: professional.id, ...slot, ...person(seed) });

r = await book(paid.id, slots[0], "pago1");
const booking = r.body;
ok(
  r.status === 200 && booking.payment?.bankAccounts?.map((a: { bank: string }) => a.bank).join(",") === "Produbanco,Banco Pichincha" &&
    /^[0-9a-f]{32}$/.test(booking.payment.token) && booking.payment.receiptsEnabled,
  "la confirmación trae las 2 cuentas y el enlace de pago",
  r.body,
);
ok(booking.payment.bankAccount?.bank === "Produbanco", "y `bankAccount` con la primera, para los fronts viejos", booking.payment);
const token: string = booking.payment.token;
const created = sql(`select body from notifications where to_email = 'pago1@example.com' and type = 'booking_created'`);
ok(
  /Pago por transferencia: transfiere \$[\d.,]+ a cualquiera de estas 2 cuentas/.test(created) && /Cuenta 1\nBanco: Produbanco/.test(created) &&
    /Cuenta 2\nBanco: Banco Pichincha/.test(created) && /0200123456/.test(created) && /2200987654/.test(created) && created.includes(`/pago/${token}`),
  "el email de la reserva trae las 2 cuentas y el enlace",
  created.slice(0, 900),
);
const createdHtml = sql(`select html from notifications where to_email = 'pago1@example.com' and type = 'booking_created'`);
ok(createdHtml.includes("0200123456") && createdHtml.includes("2200987654"), "también en el HTML", null);
r = await book(free.id, slots[1], "gratis1");
ok(r.status === 200 && r.body.payment === null, "un servicio gratis no pide pago", r.body);

console.log("Enlace de pago (sin sesión)");
const anonymous = agent();
r = await anonymous("GET", `/public/payments/${token}`);
ok(
  r.status === 200 && r.body.amount === paid.price && r.body.bankAccounts.map((a: { number: string }) => a.number).join(",") === "0200123456,2200987654" &&
    r.body.clientName === "Paciente P." && r.body.receipts.length === 0 && r.body.paid === false && r.body.receiptsEnabled,
  "muestra monto, las 2 cuentas y nombre abreviado",
  r.body,
);
ok(r.body.bankAccount?.number === "0200123456", "y `bankAccount` con la primera, para los fronts viejos", r.body.bankAccount);
ok(!JSON.stringify(r.body).includes("pago1@example.com"), "no expone el email del paciente", r.body);
r = await anonymous("GET", `/public/payments/${"0".repeat(32)}`);
ok(r.status === 404, "token inexistente → 404", r.body);
r = await anonymous("GET", `/public/payments/${token.toUpperCase()}x`);
ok(r.status === 404, "token con otra forma → 404", r.status);

console.log("Comprobante");
const receiptInput = { fileName: "transferencia.png", contentType: "image/png", sizeBytes: PNG.length };
r = await anonymous("POST", `/public/payments/${token}/receipts`, { ...receiptInput, contentType: "text/html" });
ok(r.status === 400, "tipo no admitido → 400", r.body);
r = await anonymous("POST", `/public/payments/${token}/receipts`, { ...receiptInput, sizeBytes: 11 * 1024 * 1024 });
ok(r.status === 400 && /10 MB/.test(r.body.error.message), "más de 10 MB → 400", r.body);
r = await anonymous("POST", `/public/payments/${token}/receipts`, receiptInput);
ok(r.status === 200 && r.body.upload.method === "PUT", "pide la URL de subida", r.body);
const pending = r.body;
r = await anonymous("POST", `/public/payments/${token}/receipts/${pending.receipt.id}/complete`);
ok(r.status === 409, "completar sin haber subido → 409", r.body);
const uploaded = await put(pending.upload, PNG);
ok(uploaded.ok, "el navegador sube el archivo", uploaded.status);
r = await anonymous("POST", `/public/payments/${token}/receipts/${pending.receipt.id}/complete`);
ok(r.status === 200 && r.body.fileName === "transferencia.png", "comprobante recibido", r.body);
const storagePath = sql(`select storage_path from payment_receipts where id = '${pending.receipt.id}'`);
const receiptFile = join(process.env.LOCAL_STORAGE_DIR!, "comprobantes", storagePath);
ok(existsSync(receiptFile) && !storagePath.includes("transferencia"), "va al bucket de comprobantes, sin el nombre original en la ruta", storagePath);
const notice = sql(`select to_email || ' ' || subject from notifications where type = 'payment_receipt_received'`);
ok(notice.includes(business.email) && /Comprobante de pago/.test(notice), "aviso por email al negocio", notice);
r = await anonymous("GET", `/public/payments/${token}`);
ok(r.body.receipts.length === 1, "el paciente ve su comprobante enviado", r.body);

console.log("Panel");
const appointmentId: string = booking.appointmentId;
r = await owner("GET", `${B}/appointments/${appointmentId}`);
ok(r.body.receiptAt && r.body.paidAt === null && r.body.paymentToken === token, "la cita marca el comprobante recibido", r.body);
r = await owner("GET", `${B}/appointments/${appointmentId}/receipts`);
ok(r.status === 200 && r.body.length === 1 && r.body[0].contentType === "image/png", "lista de comprobantes", r.body);
r = await owner("GET", `${B}/payment-receipts/${r.body[0].id}/url`);
const file = await fetch(ORIGIN + r.body.url);
ok(file.ok && Buffer.from(await file.arrayBuffer()).equals(PNG), "se abre con una URL firmada", r.body);
r = await visitor("GET", `${B}/payment-receipts/${pending.receipt.id}/url`);
ok(r.status === 401, "sin sesión no se abre", r.status);
const audit = (await owner("GET", `${B}/audit-logs?entityId=${appointmentId}`)).body.entries.map((e: { summary: string }) => e.summary);
ok(audit.some((s: string) => /Comprobante de pago recibido de Paciente pago1/.test(s)), "la actividad registra el comprobante", audit);
r = await owner("PATCH", `${B}/appointments/${appointmentId}/payment`, { paid: "sí" });
ok(r.status === 400, "valor inválido → 400", r.body);
r = await owner("PATCH", `${B}/appointments/${appointmentId}/payment`, { paid: true });
ok(r.status === 200 && r.body.paidAt, "se marca como pagada", r.body);
r = await anonymous("GET", `/public/payments/${token}`);
ok(r.body.paid === true, "el paciente ve que ya está pagada", r.body);
await owner("PATCH", `${B}/appointments/${appointmentId}/status`, { status: "confirmed" });
const confirmed = sql(`select body from notifications where to_email = 'pago1@example.com' and type = 'appointment_confirmed'`);
ok(confirmed && !/Pago por transferencia/.test(confirmed), "pagada: la confirmación ya no pide la transferencia", confirmed.slice(0, 300));

console.log("Límites");
r = await anonymous("POST", `/public/payments/${token}/receipts`, receiptInput);
ok(r.status === 409 && /Ya enviaste el comprobante/.test(r.body.error.message), "un comprobante por cita: el segundo → 409", r.body);
// Dos pestañas a la vez: las dos piden subir antes de que ninguna termine; sólo vale la primera.
const twoTabs = (await book(paid.id, slots[3], "doble1")).body.payment.token;
const tabA = (await anonymous("POST", `/public/payments/${twoTabs}/receipts`, receiptInput)).body;
const tabB = (await anonymous("POST", `/public/payments/${twoTabs}/receipts`, receiptInput)).body;
await put(tabA.upload, PNG);
await put(tabB.upload, PNG);
const completedA = await anonymous("POST", `/public/payments/${twoTabs}/receipts/${tabA.receipt.id}/complete`);
const completedB = await anonymous("POST", `/public/payments/${twoTabs}/receipts/${tabB.receipt.id}/complete`);
const tabBPath = join(process.env.LOCAL_STORAGE_DIR!, "comprobantes", sql(`select storage_path from payment_receipts where id = '${tabA.receipt.id}'`).replace(tabA.receipt.id, tabB.receipt.id));
ok(
  completedA.status === 200 && completedB.status === 409 && sql(`select count(*) from payment_receipts r join appointments a on a.id = r.appointment_id where a.payment_token = '${twoTabs}'`) === "1" && !existsSync(tabBPath),
  "dos pestañas a la vez: queda un solo comprobante y el otro archivo se borra",
  [completedA.status, completedB.status],
);
r = await book(paid.id, slots[2], "cancela1");
const cancelToken = r.body.payment.token;
await owner("PATCH", `${B}/appointments/${r.body.appointmentId}/status`, { status: "cancelled" });
r = await anonymous("POST", `/public/payments/${cancelToken}/receipts`, receiptInput);
ok(r.status === 409, "cita cancelada: no se envían comprobantes", r.body);

console.log("Borrar al paciente borra sus comprobantes");
const clientId = sql(`select client_id from appointments where id = '${appointmentId}'`);
r = await owner("DELETE", `${B}/clients/${clientId}`);
ok(r.status === 200 || r.status === 204, "paciente eliminado", r.body);
ok(!existsSync(receiptFile) && sql(`select count(*) from payment_receipts where appointment_id = '${appointmentId}'`) === "0", "sus comprobantes ya no existen", receiptFile);

console.log("Borrado de los comprobantes de más de 3 meses");
/** Reserva con un comprobante subido; devuelve la cita y la ruta del archivo. */
async function bookWithReceipt(slot: object, seed: string) {
  const { body } = await book(paid.id, slot, seed);
  const request = (await anonymous("POST", `/public/payments/${body.payment.token}/receipts`, receiptInput)).body;
  await put(request.upload, PNG);
  await anonymous("POST", `/public/payments/${body.payment.token}/receipts/${request.receipt.id}/complete`);
  const path = sql(`select storage_path from payment_receipts where id = '${request.receipt.id}'`);
  return { appointmentId: body.appointmentId as string, file: join(process.env.LOCAL_STORAGE_DIR!, "comprobantes", path) };
}
const oldOne = await bookWithReceipt(slots[4], "viejo1");
const recent = await bookWithReceipt(slots[5], "reciente1");
await owner("PATCH", `${B}/appointments/${oldOne.appointmentId}/payment`, { paid: true });
// La cita pasa a ser de hace 4 meses (el borrado mira la fecha de la cita).
sql(`update appointments set date = (current_date - interval '4 months')::date where id = '${oldOne.appointmentId}'`);
const purgeOutput = execFileSync(
  process.execPath,
  ["--input-type=module", "-e", 'const { purgeOldReceipts } = await import("./src/services/payment-service.ts"); console.log(await purgeOldReceipts()); process.exit(0);'],
  { env: process.env, encoding: "utf8" },
).trim();
ok(purgeOutput === "1", "el cron borra el comprobante de la cita de hace 4 meses (y sólo ese)", purgeOutput);
ok(!existsSync(oldOne.file) && sql(`select count(*) from payment_receipts where appointment_id = '${oldOne.appointmentId}'`) === "0", "archivo y registro borrados", oldOne.file);
ok(sql(`select (paid_at is not null) and (receipt_at is not null) from appointments where id = '${oldOne.appointmentId}'`) === "t", "la cita sigue pagada y con la fecha del comprobante", null);
ok(existsSync(recent.file) && sql(`select count(*) from payment_receipts where appointment_id = '${recent.appointmentId}'`) === "1", "el de una cita reciente se conserva", recent.file);

console.log("Imágenes en el almacenamiento");
r = await anonymous("POST", "/images", { target: "avatar", contentType: "image/png", sizeBytes: PNG.length });
ok(r.status === 401, "sin sesión no se suben imágenes", r.status);
r = await owner("POST", "/images", { target: "avatar", contentType: "image/gif", sizeBytes: 10 });
ok(r.status === 400, "GIF → 400", r.body);
r = await owner("POST", "/images", { target: "avatar", contentType: "image/png", sizeBytes: 3 * 1024 * 1024 });
ok(r.status === 400 && /2 MB/.test(r.body.error.message), "más de 2 MB → 400", r.body);
const uploadAvatar = async () => {
  const { body } = await owner("POST", "/images", { target: "avatar", contentType: "image/png", sizeBytes: PNG.length });
  await put(body.upload, PNG);
  return body.url as string;
};
const avatar = await uploadAvatar();
ok(avatar.startsWith(`/api/files/public/imagenes/perfiles/${session.userId}/`), "la foto va al bucket público de imágenes", avatar);
const served = await fetch(ORIGIN + avatar);
ok(served.ok && served.headers.get("content-type") === "image/png", "se sirve sin sesión (pública)", served.status);
const me = (await owner("GET", `/users/${session.userId}`)).body;
const profileInput = { firstName: me.firstName, lastName: me.lastName, email: me.email, phone: me.phone };
r = await owner("PUT", `/users/${session.userId}`, { ...profileInput, avatarUrl: `data:image/png;base64,${PNG.toString("base64")}` });
ok(r.status === 400 && /Vuelve a elegirla/.test(r.body.error.message), "una data URL nueva → 400", r.body);
r = await owner("PUT", `/users/${session.userId}`, { ...profileInput, avatarUrl: "https://example.com/foto.png" });
ok(r.status === 400, "una dirección de otro sitio → 400", r.body);
r = await owner("PUT", `/users/${session.userId}`, { ...profileInput, avatarUrl: avatar });
ok(r.status === 200 && r.body.avatarUrl === avatar, "la foto subida se guarda", r.body);
ok(sql(`select avatar_url from professionals where id = '${professional.id}'`) === avatar, "y pasa a su agenda", null);
const second = await uploadAvatar();
r = await owner("PUT", `/users/${session.userId}`, { ...profileInput, avatarUrl: second });
ok(r.status === 200 && (await fetch(ORIGIN + avatar)).status === 404, "al cambiarla, la anterior se borra", r.body);

r = await owner("POST", "/images", { target: "logo", contentType: "image/webp", sizeBytes: 100 });
ok(r.status === 400 && /negocio/.test(r.body.error.message), "logo sin negocio → 400", r.body);
r = await owner("POST", "/images", { target: "logo", businessId: "00000000-0000-0000-0000-000000000000", contentType: "image/webp", sizeBytes: 100 });
ok(r.status === 403 || r.status === 404, "logo de otro negocio → no", r.status);
r = await owner("POST", "/images", { target: "logo", businessId: session.businessId, contentType: "image/png", sizeBytes: PNG.length });
ok(r.body.url.startsWith(`/api/files/public/imagenes/logos/${session.businessId}/`), "logo en su carpeta del negocio", r.body);
await put(r.body.upload, PNG);
r = await owner("PATCH", B, { logoUrl: r.body.url });
ok(r.status === 200 && r.body.logoUrl.startsWith("/api/files/public/imagenes/logos/"), "logo guardado", r.body);

console.log("Imágenes antiguas (data URL)");
const legacy = `data:image/png;base64,${PNG.toString("base64")}`;
sql(`update businesses set logo_url = '${legacy}' where id = '${session.businessId}'`);
r = await owner("PATCH", B, { name: business.name, logoUrl: legacy });
ok(r.status === 200, "la antigua sin cambios se puede volver a guardar", r.body);
execFileSync(process.execPath, ["src/db/move-images-to-storage.ts"], { env: process.env, stdio: "pipe" });
const moved = sql(`select logo_url from businesses where id = '${session.businessId}'`);
ok(moved.startsWith("/api/files/public/imagenes/antiguas/") && (await fetch(ORIGIN + moved)).ok, "npm run db:move-images la pasa al almacenamiento", moved.slice(0, 80));
ok(sql("select count(*) from businesses where logo_url like 'data:%'") === "0", "no quedan imágenes dentro de la base", null);

console.log("Migración 030 (varias cuentas)");
{
  const migration = readFileSync(new URL("../db/migrations/030_multiple_bank_accounts.sql", import.meta.url), "utf8");
  const start = migration.indexOf("update professionals set bank_accounts");
  const backfill = migration.slice(start, migration.indexOf(";", start) + 1);
  const [withAccount, without] = sql(`select id from professionals where business_id <> '${session.businessId}' order by display_name limit 2`).split("\n");
  const old = JSON.stringify({ bank: "Banco Bolivariano", accountType: "savings", number: "5500112233", holder: "Agenda Antigua", holderId: "" });
  const banks = (id: string) => sql(`select coalesce(string_agg(a->>'bank', ',' order by n), '') from professionals, jsonb_array_elements(bank_accounts) with ordinality as t(a, n) where id = '${id}'`);
  // Como antes de la 030: la cuenta sólo en bank_account (una agenda con cuenta y otra sin ella).
  sql(`update professionals set bank_accounts = '[]', bank_account = '${old}' where id = '${withAccount}'`);
  sql(`update professionals set bank_accounts = '[]', bank_account = null where id = '${without}'`);
  sql(backfill);
  ok(sql(`select bank_accounts = jsonb_build_array(bank_account) from professionals where id = '${withAccount}'`) === "t", "convierte la cuenta que había en una lista con ella", banks(withAccount));
  ok(sql(`select bank_accounts = '[]' and bank_account is null from professionals where id = '${without}'`) === "t", "sin cuenta: lista vacía", banks(without));
  const rejects = (query: string) => {
    try {
      sql(query);
      return false;
    } catch {
      return true;
    }
  };
  ok(rejects(`update professionals set bank_accounts = '[{}, {}, {}, {}]' where id = '${without}'`), "la base no admite 4 cuentas");
  ok(rejects(`update professionals set bank_accounts = '{}' where id = '${without}'`), "ni algo que no sea una lista");
  ok(rejects(`update professionals set bank_accounts = '["2200123456"]' where id = '${without}'`), "ni una lista con algo que no es una cuenta");

  // El código anterior (antes de publicar el nuevo, o al volver atrás) sólo escribe bank_account.
  const pichincha = JSON.stringify({ ...pichinchaAccount, number: "2200987654" });
  sql(`update professionals set bank_accounts = '[${old}, ${pichincha}]', bank_account = '${old}' where id = '${without}'`);
  sql(`update professionals set bank_account = '${JSON.stringify({ ...jepAccount, number: "4100555666" })}' where id = '${without}'`);
  ok(banks(without) === "Cooperativa JEP,Banco Pichincha", "si el código anterior cambia la cuenta, reemplaza la primera y conserva las demás", banks(without));
  sql(`update professionals set display_name = display_name where id = '${without}'`);
  ok(banks(without) === "Cooperativa JEP,Banco Pichincha", "otros cambios no tocan las cuentas", banks(without));
  sql(`update professionals set bank_account = null where id = '${without}'`);
  ok(banks(without) === "", "si la quita, se queda sin cuentas", banks(without));
  const inserted = sql(
    `insert into professionals (business_id, display_name, bank_account) select business_id, 'Agenda del código anterior', '${old}'::jsonb
       from professionals where id = '${without}' returning bank_accounts = jsonb_build_array(bank_account)`,
  ).split("\n")[0];
  ok(inserted === "t", "y una agenda que crea con cuenta la tiene también en la lista", inserted);
}

console.log(failures === 0 ? "\nTodo bien." : `\n${failures} fallos.`);
process.exitCode = failures === 0 ? 0 : 1;
