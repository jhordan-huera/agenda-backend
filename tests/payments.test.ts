// Pago por transferencia: datos bancarios de la agenda, enlace de pago, comprobantes en el
// almacenamiento (bucket privado) y logos y fotos en el bucket público de imágenes.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
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
const professionalInput = (bankAccount: unknown) => {
  const { id: _id, businessId: _b, sortOrder: _s, createdAt: _c, ...rest } = professional;
  return { ...rest, bankAccount };
};
const account = { bank: "Produbanco", accountType: "checking", number: "0200-123 456", holder: "Jhordan Demo", holderId: "1712345678" };
let r = await owner("PUT", `${B}/professionals/${professional.id}`, professionalInput({ ...account, number: "abc" }));
ok(r.status === 400 && /número de cuenta/.test(r.body.error.message), "número de cuenta con letras → 400", r.body);
r = await owner("PUT", `${B}/professionals/${professional.id}`, professionalInput({ ...account, accountType: "otra" }));
ok(r.status === 400, "tipo de cuenta inválido → 400", r.body);
r = await owner("PUT", `${B}/professionals/${professional.id}`, professionalInput(account));
ok(r.status === 200 && r.body.bankAccount?.number === "0200123456" && r.body.bankAccount.accountType === "checking", "se guarda (el número, sólo con dígitos)", r.body);
const changes = (await owner("GET", `${B}/audit-logs?entityId=${professional.id}`)).body.entries[0]?.changes ?? [];
ok(changes.some((c: { label: string; after: string }) => c.label === "Datos bancarios" && /Produbanco · Corriente/.test(c.after)), "la actividad registra el cambio", changes);

console.log("Reserva con pago por transferencia");
const services = (await owner("GET", `${B}/services`)).body;
const paid = services.find((s: { price: number; showPrice: boolean; isActive: boolean; modes: string[] }) => s.price > 0 && s.showPrice && s.isActive && s.modes.includes("business"));
const free = (
  await owner("POST", `${B}/services`, {
    name: "Valoración gratuita", description: "", durationMinutes: 30, price: 0, showPrice: true, homeVisitFee: 0,
    clinicalTemplateId: null, isActive: true, modes: ["business"],
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
ok(r.status === 200 && booking.payment?.bankAccount?.bank === "Produbanco" && /^[0-9a-f]{32}$/.test(booking.payment.token) && booking.payment.receiptsEnabled, "la confirmación trae los datos y el enlace de pago", r.body);
const token: string = booking.payment.token;
const created = sql(`select body from notifications where to_email = 'pago1@example.com' and type = 'booking_created'`);
ok(/Pago por transferencia/.test(created) && /0200123456/.test(created) && created.includes(`/pago/${token}`), "el email de la reserva trae los datos y el enlace", created.slice(0, 400));
r = await book(free.id, slots[1], "gratis1");
ok(r.status === 200 && r.body.payment === null, "un servicio gratis no pide pago", r.body);

console.log("Enlace de pago (sin sesión)");
const anonymous = agent();
r = await anonymous("GET", `/public/payments/${token}`);
ok(
  r.status === 200 && r.body.amount === paid.price && r.body.bankAccount.number === "0200123456" && r.body.clientName === "Paciente P." &&
    r.body.receipts.length === 0 && r.body.paid === false && r.body.receiptsEnabled,
  "muestra monto, cuenta y nombre abreviado",
  r.body,
);
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
for (let i = 2; i <= 5; i++) {
  const { body } = await anonymous("POST", `/public/payments/${token}/receipts`, { ...receiptInput, fileName: `otro-${i}.png` });
  await put(body.upload, PNG);
  await anonymous("POST", `/public/payments/${token}/receipts/${body.receipt.id}/complete`);
}
r = await anonymous("POST", `/public/payments/${token}/receipts`, receiptInput);
ok(r.status === 409 && /varios comprobantes/.test(r.body.error.message), "más de 5 comprobantes por cita → 409", r.body);
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

console.log(failures === 0 ? "\nTodo bien." : `\n${failures} fallos.`);
process.exitCode = failures === 0 ? 0 : 1;
