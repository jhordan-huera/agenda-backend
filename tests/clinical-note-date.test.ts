// La fecha de las evoluciones (spec 037): se elige al registrar (hoy por defecto, hasta 30 días atrás,
// nunca futura) y se corrige después, dentro de los 30 días anteriores al día en que se registró. Cada
// cambio queda en la actividad; pueden hacerlo los que añaden aclaraciones y nunca el modo soporte. El
// contenido y la fecha de registro siguen sin poder modificarse, tampoco con SQL directo.
import { checks, login, sql } from "./helpers/harness.ts";
import { CLINICAL_SUPPORT_BLOCKED_MESSAGE } from "../src/shared/lib/constants/business.ts";
import { formatNumericDate } from "../src/shared/lib/format.ts";
import { addDaysISO, getZonedNow } from "../src/shared/lib/time.ts";
import type { AuditLog, Client, ClinicalNote, ClinicalTemplate } from "../src/shared/types/index.ts";

const { ok, done } = checks();

let ipCounter = 60;
const as = (email: string) => login(email, { ip: `203.0.113.${ipCounter++}` });

const ricardo = await as("ricardo@demo.com"); // propietario de la Clínica Dental (historia activada)
const elena = await as("elena@demo.com"); // recepción, sin acceso clínico
const admin = await as("admin@demo.com"); // super admin: en la clínica, modo soporte
const businessId: string = ricardo.session.businessId;
const B = `/businesses/${businessId}`;
const timezone = sql(`select timezone from businesses where id = '${businessId}'`);
const today = getZonedNow(timezone).date;
const daysFromToday = (days: number) => addDaysISO(today, days);

const patient = ((await ricardo("GET", `${B}/clients`)).body as Client[])[0];
const general = ((await ricardo("GET", `${B}/clinical-templates`)).body as ClinicalTemplate[]).find((t) => t.id === "evolucion-general")!;
const P = `${B}/clients/${patient.id}/clinical-record`;
const register = (date: string | undefined, reason: string) =>
  ricardo("POST", `${P}/notes`, { appointmentId: null, ...(date === undefined ? {} : { date }), templateVersionId: general.versionId, data: { reason } });
const changeDate = (who: typeof ricardo, noteId: string, date: string) => who("PATCH", `${B}/clinical-notes/${noteId}/date`, { date });
const dateLogs = async () =>
  ((await ricardo("GET", `${B}/audit-logs?entityType=clinical_record&entityId=${patient.id}&limit=1000`)).body.entries as AuditLog[]).filter(
    (l) => l.action === "clinical_record.note_date_changed",
  );

console.log("Registrar una evolución de otro día");
let r = await register(undefined, "Sin fecha");
ok(r.status === 200 && r.body.date === today, "sin fecha, lleva la de hoy", r.body);
const todayNote = r.body as ClinicalNote;
r = await register(daysFromToday(-1), "Ayer");
ok(r.status === 200 && r.body.date === daysFromToday(-1), "con la fecha de ayer", r.body);
r = await register(daysFromToday(-30), "Hace 30 días");
ok(r.status === 200 && r.body.date === daysFromToday(-30), "hasta 30 días atrás", r.body);
r = await register(daysFromToday(-31), "Hace 31 días");
ok(r.status === 400 && /hasta 30 días atrás/.test(r.body.error.message), "hace 31 días: 400 y dice por qué", r.body);
r = await register(daysFromToday(1), "Mañana");
ok(r.status === 400 && /no puede ser futura/.test(r.body.error.message), "mañana: 400, nunca futura", r.body);
r = await register("2026-02-30", "No existe");
ok(r.status === 400, "una fecha que no existe en el calendario: 400", r.body);
r = await ricardo("GET", P);
const dates = (r.body.notes as ClinicalNote[]).map((n) => n.date);
ok(dates.join() === [...dates].sort().reverse().join(), "la historia se ordena por la fecha de la consulta", dates);

console.log("Corregir la fecha de una evolución guardada");
r = await changeDate(ricardo, todayNote.id, daysFromToday(-5));
ok(r.status === 200 && r.body.date === daysFromToday(-5) && r.body.createdAt === todayNote.createdAt, "dentro de los 30 días: cambia y la fecha de registro no", r.body);
ok(r.body.data.reason === "Sin fecha" && r.body.authorName === todayNote.authorName, "el contenido y el autor siguen igual", r.body);
let logs = await dateLogs();
ok(
  logs.length === 1 && logs[0].summary.includes(`del ${formatNumericDate(today)} al ${formatNumericDate(daysFromToday(-5))}`) && /Ricardo/.test(logs[0].actorName),
  "la actividad dice quién, de qué fecha a cuál y cuándo",
  logs,
);
r = await changeDate(ricardo, todayNote.id, daysFromToday(-5));
ok(r.status === 200 && (await dateLogs()).length === 1, "la misma fecha no deja otra entrada en la actividad", r.body);
r = await changeDate(ricardo, todayNote.id, daysFromToday(-31));
ok(r.status === 400 && /hasta 30 días antes de su registro/.test(r.body.error.message), "más de 30 días antes de su registro: 400", r.body);
r = await changeDate(ricardo, todayNote.id, daysFromToday(1));
ok(r.status === 400 && /posterior al día en que se registró/.test(r.body.error.message), "después del día de registro: 400", r.body);
r = await ricardo("PATCH", `${B}/clinical-notes/${todayNote.id}/date`, { date: "28/10/2026" });
ok(r.status === 400, "una fecha mal escrita: 400", r.body);
r = await changeDate(ricardo, "no-existe", today);
ok(r.status === 404, "una evolución que no existe: 404", r.body);

// La ventana se cuenta desde el día de registro, no desde hoy: una evolución vieja no viaja a cualquier fecha.
const oldNoteId = sql(
  `insert into clinical_notes (business_id, client_id, date, template_version_id, data, author_id, author_name, created_at)
   values ('${businessId}', '${patient.id}', ((now() - interval '40 days') at time zone '${timezone}')::date, '${general.versionId}',
           '{"reason": "Registrada hace 40 días"}', '${ricardo.session.userId}', 'Ricardo Paredes', now() - interval '40 days')
   returning id`,
).split("\n")[0];
const oldRegistered = sql(`select to_char(created_at at time zone '${timezone}', 'YYYY-MM-DD') from clinical_notes where id = '${oldNoteId}'`);
r = await changeDate(ricardo, oldNoteId, today);
ok(r.status === 400, "una evolución registrada hace 40 días no se puede pasar a hoy", r.body);
r = await changeDate(ricardo, oldNoteId, addDaysISO(oldRegistered, -10));
ok(r.status === 200 && r.body.date === addDaysISO(oldRegistered, -10), "sí a 10 días antes de su registro (las de antes del cambio también)", r.body);
r = await changeDate(ricardo, oldNoteId, addDaysISO(oldRegistered, -31));
ok(r.status === 400, "ni a 31 días antes de su registro", r.body);

console.log("Quién puede");
const elenaId: string = elena.session.userId;
r = await changeDate(elena, todayNote.id, daysFromToday(-2));
ok(r.status === 403, "el staff sin acceso clínico: 403", r.body);
r = await changeDate(admin, todayNote.id, daysFromToday(-2));
ok(r.status === 403 && r.body?.error?.message === CLINICAL_SUPPORT_BLOCKED_MESSAGE, "el modo soporte: 403 con el mensaje de privacidad", r.body);
ok(sql(`select date from clinical_notes where id = '${todayNote.id}'`) === daysFromToday(-5), "y la fecha sigue igual", todayNote.id);
await ricardo("PATCH", `${B}/team/${elenaId}/clinical-access`, { access: true });
r = await changeDate(elena, todayNote.id, daysFromToday(-2));
ok(r.status === 200 && r.body.date === daysFromToday(-2), "con acceso clínico, como para las aclaraciones, sí", r.body);
logs = await dateLogs();
ok(logs.length === 3 && /Elena/.test(logs[0].actorName), "y queda a su nombre en la actividad", logs.map((l) => `${l.actorName}: ${l.summary}`));
await ricardo("PATCH", `${B}/team/${elenaId}/clinical-access`, { access: false });

console.log("Lo que la base no deja hacer, ni con SQL directo");
const sqlError = (query: string) => {
  try {
    sql(query);
    return null;
  } catch (error) {
    return String((error as { stderr?: string }).stderr || error);
  }
};
let error = sqlError(`update clinical_notes set data = '{"reason": "Otro"}' where id = '${todayNote.id}'`);
ok(error && /no se pueden modificar/.test(error), "cambiar el contenido falla", error);
error = sqlError(`update clinical_notes set created_at = now() - interval '5 days' where id = '${todayNote.id}'`);
ok(error && /no se pueden modificar/.test(error), "cambiar la fecha de registro falla", error);
error = sqlError(`update clinical_notes set date = '2020-01-01' where id = '${todayNote.id}'`);
ok(error && /30 días anteriores a su registro/.test(error), "una fecha fuera de la regla falla", error);
error = sqlError(`update clinical_notes set date = date + 1 where id = '${todayNote.id}'`);
ok(error === null && sql(`select date from clinical_notes where id = '${todayNote.id}'`) === daysFromToday(-1), "una dentro de la regla, sí", error);
error = sqlError(
  `insert into clinical_notes (business_id, client_id, date, template_version_id, data, author_name)
   values ('${businessId}', '${patient.id}', '${daysFromToday(1)}', '${general.versionId}', '{}', 'SQL')`,
);
ok(error && /30 días anteriores a su registro/.test(error), "tampoco se inserta una evolución con fecha futura", error);

done("de la fecha de las evoluciones");
