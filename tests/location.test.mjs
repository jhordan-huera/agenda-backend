// Ubicación del local en el mapa.
const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
let failures = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300));
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
const pub = agent();
const { a: owner, session: os } = await login("jhordan@demo.com");
const B = `/businesses/${os.businessId}`;

console.log("Guardar la ubicación");
let r = await owner("GET", B);
ok(typeof r.body.lat === "number" && typeof r.body.lng === "number", "los negocios demo con dirección tienen punto", r.body);
const point = { lat: -0.176512, lng: -78.480163 };
r = await owner("PATCH", B, point);
ok(r.status === 200 && r.body.lat === point.lat && r.body.lng === point.lng, "marcar el local", r.body);
r = await owner("PATCH", B, { lat: -0.2 });
ok(r.status === 400 && /mapa/.test(r.body.error.message), "sólo latitud → 400", r.body);
r = await owner("PATCH", B, { lat: 200, lng: 0 });
ok(r.status === 400, "latitud fuera de rango → 400", r.body);
r = await owner("PATCH", B, { name: r.body?.name ?? "Centro Profesional" });
ok((await owner("GET", B)).body.lat === point.lat, "guardar otro dato no borra el punto");
r = await owner("GET", `/public/businesses/${(await owner("GET", B)).body.slug}`);
ok(r.status === 200 && r.body.business.lat === point.lat && r.body.business.lng === point.lng, "la página pública recibe el punto", r.body?.business);

console.log("Emails");
const services = (await owner("GET", `${B}/services`)).body;
const service = services.find((s) => s.isActive && s.location !== "home");
const clients = (await owner("GET", `${B}/clients`)).body;
r = await owner("POST", `${B}/appointments`, { clientId: clients[0].id, serviceId: service.id, date: "2026-12-02", startTime: "20:00", durationMinutes: service.durationMinutes, price: service.price, status: "confirmed", notes: "" });
ok(r.status === 200, "crear cita en el local", r.body);
let emails = (await owner("GET", `${B}/notifications`)).body;
let conf = emails.find((e) => e.appointmentId === r.body.id);
ok(conf && conf.body.includes(`Cómo llegar: https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${point.lat},${point.lng}`)}`), "el email lleva al punto exacto", conf?.body);
await owner("DELETE", `${B}/appointments/${r.body.id}`);

r = await owner("PATCH", B, { lat: null, lng: null });
ok(r.status === 200 && r.body.lat === null && r.body.lng === null, "quitar la ubicación", r.body);
r = await owner("POST", `${B}/appointments`, { clientId: clients[0].id, serviceId: service.id, date: "2026-12-03", startTime: "20:00", durationMinutes: service.durationMinutes, price: service.price, status: "confirmed", notes: "" });
emails = (await owner("GET", `${B}/notifications`)).body;
conf = emails.find((e) => e.appointmentId === r.body.id);
const address = (await owner("GET", B)).body.address;
ok(!address || conf.body.includes(`destination=${encodeURIComponent(address)}`), "sin punto, el email usa la dirección escrita", conf?.body);

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas de ubicación pasaron");
process.exitCode = failures ? 1 : 0;
