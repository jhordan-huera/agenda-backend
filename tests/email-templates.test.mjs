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
  emailTemplates.businessCreated({ firstName: "Ana", businessName: "Estudio", email: "ana@example.com", password: "Clave2026!", loginUrl: "https://agenda.example/login", bookingUrl: "https://agenda.example/book/estudio" }),
  emailTemplates.teamInvite({ firstName: "Luis", businessName: "Estudio", roleLabel: "Staff", email: "luis@example.com", password: "Clave2026!", loginUrl: "https://agenda.example/login" }),
  emailTemplates.passwordChanged("Ana", "ana@example.com", "Nueva2026!", "https://agenda.example/login"),
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
ok(/Contraseña: Clave2026!/.test(created.body) && /Iniciar sesión: https:\/\/agenda\.example\/login/.test(created.body), "texto: datos de acceso y enlace del botón", created.body);
ok(/href="https:\/\/agenda\.example\/login"/.test(created.html) && /Si el botón no funciona/.test(created.html), "HTML: botón con enlace y alternativa en texto");
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

console.log("Pago por transferencia: una cuenta o varias");
const pichincha = { bank: "Banco Pichincha", accountType: "savings", number: "2200123456", holder: "Ana Pérez", holderId: "1712345678" };
const guayaquil = { bank: "Banco Guayaquil", accountType: "checking", number: "0012345678", holder: "Ana Pérez", holderId: "" };
const withPayment = (bankAccounts) => ({ ...appointment, showPrice: true, payment: { bankAccounts, url: "https://agenda.example/pago/abc" } });
const one = emailTemplates.bookingCreated(withPayment([pichincha])).body;
ok(
  /Pago por transferencia\nBanco: Banco Pichincha\nTipo de cuenta: Ahorros\nNúmero de cuenta: 2200123456\nTitular: Ana Pérez\nCédula \/ RUC: 1712345678\nMonto: \$35/.test(one) &&
    !/cualquiera/.test(one),
  "una cuenta: un recuadro con sus datos y el monto, como siempre",
  one,
);
const two = emailTemplates.appointmentConfirmed(withPayment([pichincha, guayaquil]));
ok(
  /Pago por transferencia: transfiere \$35 a cualquiera de estas 2 cuentas\./.test(two.body) &&
    /Cuenta 1\nBanco: Banco Pichincha/.test(two.body) &&
    /Cuenta 2\nBanco: Banco Guayaquil\nTipo de cuenta: Corriente\nNúmero de cuenta: 0012345678\nTitular: Ana Pérez\n\n/.test(two.body) &&
    /Enviar el comprobante: https:\/\/agenda\.example\/pago\/abc/.test(two.body),
  "varias: el monto en el texto y un recuadro por cuenta (la segunda, sin cédula)",
  two.body,
);
ok(two.html.includes("2200123456") && two.html.includes("0012345678") && two.html.includes("Cuenta 2"), "también en el HTML");
const hidden = emailTemplates.bookingCreated({ ...withPayment([pichincha, guayaquil]), showPrice: false }).body;
ok(/transfiere a cualquiera de estas 2 cuentas/.test(hidden) && !/\$35/.test(hidden), "con el precio oculto, sin monto", hidden);
ok(!/Pago por transferencia/.test(emailTemplates.bookingCreated({ ...appointment, payment: { bankAccounts: [], url: "https://agenda.example/pago/abc" } }).body), "sin cuentas, sin bloque de pago");


console.log("Copia al profesional");
const professionalCopy = { agendaUrl: "https://agenda.example/dashboard/calendar?date=2026-05-04", pending: false };
const original = emailTemplates.appointmentConfirmed(appointment);
const copy = emailTemplates.appointmentConfirmed({ ...appointment, professionalCopy });
ok(copy.subject === `Copia · ${appointment.clientName}: ${original.subject}`, "el asunto dice de qué paciente es", copy.subject);
ok(copy.body.startsWith(`Copia para ti del email que recibió ${appointment.clientName}.`) && copy.body.endsWith(original.body), "arriba la nota y debajo el mismo email que recibió el paciente", copy.body);
ok(/Ver en la agenda: https:\/\/agenda\.example\/dashboard\/calendar/.test(copy.body) && /href="https:\/\/agenda\.example\/dashboard\/calendar/.test(copy.html), "con el botón para abrir la cita en la agenda");
ok(copy.html.indexOf("Copia para ti") < copy.html.indexOf("<h1"), "la nota va antes del título");
ok(!/Copia/.test(original.subject + original.body + original.html), "el email al paciente no cambia");
ok(/pendiente: confírmala en tu agenda/.test(emailTemplates.bookingCreated({ ...appointment, professionalCopy: { ...professionalCopy, pending: true } }).body), "si está pendiente, lo recuerda");

console.log("«Tu cita»: el enlace del paciente (spec 010)");
const pageUrl = "https://agenda.example/cita/0123456789abcdef0123456789abcdef";
const withPage = { ...appointment, appointmentPage: { url: pageUrl, canCancel: true, confirmed: false } };
const active = {
  bookingCreated: emailTemplates.bookingCreated(withPage),
  appointmentConfirmed: emailTemplates.appointmentConfirmed(withPage),
  appointmentUpdated: emailTemplates.appointmentUpdated(withPage),
  appointmentRestored: emailTemplates.appointmentRestored(withPage),
  appointmentPending: emailTemplates.appointmentPending(withPage),
  appointmentReminder: emailTemplates.appointmentReminder(withPage, "mañana"),
};
for (const [name, email] of Object.entries(active)) {
  ok(
    email.body.includes(`Ver o cancelar mi cita: ${pageUrl}`) && email.html.includes(`href="${pageUrl}"`) && email.html.includes(">Ver o cancelar mi cita</a>"),
    `${name}: lleva «Ver o cancelar mi cita» (en el texto y en el HTML)`,
    email.body,
  );
}
const closed = {
  appointmentCancelled: emailTemplates.appointmentCancelled(withPage),
  appointmentCompleted: emailTemplates.appointmentCompleted(withPage),
  appointmentNoShow: emailTemplates.appointmentNoShow(withPage),
};
for (const [name, email] of Object.entries(closed)) {
  ok(!/\/cita\//.test(email.body + email.html), `${name}: sin el enlace a «Tu cita»`, email.body);
}
const confirmedMail = active.appointmentConfirmed.body;
ok(
  confirmedMail.indexOf("Ver o cancelar mi cita") > confirmedMail.indexOf("Cómo llegar") &&
    !/Si el botón no funciona/.test(active.appointmentConfirmed.html),
  "debajo de los datos de la cita, como enlace (no es un botón: no ocupa el «Si el botón no funciona»)",
  confirmedMail,
);
const paying = emailTemplates.appointmentConfirmed({ ...withPage, payment: { bankAccounts: [pichincha], url: "https://agenda.example/pago/abc" } });
ok(
  paying.body.indexOf("Ver o cancelar mi cita") < paying.body.indexOf("Pago por transferencia") &&
    /Si el botón no funciona[^]*agenda\.example\/pago\/abc/.test(paying.html),
  "antes del pago, y el enlace de respaldo sigue siendo el del comprobante",
  paying.body,
);
const noCancel = emailTemplates.appointmentConfirmed({ ...withPage, appointmentPage: { ...withPage.appointmentPage, canCancel: false } });
ok(noCancel.body.includes(`Ver mi cita: ${pageUrl}`) && !/cancelar mi cita/.test(noCancel.body), "si no podrá cancelar desde ahí: «Ver mi cita»", noCancel.body);
const reminder = active.appointmentReminder;
ok(
  reminder.body.includes(`Confirmo que voy: ${pageUrl}?confirmar=1`) && reminder.html.includes(`href="${pageUrl}?confirmar=1"`),
  "el recordatorio lleva el botón «Confirmo que voy» con ?confirmar=1",
  reminder.body,
);
ok(
  reminder.body.indexOf("Confirmo que voy") < reminder.body.indexOf("Ver o cancelar mi cita") &&
    /Si el botón no funciona[^]*\?confirmar=1/.test(reminder.html),
  "con el enlace debajo, y «Confirmo que voy» como enlace de respaldo",
  reminder.body,
);
const alreadyConfirmed = emailTemplates.appointmentReminder({ ...withPage, appointmentPage: { ...withPage.appointmentPage, confirmed: true } }, "mañana");
ok(
  alreadyConfirmed.body.includes("Ya nos confirmaste que vienes. ¡Gracias!") && !alreadyConfirmed.body.includes("?confirmar=1") && alreadyConfirmed.body.includes(pageUrl),
  "si ya confirmó: el gracias en lugar del botón, y el enlace",
  alreadyConfirmed.body,
);
const copies = [
  ...Object.keys(active).map((name) =>
    name === "appointmentReminder"
      ? emailTemplates.appointmentReminder({ ...withPage, professionalCopy }, "mañana")
      : emailTemplates[name]({ ...withPage, professionalCopy }),
  ),
];
ok(copies.every((email) => !/\/cita\//.test(email.body + email.html) && !/Confirmo que voy|Ya nos confirmaste/.test(email.body)), "la copia al profesional nunca lleva los botones del paciente");
ok(
  emailTemplates.bookingReceived(withPage).body.indexOf("/cita/") === -1 &&
    emailTemplates.paymentReceiptReceived({ ...withPage, agendaUrl: "https://agenda.example/dashboard" }).body.indexOf("/cita/") === -1 &&
    emailTemplates.professionalNewAppointment({ ...withPage, origin: "booking_page", agendaUrl: "https://agenda.example/dashboard" }).body.indexOf("/cita/") === -1,
  "ni los avisos al negocio y al profesional",
);
const byPatient = emailTemplates.appointmentCancelled({ ...appointment, professionalCopy: { ...professionalCopy, byPatient: true } });
ok(
  byPatient.body.startsWith(`Copia para ti del email que recibió ${appointment.clientName}. La canceló el paciente desde su email.`),
  "la copia de la cancelación del paciente lo dice",
  byPatient.body.slice(0, 200),
);
const notice = emailTemplates.patientCancelled({ ...appointment, clientName: "Ana Torres", agendaUrl: "https://agenda.example/dashboard/calendar?date=2026-10-12" });
ok(
  notice.subject === "Cita cancelada por el paciente: Ana Torres · Lunes, 12 de octubre de 2026 10:00" &&
    /Ana Torres canceló su cita desde el enlace de sus emails\. La hora quedó libre/.test(notice.body) &&
    /Precio: \$35/.test(notice.body) &&
    /Ver en la agenda: https:\/\/agenda\.example\/dashboard/.test(notice.body),
  "el aviso al negocio: quién canceló, la cita con su precio y el botón de la agenda",
  notice,
);
const unsafe = emailTemplates.appointmentConfirmed({ ...appointment, appointmentPage: { url: "javascript:alert(1)", canCancel: true, confirmed: false } });
ok(!unsafe.html.includes("javascript:"), "un enlace que no es http(s) tampoco llega al HTML del bloque nuevo");

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas de plantillas de email pasaron");
process.exitCode = failures ? 1 : 0;
