// Colores de marca de cada negocio: se guardan en la API y llegan al panel y a la página de reservas.
import { execFileSync } from "node:child_process";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
let failures = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 400));
  }
};
function agent() {
  let cookie = "";
  return async (method, path, body) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { "Content-Type": "application/json", "X-Requested-With": "fetch", ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) cookie = c.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
}
const login = async (email) => {
  const a = agent();
  const r = await a("POST", "/auth/login", { email, password: "demo1234", remember: true });
  return { a, session: r.body };
};
const sqlError = (query) => {
  try {
    execFileSync("psql", [process.env.TEST_DATABASE_URL, "-qAtc", query], { stdio: ["ignore", "pipe", "pipe"] });
    return null;
  } catch (error) {
    return String(error.stderr || error.message);
  }
};

const { a: owner, session } = await login("jhordan@demo.com");
const B = `/businesses/${session.businessId}`;
const { a: staff } = await login("miguel@demo.com");
const visitor = agent();

try {
  console.log("Guardar");
  let r = await owner("GET", B);
  ok(r.body.brandColors === null, "sin elegir: los colores de Agenda360 (null)", r.body.brandColors);
  r = await owner("PATCH", B, { brandColors: { primary: "#2F6B5E", highlight: " #DDD4F8 " } });
  ok(r.status === 200 && r.body.brandColors?.primary === "#2f6b5e" && r.body.brandColors.highlight === "#ddd4f8", "el propietario los guarda (en minúsculas)", r.body);
  r = await owner("PATCH", B, { name: r.body.name });
  ok(r.body.brandColors?.primary === "#2f6b5e", "editar otros datos no los borra", r.body.brandColors);
  r = await visitor("GET", `/public/businesses/${r.body.slug}`);
  ok(r.status === 200 && r.body.business.brandColors?.primary === "#2f6b5e", "la página de reservas los recibe", r.body.business?.brandColors);

  console.log("Validación y permisos");
  for (const [colors, label] of [
    [{ primary: "#12345", highlight: "#ddd4f8" }, "un color incompleto"],
    [{ primary: "red", highlight: "#ddd4f8" }, "un nombre de color"],
    [{ primary: "#2f6b5e" }, "sin el resaltado"],
  ]) {
    r = await owner("PATCH", B, { brandColors: colors });
    ok(r.status === 400, `${label} → 400`, r.body);
  }
  r = await staff("PATCH", B, { brandColors: { primary: "#a34d6d", highlight: "#f9dccb" } });
  ok(r.status === 403, "el staff no los cambia", r.body);
  const error = sqlError(`update businesses set brand_colors = '{"primary":"azul","highlight":"#ddd4f8"}' where id = '${session.businessId}'`);
  ok(error && /brand_colors_check/.test(error), "la base de datos tampoco acepta colores mal escritos", error);

  console.log("Volver a los de Agenda360");
  r = await owner("PATCH", B, { brandColors: null });
  ok(r.status === 200 && r.body.brandColors === null, "null vuelve a los colores de Agenda360", r.body.brandColors);
  r = await owner("GET", `${B}/audit-logs?limit=20`);
  const entries = r.body.entries.filter((entry) => entry.summary === "Actualizó los colores de la marca");
  const change = entries.flatMap((entry) => entry.changes ?? []).find((c) => c.after === "#2F6B5E y #DDD4F8");
  ok(entries.length >= 2 && change?.label === "Colores de la marca" && change.before === "Los de Agenda360", "queda en la actividad con el antes y el después", entries.map((e) => e.changes));
} finally {
  await owner("PATCH", B, { brandColors: null });
}

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas de colores de marca pasaron");
process.exitCode = failures ? 1 : 0;
