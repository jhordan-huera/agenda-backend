// Recordatorio de control (spec 051). «Volver en» en el servicio (con la actividad; un panel anterior lo conserva); la
// hoja «Controles» (los vencidos y los de los próximos 30 días, la última cita Atendida, sin quien tiene una cita por
// delante, sin pacientes desactivados, sólo el principal de una pareja, el rol Profesional sólo su agenda, otro negocio
// 403) y la ficha; «Quitar» (con la actividad); el interruptor (Recepción no, la actividad, la fecha); el envío
// (queueControlReminders, con el momento como parámetro): desde las 10:00, una sola vez, hasta 30 días tarde, nunca por
// lo que ya había vencido al encenderlo o al poner «Volver en», sin email, con la marca, con una cita por delante o
// quitado, no; dos controles en un email; sin copia al profesional; el enlace para no recibir más; el borrado con el
// paciente. Servicios y pacientes propios de la prueba: las demás suites no los tocan.
import { cedulaFor } from "./helpers/cedula.mjs";
import { agent, checks, count, login, sql } from "./helpers/harness.ts";
import { addDaysISO } from "../src/shared/lib/time.ts";
import type { Business, ControlReminder, PublicControlReminder, Service } from "../src/shared/types/index.ts";

const { ok, done } = checks();
const { queueControlReminders } = await import("../src/jobs/scheduled-tasks.ts");

let ipSeq = 0;
const nextIp = () => `198.21.0.${(ipSeq++ % 250) + 1}`;
const as = (email: string) => login(email, { ip: nextIp() });
const anonymous = () => agent({ ip: nextIp() });

const ricardo = await as("ricardo@demo.com"); // propietario
const elena = await as("elena@demo.com"); // Recepción
const valeria = await as("valeria@demo.com"); // rol Profesional
const laura = await as("laura@demo.com"); // otro negocio
const businessId: string = ricardo.session.businessId;
const B = `/businesses/${businessId}`;
const slug = sql(`select slug from businesses where id = '${businessId}'`);
const zone = sql(`select timezone from businesses where id = '${businessId}'`);
const T = sql(`select (now() at time zone '${zone}')::date`);
const agendaOf = (email: string) =>
  sql(`select id from professionals where business_id = '${businessId}' and user_id = (select id from users where email = '${email}')`);
const ricardoAgenda = agendaOf("ricardo@demo.com");
const valeriaAgenda = agendaOf("valeria@demo.com");
const at = (date: string, time: string) =>
  new Date(sql(`select to_char(((date '${date}' + time '${time}') at time zone '${zone}') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`));

const tag = Date.now().toString(36);
const serviceInput = (name: string, returnAfterDays?: number | null) => ({
  name,
  description: "",
  durationMinutes: 30,
  price: 20,
  showPrice: true,
  modes: ["business"],
  isActive: true,
  ...(returnAfterDays === undefined ? {} : { returnAfterDays }),
});
let seq = 0;
const patient = (name: string, options: { email?: boolean; active?: boolean } = {}) => {
  const email = options.email === false ? "" : `control.${++seq}.${tag}@correo.ec`;
  const id = sql(
    `insert into clients (business_id, name, document_id, email, phone, is_active)
     values ('${businessId}', '${name}', '${cedulaFor(`${tag}-${seq}-${name}`)}', '${email}', '+593 99 123 4567', ${options.active !== false})
     returning id`,
  ).split("\n")[0];
  return { id, email, name };
};
let minute = 0;
const appointment = (clientId: string, serviceId: string, date: string, status = "completed", agenda = ricardoAgenda) => {
  minute += 20;
  const start = `${String(19 + Math.floor((minute % 240) / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  return sql(
    `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source)
     values ('${businessId}', '${clientId}', '${serviceId}', '${agenda}', '${date}', '${start}', '${start}'::time + interval '15 minutes', '${status}', 20, 'dashboard')
     returning id`,
  ).split("\n")[0];
};
const auditCount = (action: string) => count(`select count(*) from audit_logs where business_id = '${businessId}' and action = '${action}'`);
const emailsTo = (email: string) => count(`select count(*) from notifications where type = 'control_reminder' and to_email = '${email}'`);
const businessNow = async () => (await ricardo("GET", B)).body as Business;
const setControls = async (browser: typeof ricardo, on: boolean) => {
  const current = await businessNow();
  return browser("PATCH", B, { notificationSettings: { ...current.notificationSettings, controlReminders: on } });
};
const listOf = async (browser: typeof ricardo, clientId?: string) =>
  (await browser("GET", `${B}/control-reminders${clientId ? `?clientId=${clientId}` : ""}`)).body as ControlReminder[];
const inList = (list: ControlReminder[], clientId: string) => list.filter((control) => control.clientId === clientId);

/* ======================================================================================== */
console.log("«Volver en» en el servicio");
let r = await ricardo("POST", `${B}/services`, serviceInput(`Limpieza ${tag}`));
const limpieza = r.body as Service;
ok(r.status === 200 && limpieza.returnAfterDays === null, "un servicio nuevo empieza sin «Volver en»", r.body);
r = await ricardo("PUT", `${B}/services/${limpieza.id}`, serviceInput(`Limpieza ${tag}`, 45));
ok(r.status === 400, "un tiempo que no está en la lista, rechazado", r.status);
r = await ricardo("PUT", `${B}/services/${limpieza.id}`, serviceInput(`Limpieza ${tag}`, 180));
ok(r.status === 200 && (r.body as Service).returnAfterDays === 180, "se le pone «Volver en: 6 meses»", r.body);
ok(sql(`select return_after_since is not null from services where id = '${limpieza.id}'`) === "t", "con la fecha desde la que vale");
ok(
  count(
    `select count(*) from audit_logs where entity_id = '${limpieza.id}' and action = 'service.updated'
        and changes::text like '%Volver en%' and changes::text like '%6 meses%'`,
  ) === 1,
  "y queda en la actividad",
);
r = await ricardo("PUT", `${B}/services/${limpieza.id}`, serviceInput(`Limpieza ${tag}`));
ok(r.status === 200 && (r.body as Service).returnAfterDays === 180, "un panel anterior (sin el campo) lo conserva", r.body);
r = await ricardo("POST", `${B}/services`, serviceInput(`Ortodoncia ${tag}`, 180));
const ortodoncia = r.body as Service;
ok(r.status === 200 && ortodoncia.returnAfterDays === 180, "y se puede crear con él", r.body);

/* ======================================================================================== */
console.log("\nLa hoja «Controles»");
const ana = patient("Ana Vencida");
appointment(ana.id, limpieza.id, addDaysISO(T, -185));
const bruno = patient("Bruno Pronto");
appointment(bruno.id, limpieza.id, addDaysISO(T, -170));
const carla = patient("Carla Lejos");
appointment(carla.id, limpieza.id, addDaysISO(T, -100));
const diego = patient("Diego Ya Reservó");
appointment(diego.id, limpieza.id, addDaysISO(T, -185));
appointment(diego.id, limpieza.id, addDaysISO(T, 3), "confirmed");
const eva = patient("Eva Dos Citas");
appointment(eva.id, limpieza.id, addDaysISO(T, -400));
const evaLast = appointment(eva.id, limpieza.id, addDaysISO(T, -185));
const fabi = patient("Fabi Desactivada", { active: false });
appointment(fabi.id, limpieza.id, addDaysISO(T, -185));
const hugo = patient("Hugo Principal");
const ines = patient("Ines Pareja");
const couple = appointment(hugo.id, limpieza.id, addDaysISO(T, -185));
sql(`insert into appointment_clients (appointment_id, client_id, business_id) values ('${couple}', '${ines.id}', '${businessId}')`);
const gina = patient("Gina De Valeria");
appointment(gina.id, limpieza.id, addDaysISO(T, -185), "completed", valeriaAgenda);
const juan = patient("Juan Otra Pareja");
appointment(juan.id, limpieza.id, addDaysISO(T, -185));
const juanFuture = appointment(patient("Karen Principal").id, limpieza.id, addDaysISO(T, 5), "pending");
sql(`insert into appointment_clients (appointment_id, client_id, business_id) values ('${juanFuture}', '${juan.id}', '${businessId}')`);

let list = await listOf(ricardo);
const anaRow = inList(list, ana.id)[0];
ok(anaRow?.dueOn === addDaysISO(T, -5) && anaRow.lastDate === addDaysISO(T, -185) && anaRow.serviceId === limpieza.id, "la vencida, con su fecha", anaRow);
ok(inList(list, bruno.id)[0]?.dueOn === addDaysISO(T, 10), "la de los próximos 30 días");
ok(inList(list, carla.id).length === 0, "no la que vence en más de 30 días");
ok(inList(list, diego.id).length === 0, "no quien tiene una cita por delante");
ok(inList(list, juan.id).length === 0, "tampoco si va como otra persona en una cita por delante");
ok(inList(list, eva.id).length === 1 && inList(list, eva.id)[0].appointmentId === evaLast, "una por paciente y servicio: la de su última cita Atendida");
ok(inList(list, fabi.id).length === 0, "no un paciente desactivado");
ok(inList(list, hugo.id).length === 1 && inList(list, ines.id).length === 0, "de una pareja, sólo el principal");
ok(anaRow?.clientPhone === "+593 99 123 4567" && anaRow.professionalName !== "", "con el teléfono para el WhatsApp y el profesional", anaRow);
const order = list.map((control) => control.dueOn);
ok(order.every((due, index) => index === 0 || order[index - 1] <= due), "de la que venció antes a la más lejana", order);
const valeriaList = await listOf(valeria);
ok(valeriaList.length > 0 && valeriaList.every((control) => control.professionalId === valeriaAgenda) && inList(valeriaList, gina.id).length === 1, "el rol Profesional ve sólo los de su agenda", valeriaList.length);
ok(inList(await listOf(elena), gina.id).length === 1 && inList(await listOf(elena), ana.id).length === 1, "Recepción ve todos");
r = await laura("GET", `${B}/control-reminders`);
ok(r.status === 403, "otro negocio, 403", r.status);
const carlaFicha = await listOf(ricardo, carla.id);
ok(carlaFicha.length === 1 && carlaFicha[0].dueOn === addDaysISO(T, 80), "la ficha muestra también el que vence más adelante", carlaFicha);
ok((await listOf(ricardo, "no-es-un-id")).length === 0, "un paciente que no es un id: nada");

console.log("\n«Quitar»");
r = await valeria("POST", `${B}/control-reminders/${anaRow.appointmentId}/remove`);
ok(r.status === 404, "el rol Profesional no quita los de otra agenda", r.status);
r = await elena("POST", `${B}/control-reminders/${anaRow.appointmentId}/remove`);
ok(r.status === 200 && inList(await listOf(ricardo), ana.id).length === 0, "Recepción lo quita y sale de la lista", r.body);
ok(auditCount("control.removed") === 1, "con su entrada en la actividad");
r = await elena("POST", `${B}/control-reminders/${anaRow.appointmentId}/remove`);
ok(r.status === 200 && auditCount("control.removed") === 1, "quitarlo dos veces no hace nada");
appointment(ana.id, limpieza.id, addDaysISO(T, -1));
ok((await listOf(ricardo, ana.id))[0]?.dueOn === addDaysISO(T, 179), "una cita Atendida nueva trae un control nuevo");

/* ======================================================================================== */
console.log("\nEl interruptor");
let result = await queueControlReminders(at(addDaysISO(T, 10), "10:30"));
ok(result.queued === 0, "apagado, no sale ningún email", result);
r = await setControls(elena, true);
ok(r.status === 403, "Recepción no lo enciende", r.status);
r = await setControls(ricardo, true);
ok(r.status === 200 && (await businessNow()).notificationSettings.controlReminders === true, "el propietario lo enciende", r.body);
ok(sql(`select control_reminders_since is not null from businesses where id = '${businessId}'`) === "t", "con la fecha desde la que vale");
ok(
  count(`select count(*) from audit_logs where business_id = '${businessId}' and action = 'business.updated' and changes::text like '%Recordatorio de control%'`) >= 1,
  "y queda en la actividad",
);

/* ======================================================================================== */
console.log("\nEl email");
const D = addDaysISO(T, 10); // el día que vencen los de hace 170 días
const kiko = patient("Kiko Recibe");
appointment(kiko.id, limpieza.id, addDaysISO(T, -170), "completed", valeriaAgenda);
const lola = patient("Lola Sin Email", { email: false });
appointment(lola.id, limpieza.id, addDaysISO(T, -170));
const mia = patient("Mia No Quiere");
sql(`update clients set control_reminders_opted_out_at = now() where id = '${mia.id}'`);
appointment(mia.id, limpieza.id, addDaysISO(T, -170));
const nico = patient("Nico Reservó");
appointment(nico.id, limpieza.id, addDaysISO(T, -170));
appointment(nico.id, limpieza.id, addDaysISO(D, 2), "pending");
const oscar = patient("Oscar Dos Servicios");
appointment(oscar.id, limpieza.id, addDaysISO(T, -170));
appointment(oscar.id, ortodoncia.id, addDaysISO(T, -170));
const rita = patient("Rita Quitada");
const ritaLast = appointment(rita.id, limpieza.id, addDaysISO(T, -170));
await ricardo("POST", `${B}/control-reminders/${ritaLast}/remove`);
r = await ricardo("POST", `${B}/services`, serviceInput(`Blanqueamiento ${tag}`, 180));
const blanqueamiento = r.body as Service;
// Como si le hubieran puesto «Volver en» dentro de 20 días: lo que vence antes no se escribe.
sql(`update services set return_after_since = now() + interval '20 days' where id = '${blanqueamiento.id}'`);
const sara = patient("Sara Servicio Nuevo");
appointment(sara.id, blanqueamiento.id, addDaysISO(T, -170));

result = await queueControlReminders(at(D, "09:30"));
ok(result.queued === 0, "antes de las 10:00 no sale nada", result);
result = await queueControlReminders(at(D, "10:30"));
ok(result.failures === 0 && emailsTo(kiko.email) === 1, "desde las 10:00 del día que vence: Kiko", result);
ok(emailsTo(oscar.email) === 1, "a Oscar, con dos controles el mismo día, un solo email");
const oscarMail = sql(`select subject || ' | ' || body from notifications where type = 'control_reminder' and to_email = '${oscar.email}'`);
ok(oscarMail.includes("Te toca volver a") && oscarMail.includes(`Limpieza ${tag}`) && oscarMail.includes(`Ortodoncia ${tag}`), "con los dos servicios", oscarMail.slice(0, 300));
ok([mia, nico, rita, sara].every((p) => emailsTo(p.email) === 0), "no con la marca, ni con una cita por delante, ni quitado, ni por lo que vence antes de poner «Volver en»");
ok(count(`select count(*) from notifications where type = 'control_reminder' and to_email = ''`) === 0, "ni sin email");
ok([ana, eva, hugo, juan].every((p) => emailsTo(p.email) === 0), "ni por lo que ya había vencido al encenderlo");
const kikoMail = sql(`select subject || ' | ' || body from notifications where type = 'control_reminder' and to_email = '${kiko.email}'`);
const kikoToken = sql(`select token from control_reminders where client_id = '${kiko.id}'`);
ok(
  kikoMail.startsWith(`Te toca tu control de Limpieza ${tag}`) &&
    kikoMail.includes(`/book/${slug}?servicio=${limpieza.id}&profesional=${valeriaAgenda}`) &&
    kikoMail.includes(`/recordatorio/${kikoToken}`) &&
    kikoMail.includes("No quiero recibir estos recordatorios"),
  "con «Reservar mi control» (el servicio y el profesional) y el enlace para no recibir más",
  kikoMail.slice(0, 400),
);
ok(
  count(`select count(*) from notifications where type = 'appointment_copy' and created_at > now() - interval '5 minutes' and body like '%Te toca tu control%'`) === 0,
  "sin copia al profesional",
);
ok((await listOf(ricardo, kiko.id))[0]?.emailedAt !== null, "la ficha dice que se le escribió");
result = await queueControlReminders(at(D, "11:00"));
ok(emailsTo(kiko.email) === 1 && emailsTo(oscar.email) === 1, "la pasada siguiente no repite", result);
const quique = patient("Quique Tarde");
appointment(quique.id, limpieza.id, addDaysISO(T, -150)); // vence en T + 30
await queueControlReminders(at(addDaysISO(T, 61), "10:30"));
ok(emailsTo(quique.email) === 0, "pasados 30 días del vencimiento, ya no sale");
const tito = patient("Tito A Tiempo");
appointment(tito.id, limpieza.id, addDaysISO(T, -150));
await queueControlReminders(at(addDaysISO(T, 59), "10:30"));
ok(emailsTo(tito.email) === 1, "a los 29 días, todavía sí");

/* ======================================================================================== */
console.log("\n«No quiero recibir estos recordatorios»");
const page = anonymous();
r = await page("GET", `/public/control-reminders/${kikoToken}`);
const shown = r.body as PublicControlReminder;
ok(r.status === 200 && shown.optedOut === false && shown.businessName !== "" && !JSON.stringify(r.body).includes("Kiko"), "la página dice el negocio, sin datos del paciente", r.body);
ok(/no-store/.test(r.headers.get("cache-control") ?? ""), "sin caché");
r = await page("POST", `/public/control-reminders/${kikoToken}/opt-out`);
ok(r.status === 200 && sql(`select control_reminders_opted_out_at is not null from clients where id = '${kiko.id}'`) === "t", "pone la marca");
ok(auditCount("client.control_reminders_opted_out") === 1, "con su entrada en la actividad");
r = await page("POST", `/public/control-reminders/${kikoToken}/opt-out`);
ok(r.status === 200 && auditCount("client.control_reminders_opted_out") === 1, "repetirlo no hace nada");
ok(((await page("GET", `/public/control-reminders/${kikoToken}`)).body as PublicControlReminder).optedOut, "y la página lo dice");
ok((await listOf(ricardo, kiko.id)).length === 1, "su control sigue en el panel");
r = await page("GET", "/public/control-reminders/00000000000000000000000000000000");
ok(r.status === 404, "un enlace que no existe, 404", r.status);

/* ======================================================================================== */
console.log("\nApagar, desactivar y borrar");
r = await ricardo("PUT", `${B}/services/${ortodoncia.id}`, { ...serviceInput(`Ortodoncia ${tag}`, 180), isActive: false });
ok(r.status === 200 && (await listOf(ricardo, oscar.id)).every((control) => control.serviceId !== ortodoncia.id), "un servicio desactivado no tiene controles");
r = await ricardo("PUT", `${B}/services/${blanqueamiento.id}`, serviceInput(`Blanqueamiento ${tag}`, null));
ok(r.status === 200 && (await listOf(ricardo, sara.id)).length === 0, "con «Volver en: No», tampoco");
r = await setControls(ricardo, false);
ok(r.status === 200 && sql(`select control_reminders_since is null from businesses where id = '${businessId}'`) === "t", "al apagarlo, sin fecha");
const uma = patient("Uma Apagado");
appointment(uma.id, limpieza.id, addDaysISO(T, -165));
await queueControlReminders(at(addDaysISO(T, 15), "10:30"));
ok(emailsTo(uma.email) === 0, "apagado, ya no sale");
r = await ricardo("DELETE", `${B}/clients/${oscar.id}`);
ok(r.status === 204 && count(`select count(*) from control_reminders where client_id = '${oscar.id}'`) === 0, "al borrar al paciente, se borran sus controles", r.status);

done("del recordatorio de control");
// La tarea del cron abre su conexión a la base: sin esto, la suite espera a que se cierre sola.
process.exit();
