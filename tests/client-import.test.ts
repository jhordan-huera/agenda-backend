// Importar pacientes desde un Excel o un CSV (spec 012): POST /businesses/:id/clients/import. Permisos,
// el caso de la spec (200 filas con errores, repetidas y que ya existen), repetirla sin duplicar, dos a
// la vez, la limpieza, los datos obligatorios del negocio, el tope del plan, los topes de la petición,
// «Importar también los que tienen datos por completar» (ampliación del 2026-10-15), los avisos por
// ntfy y el Inicio del super admin. Todo con datos inventados.
import { agent, checks, count, fakeNtfy, login, runCron, sql } from "./helpers/harness.ts";
import { clientImportNotice, findClientImports, findPanelClients } from "../src/services/booking-alerts.ts";
import { pool } from "../src/db/pool.ts";
import { missingRequiredFields } from "../src/shared/lib/validations/client.ts";
import {
  classifyImportRows,
  guessColumns,
  importSummary,
  prepareImportRow,
} from "../src/shared/lib/validations/client-import.ts";
import type { AuditLog, Client, ClientImportResult, ClientImportRow, PlatformStats } from "../src/shared/types/index.ts";

const { ok, done } = checks();

/** Cédula ecuatoriana válida: `prefix` (3 dígitos: la provincia y un tercer dígito de 0 a 6) y un número. Distinta de las de la demo (170…). */
function cedula(prefix: string, n: number): string {
  const nine = `${prefix}${String(n).padStart(6, "0")}`;
  const sum = [...nine].reduce((total, digit, i) => {
    const product = Number(digit) * (i % 2 === 0 ? 2 : 1);
    return total + (product > 9 ? product - 9 : product);
  }, 0);
  return `${nine}${(10 - (sum % 10)) % 10}`;
}
/** La misma cédula con el último dígito cambiado: el dígito verificador no cuadra. */
const wrongCheckDigit = (id: string) => `${id.slice(0, 9)}${(Number(id[9]) + 1) % 10}`;

const row = (n: number, fields: Partial<ClientImportRow>): ClientImportRow => ({
  row: n,
  name: "",
  documentId: "",
  email: "",
  phone: "",
  address: "",
  notes: "",
  ...fields,
});

let ipCounter = 20;
const nextIp = () => `203.0.113.${ipCounter++}`;
const as = (email: string) => login(email, { ip: nextIp() });

const jhordan = await as("jhordan@demo.com"); // propietario de «jhordan» (Pro: sin tope de pacientes)
const andrea = await as("andrea@demo.com"); // Administradora de ese negocio
const miguel = await as("miguel@demo.com"); // Recepción de ese negocio
const valeria = await as("valeria@demo.com"); // rol Profesional de la clínica dental
const ricardo = await as("ricardo@demo.com"); // propietario de la clínica dental (Business)
const admin = await as("admin@demo.com"); // super admin
const J = `/businesses/${jhordan.session.businessId}`;
const C = `/businesses/${ricardo.session.businessId}`;
const businessIdOf = (slug: string) => sql(`select id from businesses where slug = '${slug}'`);
const importTo = (browser: typeof jhordan, base: string, rows: ClientImportRow[]) =>
  browser("POST", `${base}/clients/import`, { rows }) as Promise<{ status: number; body: ClientImportResult & { error?: { code: string; message: string } } }>;
/** Con la casilla «Importar también los que tienen datos por completar» (o con otro valor, para probar la validación). */
const importWith = (browser: typeof jhordan, base: string, rows: ClientImportRow[], includeIncomplete: unknown) =>
  browser("POST", `${base}/clients/import`, { rows, includeIncomplete }) as ReturnType<typeof importTo>;

console.log("Código compartido");
ok(
  JSON.stringify(
    guessColumns(["Nombres y Apellidos", "CI", "Correo electrónico", "Celular", "Dirección", "Observaciones", "Seguro médico"]),
  ) === JSON.stringify(["name", "documentId", "email", "phone", "address", "notes", "ignore"]),
  "reconoce los nombres habituales y deja en «No importar» lo que no conoce",
  guessColumns(["Nombres y Apellidos", "CI", "Correo electrónico", "Celular", "Dirección", "Observaciones", "Seguro médico"]),
);
ok(
  JSON.stringify(guessColumns(["NOMBRE", "C.I.", "E-mail", "TELEFONO", "DIRECCION"])) ===
    JSON.stringify(["name", "documentId", "email", "phone", "address"]) &&
    JSON.stringify(guessColumns(["Nombre", "Apellidos", "Teléfono", "Celular"])) === JSON.stringify(["firstNames", "lastNames", "phone", "ignore"]),
  "también en mayúsculas y sin tildes; «Nombre» con «Apellidos» son los nombres; dos teléfonos: se queda el primero",
  guessColumns(["Nombre", "Apellidos", "Teléfono", "Celular"]),
);
const empty: ClientImportResult = { created: 0, existing: [], repeated: [], errors: [], overLimit: [], incomplete: [] };
ok(
  importSummary({ ...empty, created: 1 }) === "Importó 1 paciente" &&
    importSummary({ ...empty, created: 3, errors: [{ row: 2, reason: "x" }], overLimit: [4, 5] }) ===
      "Importó 3 pacientes (1 con error, 2 por el tope del plan)" &&
    importSummary({ ...empty, created: 2, existing: [{ row: 2, clientId: "a" }], repeated: [{ row: 3, firstRow: 2 }] }) ===
      "Importó 2 pacientes (1 ya existía, 1 repetida en el archivo)",
  "el resumen: en singular cuando es una y sólo las partes que pasan de cero",
);
ok(
  importSummary({
    created: 3,
    existing: [{ row: 2, clientId: "a" }],
    errors: [{ row: 3, reason: "x" }],
    repeated: [{ row: 4, firstRow: 2 }],
    incomplete: [
      { row: 5, missing: ["email"] },
      { row: 6, missing: ["documentId", "email"] },
    ],
    overLimit: [7],
  }) === "Importó 3 pacientes (1 ya existía, 1 con error, 1 repetida en el archivo, 2 por completar, 1 por el tope del plan)",
  "con «por completar», en su lugar: ya existían, con errores, repetidas, por completar y tope del plan",
);

console.log("Permisos");
const unique = (label: string, n: number) => row(n, { name: `Paciente ${label} ${n}`, email: `${label}.${n}@example.com` });
let r = await importTo(miguel, J, [unique("recepcion", 2)]);
ok(r.status === 403 && r.body.error?.message === "Tu rol no tiene permisos para realizar esta acción.", "Recepción: 403", r.body);
r = await importTo(valeria, C, [unique("profesional", 2)]);
ok(r.status === 403, "el rol Profesional: 403", r.body);
const anonymous = agent({ ip: nextIp() });
const huge = { rows: Array.from({ length: 1200 }, (_, i) => row(i + 2, { notes: "x".repeat(4500) })) };
r = (await anonymous("POST", `${J}/clients/import`, huge)) as typeof r;
ok(r.status === 401, "sin sesión: 401, sin leer el cuerpo (de más de 4 MB)", r.body);
r = await importTo(andrea, J, [row(2, { name: "Paciente Admin Uno", documentId: cedula("134", 1), email: "admin.uno@example.com" })]);
ok(r.status === 200 && r.body.created === 1, "una administradora importa", r.body);
r = await importTo(jhordan, J, [row(2, { name: "Paciente Dueño Uno", documentId: cedula("134", 2), email: "dueno.uno@example.com" })]);
ok(r.status === 200 && r.body.created === 1, "el propietario importa", r.body);

console.log("El caso de la spec: 200 filas con 5 errores, 3 cédulas que ya existen y 2 repetidas");
const demo = sql(`select id || ':' || document_id from clients where business_id = '${jhordan.session.businessId}' and document_id <> '' order by name limit 3`)
  .split("\n")
  .map((line) => ({ id: line.split(":")[0], documentId: line.split(":")[1] }));
const demoBefore = sql(`select row_to_json(c)::text from clients c where id in (${demo.map((d) => `'${d.id}'`).join(",")}) order by id`);
const rows: ClientImportRow[] = [];
for (let i = 0; i < 190; i++) {
  rows.push(
    row(rows.length + 2, {
      name: `Paciente Importado ${i}`,
      documentId: cedula("135", i),
      email: `importado.${i}@example.com`,
      phone: `099 ${String(1000000 + i).slice(1)}`,
      address: i % 2 ? "Av. Siempre Viva 123" : "",
      notes: i === 0 ? "Fecha de nacimiento: 12/03/1990" : "",
    }),
  );
  // Las filas especiales, repartidas en el archivo.
  if (i === 10) rows.push(row(rows.length + 2, { name: "Muy Corto", documentId: "1234", email: "corto@example.com" }));
  if (i === 20) rows.push(row(rows.length + 2, { name: "Sin Email", documentId: cedula("135", 901) }));
  if (i === 30) rows.push(row(rows.length + 2, { name: "Email Malo", documentId: cedula("135", 902), email: "no-es-un-email" }));
  if (i === 40) rows.push(row(rows.length + 2, { name: "Teléfono Malo", documentId: cedula("135", 903), email: "tel@example.com", phone: "099 ABC 4567" }));
  if (i === 50) rows.push(row(rows.length + 2, { name: "Con Signos", documentId: "17#ABC23456", email: "signos@example.com" }));
  if (i === 60 || i === 70 || i === 80) {
    const known = demo[(i - 60) / 10];
    rows.push(row(rows.length + 2, { name: "Otro Nombre Cualquiera", documentId: known.documentId, email: "otro@example.com" }));
  }
  if (i === 100 || i === 150) rows.push(row(rows.length + 2, { name: "Repetida", documentId: cedula("135", i - 50), email: "repetida@example.com" }));
}
ok(rows.length === 200, "el archivo tiene 200 filas", rows.length);
const notificationsBefore = count("select count(*) from notifications");
const auditBefore = count(`select count(*) from audit_logs where business_id = '${jhordan.session.businessId}' and action = 'client.imported'`);
const statsBefore = (await admin("GET", "/admin/stats")).body as PlatformStats;
const since = sql("select now()");
r = await importTo(jhordan, J, rows);
const result = r.body;
ok(r.status === 200 && result.created === 190, "se crean 190", { status: r.status, created: result.created, error: result.error });
ok(
  result.existing.length === 3 &&
    result.existing.every((e, i) => e.clientId === demo[i].id && rows.find((x) => x.row === e.row)?.documentId === demo[i].documentId),
  "3 «ya existían», cada una con su ficha",
  result.existing,
);
ok(
  result.repeated.length === 2 &&
    result.repeated.every((e) => rows.find((x) => x.row === e.row)?.documentId === rows.find((x) => x.row === e.firstRow)?.documentId && e.firstRow < e.row),
  "2 repetidas, con la fila que se usó",
  result.repeated,
);
const reasons = result.errors.map((e) => e.reason);
ok(
  JSON.stringify(reasons) ===
    JSON.stringify([
      "Ingresa un número de cédula válido",
      "El email es obligatorio",
      "Ingresa un email válido",
      "Ingresa un teléfono válido",
      "Cédula: escribe sólo letras y números, sin espacios ni guiones",
    ]),
  "5 con error, con el motivo esperado",
  result.errors,
);
ok(
  result.errors.every((e) => {
    const source = rows.find((x) => x.row === e.row)!;
    return [source.documentId, source.email, source.phone].filter(Boolean).every((value) => !e.reason.includes(value));
  }),
  "ningún motivo repite el valor de la celda",
);
ok(result.overLimit.length === 0, "sin tope en el plan Pro", result.overLimit);
const imported = sql(
  `select count(*) || ' ' || count(distinct created_at) || ' ' || bool_and(created_by = '${jhordan.session.userId}') || ' ' || bool_and(is_active) || ' ' || bool_and(claimed_client_id is null)
     from clients where business_id = '${jhordan.session.businessId}' and source = 'import' and created_at > '${since}'`,
);
ok(imported === "190 1 true true true", "en la base: 190 con origen «import», de quien importó, activos y con el mismo instante", imported);
ok(
  sql(`select row_to_json(c)::text from clients c where id in (${demo.map((d) => `'${d.id}'`).join(",")}) order by id`) === demoBefore,
  "los 3 que ya existían, sin ningún cambio",
);
ok(
  sql(`select notes from clients where business_id = '${jhordan.session.businessId}' and document_id = '${cedula("135", 0)}'`) === "Fecha de nacimiento: 12/03/1990",
  "las notas llegan a la ficha",
);
ok(count("select count(*) from notifications") === notificationsBefore, "ningún email (ni en cola)", count("select count(*) from notifications") - notificationsBefore);
const imports = ((await jhordan("GET", `${J}/audit-logs?entityType=client&action=client.imported&limit=5`)).body.entries as AuditLog[]) ?? [];
ok(
  count(`select count(*) from audit_logs where business_id = '${jhordan.session.businessId}' and action = 'client.imported'`) === auditBefore + 1 &&
    imports[0]?.summary === "Importó 190 pacientes (3 ya existían, 5 con errores, 2 repetidas en el archivo)" &&
    imports[0]?.entityType === "client" &&
    imports[0]?.entityId === null &&
    imports[0]?.actorName === "Jhordan Huera",
  "una sola entrada en la actividad, con el resumen y sale con el filtro «Clientes»",
  imports[0],
);
const listed = (await jhordan("GET", `${J}/clients`)).body as Client[];
ok(
  listed.filter((c) => c.source === "import").length === 192 && listed.some((c) => c.source === "dashboard"),
  "la lista trae el origen de cada paciente",
  listed.filter((c) => c.source === "import").length,
);
const statsAfter = (await admin("GET", "/admin/stats")).body as PlatformStats;
ok(
  statsAfter.growth.newClients.current === statsBefore.growth.newClients.current &&
    statsAfter.growth.daily.reduce((total, day) => total + (day.current?.newClients ?? 0), 0) ===
      statsBefore.growth.daily.reduce((total, day) => total + (day.current?.newClients ?? 0), 0),
  "Inicio del super admin: los importados no son pacientes nuevos del mes (ni en el gráfico)",
  { before: statsBefore.growth.newClients, after: statsAfter.growth.newClients },
);

console.log("Repetir la misma importación");
const clientsBefore = count(`select count(*) from clients where business_id = '${jhordan.session.businessId}'`);
r = await importTo(jhordan, J, rows);
ok(
  r.status === 200 && r.body.created === 0 && r.body.existing.length === 195 && r.body.errors.length === 5 && r.body.repeated.length === 0,
  "0 se crean: 195 «ya existían» (también las repetidas, que ahora existen) y las 5 con error",
  { created: r.body.created, existing: r.body.existing.length, errors: r.body.errors.length, repeated: r.body.repeated.length },
);
ok(
  count(`select count(*) from clients where business_id = '${jhordan.session.businessId}'`) === clientsBefore &&
    count(`select count(*) from audit_logs where business_id = '${jhordan.session.businessId}' and action = 'client.imported'`) === auditBefore + 1,
  "ni un paciente más y ninguna entrada nueva en la actividad",
);

console.log("Dos a la vez (doble clic o dos pestañas)");
const twice = Array.from({ length: 40 }, (_, i) =>
  row(i + 2, { name: `Paciente Doble ${i}`, documentId: cedula("133", i), email: `doble.${i}@example.com` }),
);
const [first, second] = await Promise.all([importTo(jhordan, J, twice), importTo(andrea, J, twice)]);
ok(
  first.status === 200 && second.status === 200 && first.body.created + second.body.created === 40 &&
    first.body.existing.length + second.body.existing.length === 40,
  "una crea las 40 y la otra las ve como «ya existían»",
  { first: first.body.created, second: second.body.created },
);
ok(
  count(`select count(*) from clients where business_id = '${jhordan.session.businessId}' and document_id like '133%'`) === 40 &&
    count(`select count(*) from (select document_id from clients where business_id = '${jhordan.session.businessId}' and document_id <> '' group by document_id having count(*) > 1) d`) === 0,
  "sin duplicados por cédula",
);

console.log("Limpieza");
const ec = "America/Guayaquil";
const zero = cedula("024", 7); // provincia 02: empieza por 0
const clean = [
  row(2, { name: "  Ana   María  Pérez ", documentId: `${zero.slice(0, 4)}-${zero.slice(4)}`, email: " ANA.PEREZ@EXAMPLE.COM ", phone: "099.123.4567" }),
  row(3, { name: "Beto Ruiz", documentId: `${cedula("024", 8).slice(0, 4)} ${cedula("024", 8).slice(4, 7)} ${cedula("024", 8).slice(7)}`, email: "beto@example.com" }),
  row(4, { name: "Ceci Mora", documentId: cedula("024", 9).slice(1), email: "ceci@example.com; ceci.trabajo@example.com", phone: "0991234567 / 042345678 y 0987654321", notes: "Alergia a la penicilina" }),
  row(5, { name: "Dani Vera", documentId: "912345670", email: "dani@example.com" }),
];
const prepared = clean.map((x) => prepareImportRow(x, ec));
ok(
  prepared[0].documentId === zero && prepared[1].documentId === cedula("024", 8) && prepared[0].name === "Ana María Pérez" && prepared[0].phone === "099 123 4567",
  "«0912-345675» y «0912 345 675» quedan sin guiones ni espacios; el nombre, con los espacios juntos; el punto del teléfono, espacio",
  prepared.slice(0, 2),
);
ok(prepared[2].documentId === cedula("024", 9), "a una cédula de 9 dígitos que con el 0 es válida se le vuelve a poner", prepared[2].documentId);
ok(
  prepared[2].phone === "0991234567" &&
    prepared[2].email === "ceci@example.com" &&
    prepared[2].notes === "Alergia a la penicilina\nOtros teléfonos: 042345678, 0987654321\nOtros emails: ceci.trabajo@example.com",
  "con dos teléfonos o dos emails, el primero va a su dato y los otros, a las notas",
  prepared[2],
);
ok(prepared.every((x) => JSON.stringify(prepareImportRow(x, ec)) === JSON.stringify(x)), "volver a limpiar una fila limpia no cambia nada");
ok(prepareImportRow(clean[3], "America/Bogota").documentId === "912345670" && prepareImportRow(row(2, { documentId: cedula("024", 9).slice(1) }), "America/Bogota").documentId.length === 9, "en otro país no se pone el 0");
// Cualquier documento de cualquier país (spec 038): sin comprobar el dígito verificador de la cédula.
const anyCountry = classifyImportRows(
  [
    row(2, { name: "Con Pasaporte", documentId: "ab-1234567", email: "pasaporte@example.com" }),
    row(3, { name: "De Venezuela", documentId: "V-12.345.678", email: "venezuela@example.com" }),
    row(4, { name: "De Guayas", documentId: cedula("096", 61881), email: "guayas@example.com" }),
    row(5, { name: "Dígito Mal", documentId: wrongCheckDigit(cedula("135", 77)), email: "digito@example.com" }),
  ],
  { required: { documentId: true, email: true, phone: false, address: false }, timezone: ec, existing: [], remaining: null },
);
ok(
  anyCountry.errors.length === 0 &&
    JSON.stringify(anyCountry.newClients.map((c) => c.documentId)) ===
      JSON.stringify(["AB1234567", "V12345678", cedula("096", 61881), wrongCheckDigit(cedula("135", 77))]),
  "un pasaporte, una cédula venezolana, una de Guayas (096) y una con el verificador mal: todas entran, en mayúsculas y sin guiones ni puntos",
  anyCountry,
);
r = await importTo(jhordan, J, clean);
ok(
  r.status === 200 && r.body.created === 4 && r.body.errors.length === 0 &&
    sql(`select count(*) from clients where business_id = '${jhordan.session.businessId}' and document_id = '912345670'`) === "1",
  "la API limpia igual: se crean las 4, y la de 9 dígitos que no vale con el 0 entra tal cual (puede ser de otro país)",
  r.body,
);
ok(
  sql(`select email || '|' || phone from clients where business_id = '${jhordan.session.businessId}' and document_id = '${zero}'`) === "ana.perez@example.com|099 123 4567",
  "el email en minúsculas y «099.123.4567» aceptado",
);
const nutrivida = businessIdOf("nutrivida");
sql(`update businesses set timezone = 'America/Bogota' where id = '${nutrivida}'`);
const daniela = await as("daniela@demo.com");
r = await importTo(daniela, `/businesses/${nutrivida}`, [row(2, { name: "Paciente Bogotá", documentId: "912345670", email: "bogota@example.com" })]);
ok(
  r.status === 200 && r.body.created === 1 && sql(`select document_id from clients where business_id = '${nutrivida}' and email = 'bogota@example.com'`) === "912345670",
  "un negocio de otro país: se guarda tal cual, sin el 0",
  r.body,
);
sql(`update businesses set timezone = 'America/Guayaquil' where id = '${nutrivida}'`);

console.log("Datos obligatorios del negocio");
const setRequired = (fields: { documentId: boolean; email: boolean; phone: boolean; address: boolean }) =>
  admin("PUT", `/admin/businesses/${ricardo.session.businessId}/client-required-fields`, fields);
ok((await setRequired({ documentId: true, email: true, phone: true, address: false })).status === 200, "el super admin hace obligatorio el teléfono");
r = await importTo(ricardo, C, [
  row(2, { name: "Sin Teléfono", documentId: cedula("132", 1), email: "sintel@example.com" }),
  row(3, { name: "Con Teléfono", documentId: cedula("132", 2), email: "contel@example.com", phone: "0991112233" }),
]);
ok(r.status === 200 && r.body.created === 1 && r.body.errors[0]?.reason === "El teléfono es obligatorio", "las filas sin teléfono: «El teléfono es obligatorio»", r.body);
ok((await setRequired({ documentId: false, email: false, phone: false, address: false })).status === 200, "y deja la cédula opcional");
const oldNoDocument = sql(
  `insert into clients (business_id, name, email, phone) values ('${ricardo.session.businessId}', 'Paciente Antiguo', 'antiguo@example.com', '099 555 0001') returning id`,
);
const noDocument = [
  row(2, { name: "Sin Cédula Uno", email: "sincedula1@example.com", phone: "0995550002" }),
  row(3, { name: "Sin Cédula Dos" }),
  row(4, { name: "sin cédula  dos" }),
  row(5, { name: "Paciente Antiguo", documentId: cedula("132", 3), email: "ANTIGUO@example.com", phone: "0995550001" }),
];
r = await importTo(ricardo, C, noDocument);
ok(
  r.status === 200 && r.body.created === 2 && r.body.repeated.length === 1 && r.body.repeated[0].row === 4 && r.body.repeated[0].firstRow === 3,
  "las filas sin cédula se crean; dos iguales sin cédula: una se crea y la otra es «repetida»",
  r.body,
);
ok(
  r.body.existing.length === 1 && r.body.existing[0].row === 5 && r.body.existing[0].clientId === oldNoDocument &&
    sql(`select document_id from clients where id = '${oldNoDocument}'`) === "",
  "con cédula y el mismo nombre, email y teléfono que un paciente antiguo sin cédula: «ya existía», y sigue sin cédula",
  r.body.existing,
);
r = await importTo(ricardo, C, noDocument);
ok(r.status === 200 && r.body.created === 0 && r.body.existing.length === 4, "repetir la importación no crea ninguno más", r.body);
await setRequired({ documentId: true, email: true, phone: false, address: false });

console.log("Tope del plan (Free: 50 pacientes)");
const bella = businessIdOf("estudio-bella");
const laura = await as("laura@demo.com");
const usage = async () => (await laura("GET", `/businesses/${bella}/subscription/usage`)).body as { clients: number; limits: { clients: number } };
const missing = 45 - (await usage()).clients;
sql(
  `insert into clients (business_id, name) select '${bella}', 'Relleno ' || g from generate_series(1, ${missing}) g`,
);
ok((await usage()).clients === 45, "el negocio Free tiene 45 pacientes", await usage());
const twenty = Array.from({ length: 20 }, (_, i) => row(i + 2, { name: `Paciente Tope ${i}`, documentId: cedula("131", i), email: `tope.${i}@example.com` }));
const preview = classifyImportRows(twenty, {
  required: { documentId: true, email: true, phone: false, address: false },
  timezone: ec,
  existing: [],
  remaining: 5,
});
r = await importTo(laura, `/businesses/${bella}`, twenty);
ok(
  r.status === 200 && r.body.created === 5 && r.body.overLimit.length === 15 && r.body.overLimit[0] === 7,
  "se crean 5 y 15 no entran por el tope (las primeras del archivo sí)",
  r.body,
);
ok(preview.created === 5 && JSON.stringify(preview.overLimit) === JSON.stringify(r.body.overLimit), "la revisión del panel da lo mismo que la API");
ok((await usage()).clients === 50, "el uso del plan dice 50", await usage());
ok(
  count(`select count(*) from audit_logs where business_id = '${bella}' and action = 'client.imported' and summary = 'Importó 5 pacientes (15 por el tope del plan)'`) === 1,
  "la actividad dice cuántas no entraron por el tope",
);

console.log("Modo soporte del super admin");
const carolina = businessIdOf("carolina-vega");
r = await importTo(admin, `/businesses/${carolina}`, [row(2, { name: "Paciente Soporte", documentId: cedula("130", 1), email: "soporte.paciente@example.com" })]);
ok(r.status === 200 && r.body.created === 1, "el super admin importa en «Gestionar negocio»", r.body);
ok(
  /\(Super admin\)$/.test(sql(`select actor_name from audit_logs where business_id = '${carolina}' and action = 'client.imported'`)),
  "y la actividad lo nombra «(Super admin)»",
);

console.log("Topes de la petición");
const limits = await as("jhordan@demo.com");
r = await importTo(limits, J, Array.from({ length: 5001 }, (_, i) => row(i + 2, { name: "x" })));
ok(r.status === 400 && r.body.error?.code === "validation", "5.001 filas: 400", r.body);
r = await importTo(limits, J, [row(2, { name: "Uno" }), row(2, { name: "Dos" })]);
ok(r.status === 400 && r.body.error?.message === "Hay números de fila repetidos.", "un número de fila repetido: 400", r.body);
r = await importTo(limits, J, [row(2, { name: "Larga", notes: "x".repeat(6000) })]);
ok(r.status === 400, "un dato de 6.000 caracteres: 400", r.body);
r = (await limits("POST", `${J}/clients/import`, { rows: "no" })) as typeof r;
ok(r.status === 400, "un cuerpo con otra forma: 400", r.body);
// ~3 MB: 680 filas con notas de 4.500 caracteres (más de las 2.000 de la ficha: son errores de fila, no se crea nada).
const big = Array.from({ length: 680 }, (_, i) => row(i + 2, { name: `Nota Larga ${i}`, documentId: cedula("140", i), email: `larga.${i}@example.com`, notes: "n".repeat(4500) }));
const bigBytes = Buffer.byteLength(JSON.stringify({ rows: big }));
r = await importTo(limits, J, big);
ok(
  bigBytes > 3_000_000 && r.status === 200 && r.body.created === 0 && r.body.errors.length === 680 && r.body.errors[0].reason === "Notas: máximo 2000 caracteres",
  "un cuerpo de 3 MB se acepta en esta ruta (las notas demasiado largas son error de su fila)",
  { bytes: bigBytes, status: r.status, error: r.body.error, first: r.body.errors?.[0] },
);
const someClient = listed.find((c) => c.source === "dashboard")!;
const put = await limits("PUT", `${J}/clients/${someClient.id}`, { ...someClient, notes: "n".repeat(3_000_000) });
ok(put.status === 400, "el mismo tamaño en PUT …/clients/:id sigue dando 400 (2 MB)", put.body);
r = (await limits("POST", `${J}/clients/import`, huge)) as typeof r;
ok(r.status === 400 && r.body.error?.code === "validation", "más de 4 MB: 400 validation", r.body);
const hammer = await as("jhordan@demo.com");
let last = 0;
for (let i = 0; i < 21; i++) last = (await importTo(hammer, J, [])).status;
ok(last === 429, "la petición 21 en 15 minutos desde la misma conexión: 429", last);
const limited = await importTo(hammer, J, []);
ok(limited.body.error?.message === "Demasiadas importaciones seguidas. Espera unos minutos.", "con su mensaje", limited.body);

console.log("Importar también los que tienen datos por completar (ampliación del 2026-10-15)");
const defaults = { documentId: true, email: true, phone: false, address: false };
ok(
  JSON.stringify(missingRequiredFields({ documentId: "", email: "a@correo.ec", phone: "  ", address: "" }, { ...defaults, phone: true })) ===
    JSON.stringify(["documentId", "phone"]) &&
    missingRequiredFields({ documentId: "", email: "", phone: "", address: "" }, { documentId: false, email: false, phone: false, address: false }).length === 0 &&
    missingRequiredFields({ documentId: cedula("143", 1), email: "a@correo.ec", phone: "", address: "" }, defaults).length === 0,
  "missingRequiredFields: los obligatorios del negocio que faltan, en el orden del formulario (en blanco cuenta como que falta)",
);
// El archivo de la prueba del 2026-10-15: diez pacientes con y sin cédula, email y teléfono, y una fila vacía.
const hugo = cedula("143", 8);
const tenPatients = [
  row(2, { name: "Ana Torres", documentId: cedula("143", 1), email: "ana@correo.ec", phone: "0991111111" }),
  row(3, { name: "Bruno Díaz", documentId: cedula("143", 2), email: "bruno@correo.ec" }),
  row(4, { name: "Carla Mena", documentId: cedula("143", 3), phone: "0993333333" }),
  row(5, { name: "Diego Paz", email: "diego@correo.ec", phone: "0994444444" }),
  row(6, { name: "Elena Ruiz", phone: "0995555555" }),
  row(7, { name: "Fabián León" }),
  row(8, { name: "Gina Sol", documentId: "17#2345678", email: "gina@correo.ec", phone: "0997777777" }),
  row(9, { name: "Hugo Ríos", documentId: `${hugo.slice(0, 4)}-${hugo.slice(4)}`, email: "hugo@correo.ec", phone: "0998888888" }),
  row(10, {}),
  row(11, { name: "Iván Cruz", documentId: cedula("143", 9), email: "ivan@correo.ec", address: "Av. Amazonas N34-120" }),
  row(12, { name: "Julia Vela", email: "julia@correo.ec" }),
];
const reviewOf = (rows: ClientImportRow[], allowIncomplete?: boolean, remaining: number | null = null) =>
  classifyImportRows(rows, { required: defaults, timezone: ec, existing: [], remaining, ...(allowIncomplete === undefined ? {} : { allowIncomplete }) });
/** Lo que devuelve la API: la clasificación sin las filas que se crean. */
const asApi = ({ newClients: _newClients, ...result }: ReturnType<typeof reviewOf>) => result;
const expectedIncomplete = [
  { row: 4, missing: ["email"] },
  { row: 5, missing: ["documentId"] },
  { row: 6, missing: ["documentId", "email"] },
  { row: 7, missing: ["documentId", "email"] },
  { row: 12, missing: ["documentId"] },
];
const badDocument = [{ row: 8, reason: "Cédula: escribe sólo letras y números, sin espacios ni guiones" }];
const on = reviewOf(tenPatients, true);
ok(
  on.created === 9 && JSON.stringify(on.newClients.map((c) => c.row)) === JSON.stringify([2, 3, 4, 5, 6, 7, 9, 11, 12]),
  "con la casilla entran 9 de los 10: también los que no traen la cédula o el email y el que sólo trae el nombre",
  on.newClients.map((c) => c.row),
);
ok(JSON.stringify(on.incomplete) === JSON.stringify(expectedIncomplete), "5 por completar, cada uno con lo que le falta", on.incomplete);
ok(
  JSON.stringify(on.errors) === JSON.stringify(badDocument) && on.existing.length === 0 && on.repeated.length === 0 && on.overLimit.length === 0,
  "la de la cédula mal escrita sigue con error, con el motivo de siempre",
  on.errors,
);
ok(
  on.newClients.find((c) => c.row === 9)?.documentId === hugo && on.newClients.find((c) => c.row === 7)?.documentId === "",
  "lo que viene se limpia igual (la cédula con guión) y lo que falta queda en blanco",
);
const off = reviewOf(tenPatients, false);
const today = [
  { row: 4, reason: "El email es obligatorio" },
  { row: 5, reason: "La cédula es obligatoria" },
  { row: 6, reason: "La cédula es obligatoria" },
  { row: 7, reason: "La cédula es obligatoria" },
  ...badDocument,
  { row: 12, reason: "La cédula es obligatoria" },
];
ok(
  off.created === 4 && off.incomplete.length === 0 && JSON.stringify(off.errors) === JSON.stringify(today),
  "sin la casilla, como hoy: entran 4 y las demás son errores con el motivo de hoy («La cédula es obligatoria»)",
  off.errors,
);
ok(JSON.stringify(off) === JSON.stringify(reviewOf(tenPatients)), "allowIncomplete: false es lo mismo que no pasarlo");
const badlyWritten = reviewOf(
  [
    row(2, { name: "Email Malo", email: "no-es-un-email" }),
    row(3, { name: "Teléfono Malo", phone: "099 ABC 4567" }),
    row(4, { name: "Con Signos", documentId: "17#ABC2345" }),
    row(5, { name: "Muy Corto", documentId: "1234" }),
    row(6, { email: "sin.nombre@correo.ec", phone: "0991234567" }),
    row(7, { name: "Fabián León" }),
    row(8, { name: "fabián  león" }),
  ],
  true,
);
ok(
  JSON.stringify(badlyWritten.errors.map((e) => e.reason)) ===
    JSON.stringify([
      "Ingresa un email válido",
      "Ingresa un teléfono válido",
      "Cédula: escribe sólo letras y números, sin espacios ni guiones",
      "Ingresa un número de cédula válido",
      "El nombre es obligatorio",
    ]),
  "con la casilla, lo mal escrito sigue con error y sin el nombre no entra",
  badlyWritten.errors,
);
ok(
  badlyWritten.created === 1 && JSON.stringify(badlyWritten.repeated) === JSON.stringify([{ row: 8, firstRow: 7 }]),
  "dos con el mismo nombre y ningún otro dato son la misma persona: la segunda, «repetida»",
  badlyWritten,
);

const notificationsBeforeIncomplete = count("select count(*) from notifications");
const ricardoAgain = await as("ricardo@demo.com");
r = await importTo(ricardoAgain, C, tenPatients);
ok(
  r.status === 200 && JSON.stringify(r.body) === JSON.stringify(asApi(off)),
  "una petición sin includeIncomplete (como las de antes): lo mismo que hoy, 4 creados y 6 con error",
  r.body,
);
r = await importWith(ricardoAgain, C, tenPatients, "sí");
ok(
  r.status === 400 && r.body.error?.code === "validation" && r.body.error.message === "Indica si se importan también los que tienen datos por completar.",
  "includeIncomplete que no es verdadero o falso: 400",
  r.body,
);
r = await importWith(ricardoAgain, C, tenPatients, false);
ok(
  r.status === 200 && r.body.created === 0 && r.body.existing.length === 4 && JSON.stringify(r.body.errors) === JSON.stringify(today),
  "includeIncomplete: false, igual: los 4 ya existían y las demás siguen con error",
  r.body,
);
r = await importWith(ricardoAgain, C, tenPatients, true);
ok(
  r.status === 200 && r.body.created === 5 && r.body.existing.length === 4 && JSON.stringify(r.body.incomplete) === JSON.stringify(expectedIncomplete),
  "después, con la casilla: entran los 5 que faltaban, por completar",
  r.body,
);
ok(
  count(`select count(*) from audit_logs where business_id = '${ricardo.session.businessId}' and action = 'client.imported' and summary = 'Importó 5 pacientes (4 ya existían, 1 con error, 5 por completar)'`) === 1,
  "la actividad: «Importó 5 pacientes (4 ya existían, 1 con error, 5 por completar)»",
  sql(`select summary from audit_logs where business_id = '${ricardo.session.businessId}' and action = 'client.imported' order by created_at desc limit 1`),
);

const fisio = businessIdOf("fisioactiva");
const tomas = await as("tomas@demo.com");
const fisioClients = () => count(`select count(*) from clients where business_id = '${fisio}'`);
const fisioBefore = fisioClients();
const fisioAudit = () => count(`select count(*) from audit_logs where business_id = '${fisio}' and action = 'client.imported'`);
r = await importWith(tomas, `/businesses/${fisio}`, tenPatients, true);
ok(
  r.status === 200 && r.body.created === 9 && JSON.stringify(r.body) === JSON.stringify(asApi(on)),
  "la API, con la casilla: 9 creados (5 por completar) y 1 con error, lo mismo que la revisión",
  r.body,
);
ok(
  sql(
    `select string_agg(name || '|' || document_id || '|' || email || '|' || phone, ';' order by name) from clients
      where business_id = '${fisio}' and source = 'import'`,
  ) ===
    [
      `Ana Torres|${cedula("143", 1)}|ana@correo.ec|0991111111`,
      `Bruno Díaz|${cedula("143", 2)}|bruno@correo.ec|`,
      `Carla Mena|${cedula("143", 3)}||0993333333`,
      "Diego Paz||diego@correo.ec|0994444444",
      "Elena Ruiz|||0995555555",
      "Fabián León|||",
      `Hugo Ríos|${hugo}|hugo@correo.ec|0998888888`,
      `Iván Cruz|${cedula("143", 9)}|ivan@correo.ec|`,
      "Julia Vela||julia@correo.ec|",
    ].join(";") && fisioClients() === fisioBefore + 9,
  "en la base: los 9 con origen «import» y con lo que traían (el de sólo el nombre, sin nada más)",
);
ok(
  count(`select count(*) from audit_logs where business_id = '${fisio}' and action = 'client.imported' and summary = 'Importó 9 pacientes (1 con error, 5 por completar)'`) === 1 &&
    fisioAudit() === 1,
  "una entrada en la actividad: «Importó 9 pacientes (1 con error, 5 por completar)»",
  sql(`select summary from audit_logs where business_id = '${fisio}' and action = 'client.imported'`),
);
ok(count("select count(*) from notifications") === notificationsBeforeIncomplete, "ningún email a los importados por completar");
r = await importWith(tomas, `/businesses/${fisio}`, tenPatients, true);
const idOf = (name: string) => sql(`select id from clients where business_id = '${fisio}' and name = '${name}'`);
ok(
  r.status === 200 && r.body.created === 0 && r.body.existing.length === 9 && r.body.incomplete.length === 0 && JSON.stringify(r.body.errors) === JSON.stringify(badDocument),
  "repetir la importación con la casilla no crea ninguno: los 9 ya existían",
  r.body,
);
ok(
  r.body.existing.find((e) => e.row === 7)?.clientId === idOf("Fabián León") &&
    r.body.existing.find((e) => e.row === 6)?.clientId === idOf("Elena Ruiz") &&
    r.body.existing.find((e) => e.row === 12)?.clientId === idOf("Julia Vela"),
  "también los que no tienen cédula, por el nombre, el email y el teléfono (y el de sólo el nombre, por el nombre)",
  r.body.existing,
);
ok(fisioClients() === fisioBefore + 9 && fisioAudit() === 1, "ni un paciente más ni otra entrada en la actividad");

const usageOf = async () => (await daniela("GET", `/businesses/${nutrivida}/subscription/usage`)).body as { clients: number; limits: { clients: number } };
const room = 47 - (await usageOf()).clients;
sql(`insert into clients (business_id, name) select '${nutrivida}', 'Relleno ' || g from generate_series(1, ${room}) g`);
ok((await usageOf()).clients === 47 && (await usageOf()).limits.clients === 50, "un negocio Free con 47 pacientes (le caben 3)", await usageOf());
const capped = reviewOf(tenPatients, true, 3);
r = await importWith(daniela, `/businesses/${nutrivida}`, tenPatients, true);
ok(
  r.status === 200 && r.body.created === 3 && JSON.stringify(r.body.overLimit) === JSON.stringify([5, 6, 7, 9, 11, 12]) &&
    JSON.stringify(r.body.incomplete) === JSON.stringify([{ row: 4, missing: ["email"] }]),
  "el tope del plan cuenta también los por completar: entran los 3 primeros (uno de ellos por completar)",
  r.body,
);
ok(JSON.stringify(r.body) === JSON.stringify(asApi(capped)), "la revisión del panel da lo mismo que la API");
ok((await usageOf()).clients === 50, "el uso del plan dice 50", await usageOf());
ok(
  count(`select count(*) from audit_logs where business_id = '${nutrivida}' and action = 'client.imported' and summary = 'Importó 3 pacientes (1 con error, 1 por completar, 6 por el tope del plan)'`) === 1,
  "la actividad: «Importó 3 pacientes (1 con error, 1 por completar, 6 por el tope del plan)»",
  sql(`select summary from audit_logs where business_id = '${nutrivida}' and action = 'client.imported' order by created_at desc limit 1`),
);

console.log("Avisos por ntfy");
const ntfySince = sql("select now()");
const formClient = await jhordan("POST", `${J}/clients`, {
  name: "Paciente Formulario Ntfy",
  documentId: cedula("141", 1),
  email: "formulario.ntfy@example.com",
  phone: "",
  address: "",
  notes: "",
  isActive: true,
});
r = await importTo(jhordan, J, Array.from({ length: 30 }, (_, i) => row(i + 2, { name: `Paciente Aviso ${i}`, documentId: cedula("142", i), email: `aviso.${i}@example.com` })));
ok(formClient.status === 200 && r.status === 200 && r.body.created === 30, "un paciente del formulario y una importación de 30 a la vez");
const until = sql("select now()");
const panel = await findPanelClients(pool, ntfySince, until);
ok(
  panel.total === 1 && panel.clients[0].name === "Paciente Formulario Ntfy",
  "«paciente nuevo»: sale el del formulario y ninguno de los importados",
  panel.clients.map((c) => c.name),
);
const found = await findClientImports(pool, ntfySince, until);
ok(found.total === 1 && found.imports[0].summary === "Importó 30 pacientes", "findClientImports devuelve la importación", found);
const notice = found.imports[0] ? clientImportNotice(found.imports[0]) : null;
ok(
  notice?.title === "Agenda360: pacientes importados" &&
    notice.message === [found.imports[0].businessName, "Importó 30 pacientes", "Desde el panel por Jhordan H. (Propietario)"].join("\n"),
  "el aviso: el título sin el negocio y el mensaje con la cifra y quién la hizo, a medias",
  notice,
);
ok(!/Paciente Aviso|aviso\.\d+@|142\d{7}/.test(notice?.message ?? ""), "sin nombres, emails ni cédulas de pacientes", notice?.message);
await pool.end();

const ntfy = await fakeNtfy();
try {
  // La primera pasada mira el último día: todas las importaciones de esta prueba.
  const total = count("select count(*) from audit_logs where action = 'client.imported' and created_at > now() - interval '1 day'");
  let run = await runCron(ntfy.url);
  const sent = ntfy.received.filter((n) => n.title === "Agenda360: pacientes importados");
  const more = ntfy.received.filter((n) => n.title === "Agenda360: más importaciones");
  ok(
    run.code === 0 && total > 10 && sent.length === 10 && more.length === 1 &&
      more[0].message === `…y ${total - 10} ${total - 10 === 1 ? "importación más" : "importaciones más"} de pacientes (detalle en la actividad de cada negocio).`,
    "el cron manda un aviso por importación (10 por pasada) y dice cuántas faltan",
    { total, sent: sent.length, more: more.map((n) => n.message) },
  );
  ok(
    sent.every((n) => /^.+\nImportó \d+ pacientes?( \(.+\))?\nDesde el panel por /.test(n.message) && !n.message.includes("@")),
    "cada uno con el negocio, la cifra y quién la hizo, sin emails",
    sent.map((n) => n.message),
  );
  ok(new RegExp(`importaciones: ${total} · `).test(run.output) && !/@/.test(run.output), "la línea del registro dice cuántas (sólo la cifra)", run.output.slice(-500));
  ok(
    !ntfy.received.some((n) => n.title === "Agenda360: nuevo paciente" && /Paciente (Aviso|Importado|Doble|Tope)/.test(n.message)),
    "los importados no salen uno por uno como «nuevo paciente»",
  );
  run = await runCron(ntfy.url);
  ok(
    /importaciones: 0 · /.test(run.output) && ntfy.received.filter((n) => n.title === "Agenda360: pacientes importados").length === 10,
    "cada importación se avisa una sola vez",
    run.output.slice(-400),
  );
} finally {
  ntfy.close();
}

done("de la importación de pacientes");
