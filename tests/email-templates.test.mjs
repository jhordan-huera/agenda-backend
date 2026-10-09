// Plantillas de email: versión HTML y de texto, escape de datos y enlaces.
import { describeTimezone, isValidTimezone } from "../src/shared/lib/constants/business.ts";
import { emailTemplates } from "../src/shared/lib/email/templates.ts";

let failures = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300));
  }
};

const appointment = {
  clientName: "María <script>alert(1)</script>",
  businessName: "Clínica & Co",
  businessAddress: "Av. Siempre Viva 742",
  businessLat: null,
  businessLng: null,
  businessPhone: "+593 99 000 0000",
  professionalName: "Ana Pérez",
  serviceName: "Limpieza",
  date: "2026-10-12",
  startTime: "10:00",
  endTime: "10:45",
  price: 35,
  showPrice: false,
  currency: "USD",
  cancellationPolicy: "",
  bookingUrl: "https://agenda.example/book/clinica",
  homeVisit: null,
};

console.log("Todas las plantillas");
const all = [
  emailTemplates.welcome("Ana"),
  emailTemplates.businessCreated({ firstName: "Ana", businessName: "Estudio", email: "ana@example.com", setPasswordUrl: "https://agenda.example/definir-contrasena?token=abc", linkMinutes: 60, bookingUrl: "https://agenda.example/book/estudio" }),
  emailTemplates.teamInvite({ firstName: "Luis", businessName: "Estudio", roleLabel: "Staff", email: "luis@example.com", setPasswordUrl: "https://agenda.example/definir-contrasena?token=abc", linkMinutes: 60 }),
  emailTemplates.passwordSetupLink({ firstName: "Ana", email: "ana@example.com", setPasswordUrl: "https://agenda.example/definir-contrasena?token=xyz", linkMinutes: 60 }),
  emailTemplates.platformAdminAdded({ firstName: "Sofía", addedBy: "Admin", email: "sofia@example.com", setPasswordUrl: "https://agenda.example/definir-contrasena?token=def", linkMinutes: 60 }),
  emailTemplates.businessSuspended("Ana", "Estudio", "soporte@example.com"),
  emailTemplates.businessReactivated("Ana", "Estudio", "https://agenda.example/login"),
  emailTemplates.planChangeRequested({ businessName: "Estudio", requestedByName: "Ana", requestedByEmail: "ana@example.com", currentPlanName: "Free", requestedPlanName: "Pro", reviewUrl: "https://agenda.example/admin" }),
  emailTemplates.planChangeApproved("Ana", "Estudio", "Pro", "https://agenda.example/dashboard/settings"),
  emailTemplates.planChanged("Ana", "Estudio", "Pro", "https://agenda.example/dashboard/settings"),
  emailTemplates.planChangeRejected("Ana", "Estudio", "Pro", "Falta el pago", "soporte@example.com"),
  emailTemplates.bookingCreated(appointment),
  emailTemplates.bookingReceived(appointment),
  emailTemplates.appointmentConfirmed(appointment),
  emailTemplates.appointmentUpdated(appointment),
  emailTemplates.appointmentRestored(appointment),
  emailTemplates.appointmentCancelled(appointment),
  emailTemplates.appointmentReminder(appointment, "mañana"),
];
ok(all.every((email) => email.subject && email.body && email.html.startsWith("<!doctype html>")), "cada email trae asunto, texto y HTML");
ok(all.every((email) => !/undefined|null|\[object Object\]/.test(email.body + email.html)), "sin valores vacíos colados en el texto");

console.log("Seguridad y contenido");
const confirmed = emailTemplates.appointmentConfirmed(appointment);
ok(!confirmed.html.includes("<script>") && confirmed.html.includes("&lt;script&gt;"), "los datos se escapan en el HTML", confirmed.html.match(/Hola[^<]*/)?.[0]);
ok(confirmed.html.includes("Clínica &amp; Co"), "también el nombre del negocio");
ok(!/Precio/.test(confirmed.body) && !/Precio/.test(confirmed.html), "sin precio cuando el servicio lo oculta");
ok(/Precio: \$35/.test(emailTemplates.bookingReceived(appointment).body), "el negocio sí ve el precio");
const created = all[1];
ok(
  /Definir mi contraseña: https:\/\/agenda\.example\/definir-contrasena\?token=abc/.test(created.body) && /60 minutos/.test(created.body) && !/Contraseña:/.test(created.body),
  "texto: enlace para definir la contraseña (sin contraseña) y cuánto dura",
  created.body,
);
ok(/href="https:\/\/agenda\.example\/definir-contrasena\?token=abc"/.test(created.html) && /Si el botón no funciona/.test(created.html), "HTML: botón con el enlace y alternativa en texto");
ok(all.slice(1, 5).every((email) => !/Contraseña: /.test(email.body) && /Definir mi contraseña: https:/.test(email.body)), "ningún email de cuenta lleva una contraseña: todos, el enlace");
ok(/Email de acceso: ana@example\.com/.test(all[3].body) && /token=xyz/.test(all[3].html), "enlace de soporte: email de acceso y botón", all[3].body);
const malicious = emailTemplates.appointmentCancelled({ ...appointment, bookingUrl: "javascript:alert(1)" });
ok(!malicious.html.includes("javascript:"), "un enlace que no es http(s) no llega al HTML");

console.log("Zona horaria en las citas virtuales");
const virtual = { ...appointment, isVirtual: true, meetingUrl: null, payment: null, timezone: "America/Guayaquil" };
ok(/Hora: 10:00 – 10:45 \(hora de Ecuador, GMT-5\)/.test(emailTemplates.appointmentConfirmed(virtual).body), "virtual: la hora con la zona del negocio", emailTemplates.appointmentConfirmed(virtual).body);
ok(/a las 10:00 \(hora de Ecuador, GMT-5\)/.test(emailTemplates.appointmentReminder(virtual, "mañana").html), "también en el resumen del recordatorio");
ok(!/hora de/.test(emailTemplates.appointmentConfirmed({ ...virtual, isVirtual: false }).body), "en el local, sin zona");
ok(describeTimezone("Europe/Madrid", new Date("2026-07-01T12:00:00Z")) === "hora de España – Madrid, GMT+2", "con el horario de verano de ese día", describeTimezone("Europe/Madrid", new Date("2026-07-01T12:00:00Z")));
ok(describeTimezone("America/Toronto", new Date("2026-01-15T12:00:00Z")) === "hora de America/Toronto, GMT-5", "una zona fuera de la lista: su nombre", describeTimezone("America/Toronto", new Date("2026-01-15T12:00:00Z")));
ok(isValidTimezone("America/Guayaquil") && isValidTimezone("America/Toronto") && isValidTimezone("UTC"), "zonas válidas");
ok(!isValidTimezone("Marte/Olimpo") && !isValidTimezone("") && !isValidTimezone("+05:00") && !isValidTimezone("America/Guayaquil; drop"), "zonas que no existen");
const restored = emailTemplates.appointmentRestored(appointment);
ok(restored.subject === "Tu cita ha sido restablecida" && /había sido cancelada/.test(restored.body) && /Hora: 10:00 – 10:45/.test(restored.body), "cita restablecida, con sus datos", restored.body);

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas de plantillas de email pasaron");
process.exitCode = failures ? 1 : 0;
