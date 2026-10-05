// Solicitudes de cambio de plan.
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

const { a: owner, session: os } = await login("jhordan@demo.com"); // Pro, 3 usuarios
const B = `/businesses/${os.businessId}`;
const { a: admin } = await login("admin@demo.com");

console.log("El propietario solicita");
let r = await owner("PUT", `${B}/subscription`, { plan: "business" });
ok(r.status === 404, "no existe cambio directo desde el panel del negocio", r.status);
r = await owner("GET", `${B}/subscription/request`);
ok(r.status === 200 && r.body === null, "sin solicitud pendiente al inicio", r.body);
r = await owner("POST", `${B}/subscription/request`, { plan: "pro" });
ok(r.status === 409 && /Ya tienes el plan/.test(r.body.error.message), "no puede pedir su mismo plan", r.body);
r = await owner("POST", `${B}/subscription/request`, { plan: "free" });
ok(r.status === 409 && /usuario/.test(r.body.error.message), "no puede pedir Free con 3 usuarios", r.body);
r = await owner("POST", `${B}/subscription/request`, { plan: "business" });
ok(r.status === 200 && r.body.status === "pending" && r.body.currentPlan === "pro" && r.body.requestedPlan === "business", "solicita Business", r.body);
const requestId = r.body.id;
r = await owner("POST", `${B}/subscription/request`, { plan: "business" });
ok(r.status === 409 && /pendiente/.test(r.body.error.message), "no puede tener dos pendientes", r.body);
r = await owner("GET", `${B}/subscription/request`);
ok(r.body?.id === requestId, "ve su solicitud pendiente", r.body);
r = await owner("GET", `${B}/subscription`);
ok(r.body.plan === "pro", "el plan no cambia hasta que se aprueba", r.body);
const { a: staff } = await login("miguel@demo.com");
r = await staff("POST", `${B}/subscription/request`, { plan: "business" });
ok(r.status === 403, "el staff no puede solicitar", r.status);

console.log("El super admin recibe y aprueba");
let emails = (await admin("GET", "/admin/emails")).body;
const notice = emails.find((e) => e.type === "plan_change_requested" && e.to === "admin@demo.com");
ok(notice && /Centro Profesional/.test(notice.subject) && /Business/.test(notice.body) && /\/admin/.test(notice.body), "email al super admin", notice);
r = await admin("GET", "/admin/plan-requests");
ok(r.body?.[0]?.id === requestId && r.body[0].businessName === "Centro Profesional" && r.body[0].status === "pending", "aparece en su panel", r.body?.[0]);
r = await owner("GET", "/admin/plan-requests");
ok(r.status === 403, "un propietario no ve el panel de solicitudes", r.status);
r = await admin("POST", `/admin/plan-requests/${requestId}/approve`);
ok(r.status === 204, "aprobar", r.body);
r = await owner("GET", `${B}/subscription`);
ok(r.body.plan === "business", "el plan queda aplicado", r.body);
r = await owner("GET", `${B}/subscription/request`);
ok(r.body === null, "ya no hay solicitud pendiente", r.body);
r = await admin("POST", `/admin/plan-requests/${requestId}/approve`);
ok(r.status === 409, "no se aprueba dos veces", r.body);
emails = (await admin("GET", "/admin/emails")).body;
ok(emails.some((e) => e.type === "plan_change_approved" && e.to === "jhordan@demo.com" && /Business/.test(e.body)), "email de aprobación al propietario");
const history = (await owner("GET", `${B}/audit-logs?entityType=subscription`)).body.entries.map((l) => l.action);
ok(history.includes("subscription.plan_change_requested") && history.includes("platform.plan_change_approved"), "historial del plan", history);

console.log("Rechazar y cancelar");
const { a: laura, session: ls } = await login("laura@demo.com"); // Free
const LB = `/businesses/${ls.businessId}`;
r = await laura("POST", `${LB}/subscription/request`, { plan: "pro" });
const lauraRequest = r.body.id;
r = await admin("POST", `/admin/plan-requests/${lauraRequest}/reject`, { reason: "Falta confirmar el pago" });
ok(r.status === 204, "rechazar con motivo", r.body);
r = await laura("GET", `${LB}/subscription`);
ok(r.body.plan === "free", "el plan se mantiene", r.body);
emails = (await admin("GET", "/admin/emails")).body;
ok(emails.some((e) => e.type === "plan_change_rejected" && e.to === "laura@demo.com" && /Falta confirmar el pago/.test(e.body)), "email de rechazo con el motivo");
r = await laura("POST", `${LB}/subscription/request`, { plan: "pro" });
ok(r.status === 200, "puede volver a solicitar", r.body);
r = await laura("DELETE", `${LB}/subscription/request`);
ok(r.status === 204, "cancelar la solicitud", r.body);
r = await laura("DELETE", `${LB}/subscription/request`);
ok(r.status === 404, "nada que cancelar", r.body);
r = await admin("GET", "/admin/plan-requests");
const statuses = r.body.filter((x) => x.businessId === ls.businessId).map((x) => x.status).sort();
ok(JSON.stringify(statuses) === JSON.stringify(["cancelled", "rejected"]), "resueltas visibles en el panel", statuses);

console.log("Modo soporte");
r = await admin("PUT", `${LB}/subscription`, { plan: "pro" });
ok(r.status === 404, "tampoco en modo soporte: el panel del negocio no cambia planes", r.status);
r = await admin("PUT", `/admin/businesses/${ls.businessId}/plan`, { plan: "pro" });
ok(r.status === 200 && r.body.plan === "pro", "el super admin lo cambia desde su panel", r.body);
emails = (await admin("GET", "/admin/emails")).body;
ok(emails.some((e) => e.type === "plan_changed" && e.to === "laura@demo.com" && /Pro/.test(e.body)), "y el propietario recibe un email");
r = await admin("POST", `${LB}/subscription/request`, { plan: "business" });
ok(r.status === 400, "el super admin no envía solicitudes", r.body);

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas de solicitudes de plan pasaron");
process.exitCode = failures ? 1 : 0;
