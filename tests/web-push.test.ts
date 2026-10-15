// Avisos en el celular (spec 013, R1): el cifrado (RFC 8291), la firma VAPID (RFC 8292), las claves y las
// direcciones permitidas, sin red ni base de datos. El cifrado se comprueba con el ejemplo oficial del
// apéndice A de la RFC 8291, byte a byte: si un byte no coincide, ningún navegador podría leer el aviso.
import { createECDH, createPublicKey, randomBytes, verify } from "node:crypto";
import { checks, decryptPushPayload } from "./helpers/harness.ts";
import {
  encryptPushPayload,
  generateVapidKeys,
  isAllowedPushEndpoint,
  isValidPushKeys,
  pushServiceName,
  vapidAuthorization,
  vapidKeysProblem,
} from "../src/services/web-push.ts";

const { ok, done } = checks();
const b64 = (value: string) => Buffer.from(value, "base64url");

console.log("Cifrado: el ejemplo del apéndice A de la RFC 8291");
// Los valores, tal cual los publica la RFC (base64url).
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  serverPrivateKey: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  serverPublicKey: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  userAgentPrivateKey: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  userAgentPublicKey: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  header: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  ciphertext: "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
};
const rfcKeys = { p256dh: RFC.userAgentPublicKey, auth: RFC.authSecret };
const encrypted = encryptPushPayload(RFC.plaintext, rfcKeys, { salt: b64(RFC.salt), serverPrivateKey: b64(RFC.serverPrivateKey) });
const expected = Buffer.concat([b64(RFC.header), b64(RFC.ciphertext)]);
ok(encrypted.length === expected.length, `mismo largo que la RFC (${expected.length} bytes)`, encrypted.length);
const firstDifference = [...expected].findIndex((byte, index) => encrypted[index] !== byte);
ok(encrypted.equals(expected), "da exactamente el mensaje de la RFC, byte a byte", { firstDifference });
ok(encrypted.subarray(0, 86).equals(b64(RFC.header)), "la cabecera: sal, tamaño de registro 4096, largo 65 y la clave efímera");
ok(encrypted.readUInt32BE(16) === 4096 && encrypted[20] === 65, "tamaño de registro 4096 y clave de 65 bytes");
ok(encrypted.subarray(21, 86).equals(b64(RFC.serverPublicKey)), "la clave efímera es la pública del servidor de la RFC");
const rfcDevice = createECDH("prime256v1");
rfcDevice.setPrivateKey(b64(RFC.userAgentPrivateKey));
ok(rfcDevice.getPublicKey().equals(b64(RFC.userAgentPublicKey)), "la clave privada del aparato de la RFC da su pública");
ok(decryptPushPayload(encrypted, { ecdh: rfcDevice, auth: b64(RFC.authSecret) }) === RFC.plaintext, "y el aparato de la RFC lo descifra");

console.log("Cifrado de punta a punta, con claves al azar");
const device = createECDH("prime256v1");
device.generateKeys();
const auth = randomBytes(16);
const deviceKeys = { p256dh: device.getPublicKey().toString("base64url"), auth: auth.toString("base64url") };
const notice = JSON.stringify({ title: "Nueva reserva", body: "Mañana 16:00 · Limpieza · Juan P.", url: "/dashboard/calendar?date=2026-10-15&appointment=x", tag: "reserva-x", kind: "booking" });
const once = encryptPushPayload(notice, deviceKeys);
const twice = encryptPushPayload(notice, deviceKeys);
ok(decryptPushPayload(once, { ecdh: device, auth }) === notice, "el aparato recupera el JSON del aviso (con eñes y tildes)");
ok(!once.equals(twice) && !once.subarray(0, 16).equals(twice.subarray(0, 16)), "cada envío lleva otra sal y otra clave efímera");
ok(!once.includes(Buffer.from("Juan")), "el servicio de avisos no ve el texto");
const other = createECDH("prime256v1");
other.generateKeys();
let foreign = true;
try {
  decryptPushPayload(once, { ecdh: other, auth });
  foreign = false;
} catch {
  // Con otra clave, la etiqueta de AES-GCM no cuadra.
}
ok(foreign, "otro aparato no lo puede descifrar");
let tooLong = false;
try {
  encryptPushPayload("x".repeat(5000), deviceKeys);
} catch {
  tooLong = true;
}
ok(tooLong, "un aviso que no cabe en un registro se rechaza");

console.log("Claves VAPID");
const vapidPair = generateVapidKeys();
ok(vapidPair.publicKey.length === 87 && vapidPair.privateKey.length === 43, "generateVapidKeys: 87 y 43 caracteres", [vapidPair.publicKey.length, vapidPair.privateKey.length]);
ok(/^[A-Za-z0-9_-]+$/.test(vapidPair.publicKey + vapidPair.privateKey), "en base64url, sin relleno");
ok(b64(vapidPair.publicKey)[0] === 0x04 && b64(vapidPair.publicKey).length === 65, "la pública es un punto P-256 sin comprimir");
ok(vapidKeysProblem(vapidPair.publicKey, vapidPair.privateKey) === null, "el par sirve");
ok(vapidKeysProblem(undefined, undefined) === "faltan VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY", "sin claves: dice cuáles faltan");
ok(vapidKeysProblem(vapidPair.publicKey, undefined) === "falta VAPID_PRIVATE_KEY", "sin la privada");
ok(vapidKeysProblem("no-es-una-clave", vapidPair.privateKey) === "VAPID_PUBLIC_KEY no es válida", "una pública mal copiada");
ok(vapidKeysProblem(vapidPair.publicKey, generateVapidKeys().privateKey) === "VAPID_PRIVATE_KEY no corresponde a VAPID_PUBLIC_KEY", "una privada de otro par");
const problems = [vapidKeysProblem(vapidPair.publicKey, "x"), vapidKeysProblem("y", vapidPair.privateKey)].join(" ");
ok(!problems.includes(vapidPair.publicKey) && !problems.includes(vapidPair.privateKey), "los mensajes nunca muestran un valor");

console.log("Firma VAPID (JWT ES256)");
const vapid = { ...vapidPair, subject: "mailto:avisos@example.com" };
const now = Date.UTC(2026, 9, 14, 21, 0, 0);
const header = vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", vapid, now);
const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
ok(Boolean(match) && match![2] === vapid.publicKey, "Authorization: vapid t=<jwt>, k=<clave pública>", header.slice(0, 40));
const [jwtHeader, jwtPayload, jwtSignature] = (match?.[1] ?? "..").split(".");
const parsedHeader = JSON.parse(b64(jwtHeader).toString());
const parsedPayload = JSON.parse(b64(jwtPayload).toString());
ok(parsedHeader.typ === "JWT" && parsedHeader.alg === "ES256", "cabecera con typ y alg: ES256", parsedHeader);
ok(parsedPayload.aud === "https://fcm.googleapis.com", "aud: el origen del servicio de avisos (sin la ruta del aparato)", parsedPayload);
ok(parsedPayload.exp === Math.floor(now / 1000) + 12 * 3600, "exp: a 12 h", parsedPayload.exp);
ok(parsedPayload.sub === "mailto:avisos@example.com", "sub: el contacto");
const jwk = { kty: "EC", crv: "P-256", x: b64(vapid.publicKey).subarray(1, 33).toString("base64url"), y: b64(vapid.publicKey).subarray(33).toString("base64url") };
const publicKey = createPublicKey({ key: jwk, format: "jwk" });
ok(b64(jwtSignature).length === 64, "firma en formato JOSE (r y s, 64 bytes)");
ok(verify("sha256", Buffer.from(`${jwtHeader}.${jwtPayload}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, b64(jwtSignature)), "crypto.verify la acepta con la clave pública");
ok(!verify("sha256", Buffer.from(`${jwtHeader}.${jwtPayload}x`), { key: publicKey, dsaEncoding: "ieee-p1363" }, b64(jwtSignature)), "y rechaza un contenido cambiado");
ok(vapidAuthorization("https://fcm.googleapis.com/fcm/send/otro", vapid, now + 60_000) === header, "el mismo servicio reutiliza el JWT mientras le quede más de 1 h");
ok(vapidAuthorization("https://fcm.googleapis.com/fcm/send/otro", vapid, now + 11.5 * 3600_000) !== header, "y lo renueva cuando le queda menos");
const apple = vapidAuthorization("https://web.push.apple.com/QGuQ", vapid, now);
ok(apple !== header && JSON.parse(b64(/t=([^.]+)\.([^.]+)/.exec(apple)![2]).toString()).aud === "https://web.push.apple.com", "para otro servicio se firma otro");

console.log("Direcciones permitidas (R4)");
for (const endpoint of [
  "https://fcm.googleapis.com/fcm/send/abc:def",
  "https://fcm.googleapis.com/wp/abc",
  "https://jmt17.google.com/fcm/send/abc:def",
  "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
  "https://web.push.apple.com/QGuQyavXutnMH",
  "https://wns2-par02p.notify.windows.com/w/?token=abc",
  "https://fcm.googleapis.com:443/fcm/send/abc",
]) {
  ok(isAllowedPushEndpoint(endpoint), `acepta ${new URL(endpoint).hostname}`);
}
for (const [label, endpoint] of [
  ["http://", "http://fcm.googleapis.com/fcm/send/abc"],
  ["otro puerto", "https://fcm.googleapis.com:8443/fcm/send/abc"],
  ["la IP de los metadatos de la nube", "https://169.254.169.254/latest/meta-data"],
  ["localhost", "https://localhost/push"],
  ["un dominio parecido", "https://fcm.googleapis.com.ejemplo.net/fcm/send/abc"],
  ["otro dominio que termina igual", "https://evilfcm.googleapis.com/x"],
  ["otro servicio de Google", "https://script.google.com/macros/s/x/exec"],
  ["un dominio parecido al de Chrome", "https://jmt17.google.com.ejemplo.net/fcm/send/x"],
  ["sólo el sufijo de Windows", "https://notify.windows.com/x"],
  ["un subdominio de Windows dentro de otro dominio", "https://a.notify.windows.com.ejemplo.net/x"],
  ["una dirección con usuario", "https://usuario:clave@fcm.googleapis.com/fcm/send/abc"],
  ["algo que no es una dirección", "no es una dirección"],
  ["127.0.0.1 sin base local", "http://127.0.0.1:4100/aparato"],
] as const) {
  ok(!isAllowedPushEndpoint(endpoint), `rechaza ${label}`);
}
ok(isAllowedPushEndpoint("http://127.0.0.1:4100/aparato/1", { allowLocal: true }), "con la base local acepta http://127.0.0.1:<puerto> (el servicio falso de las pruebas)");
ok(!isAllowedPushEndpoint("http://localhost:4100/aparato/1", { allowLocal: true }) && !isAllowedPushEndpoint("http://127.0.0.1/aparato", { allowLocal: true }), "pero ni localhost ni sin puerto");
ok(!isAllowedPushEndpoint("http://169.254.169.254:80/x", { allowLocal: true }), "ni otras IP");
ok(pushServiceName("https://wns2-par02p.notify.windows.com/w/?token=secreto") === "notify.windows.com" && pushServiceName("https://fcm.googleapis.com/fcm/send/secreto") === "fcm.googleapis.com", "en los registros sólo el servicio, nunca la dirección");

console.log("Claves del aparato");
ok(isValidPushKeys(deviceKeys), "unas claves de verdad sirven");
const notOnCurve = Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 1)]).toString("base64url");
ok(!isValidPushKeys({ p256dh: notOnCurve, auth: deviceKeys.auth }), "p256dh que no es un punto P-256: se rechaza");
ok(!isValidPushKeys({ p256dh: device.getPublicKey("base64url", "compressed"), auth: deviceKeys.auth }), "una clave comprimida (33 bytes): se rechaza");
ok(!isValidPushKeys({ p256dh: deviceKeys.p256dh, auth: randomBytes(15).toString("base64url") }), "auth de 15 bytes: se rechaza");
ok(!isValidPushKeys({ p256dh: "%%%", auth: deviceKeys.auth }), "algo que no es base64url: se rechaza");

done("del envío de avisos en el celular (Web Push)");
