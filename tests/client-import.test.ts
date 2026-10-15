// Importar pacientes desde un Excel o un CSV (spec 012): POST /businesses/:id/clients/import. Permisos,
// el caso de la spec (200 filas con errores, repetidas y que ya existen), repetirla sin duplicar, dos a
// la vez, la limpieza, los datos obligatorios del negocio, el tope del plan, los topes de la petición,
// los avisos por ntfy y el Inicio del super admin. Todo con datos inventados.
import { agent, checks, count, fakeNtfy, login, runCron, sql } from "./helpers/harness.ts";
import { clientImportNotice, findClientImports, findPanelClients } from "../src/services/booking-alerts.ts";
import { pool } from "../src/db/pool.ts";
import {
  classifyImportRows,
  guessColumns,
  importSummary,
  prepareImportRow,
} from "../src/shared/lib/validations/client-import.ts";
import type { AuditLog, Client, ClientImportResult, ClientImportRow, PlatformStats } from "../src/shared/types/index.ts";

const { ok, done } = checks();

/** Cédula ecuatoriana válida: `prefix` (3 dígitos: la provincia y un tercer dígito menor que 6) y un número. Distinta de las de la demo (170…). */
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
const empty: ClientImportResult = { created: 0, existing: [], repeated: [], errors: [], overLimit: [] };
ok(
  importSummary({ ...empty, created: 1 }) === "Importó 1 paciente" &&
    importSummary({ ...empty, created: 3, errors: [{ row: 2, reason: "x" }], overLimit: [4, 5] }) ===
      "Importó 3 pacientes (1 con error, 2 por el tope del plan)" &&
    importSummary({ ...empty, created: 2, existing: [{ row: 2, clientId: "a" }], repeated: [{ row: 3, firstRow: 2 }] }) ===
      "Importó 2 pacientes (1 ya existía, 1 repetida en el archivo)",
  "el resumen: en singular cuando es una y sólo las partes que pasan de cero",
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
  if (i === 10) rows.push(row(rows.length + 2, { name: "Dígito Mal", documentId: wrongCheckDigit(cedula("135", 900)), email: "digito@example.com" }));
  if (i === 20) rows.push(row(rows.length + 2, { name: "Sin Email", documentId: cedula("135", 901) }));
  if (i === 30) rows.push(row(rows.length + 2, { name: "Email Malo", documentId: cedula("135", 902), email: "no-es-un-email" }));
  if (i === 40) rows.push(row(rows.length + 2, { name: "Teléfono Malo", documentId: cedula("135", 903), email: "tel@example.com", phone: "099 ABC 4567" }));
  if (i === 50) rows.push(row(rows.length + 2, { name: "Cédula Letras", documentId: "17ABC23456", email: "letras@example.com" }));
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
      "La cédula no es válida. Revisa el número.",
      "El email es obligatorio",
      "Ingresa un email válido",
      "Ingresa un teléfono válido",
      "Cédula: escribe sólo números, sin letras ni guiones",
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
r = await importTo(jhordan, J, clean);
ok(
  r.status === 200 && r.body.created === 3 && r.body.errors.length === 1 && r.body.errors[0].row === 5 && r.body.errors[0].reason === "La cédula debe tener 10 dígitos.",
  "la API limpia igual: se crean 3, y la de 9 dígitos que no vale con el 0 da su error",
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
