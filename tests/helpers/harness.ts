// Piezas comunes de las pruebas de la spec 009: comprobaciones, peticiones con su cookie y su IP,
// SQL contra la base de prueba, otra API (como otra instancia en la nube), un ntfy falso y el cron.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";

export const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
export const PROXY_SECRET = process.env.PROXY_SECRET ?? "";
export const DEMO_PASSWORD = "demo1234";

export function checks() {
  let failures = 0;
  return {
    ok(cond: unknown, label: string, extra?: unknown) {
      if (cond) console.log("  ✓", label);
      else {
        failures++;
        console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 500));
      }
    },
    /** `title`: «de los topes de intentos», «del endurecimiento…». */
    done(title: string) {
      console.log(failures ? `\n${failures} prueba(s) fallaron` : `\nTodas las pruebas ${title} pasaron`);
      process.exitCode = failures ? 1 : 0;
    },
  };
}

export interface Reply {
  status: number;
  body: any;
  headers: Headers;
}

/**
 * Un navegador: guarda su cookie. Con `ip`, llega como si pasara por el proxy del frontend desde esa
 * IP (con el secreto de la fase 1): cada prueba usa las suyas y no gasta los límites de las demás.
 */
export function agent(options: { base?: string; ip?: string } = {}) {
  let cookie = "";
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> => {
    const res = await fetch((options.base ?? BASE) + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "fetch",
        ...(options.ip ? { "x-agendo-proxy-secret": PROXY_SECRET, "x-agendo-client-ip": options.ip } : {}),
        ...headers,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) cookie = c.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined, headers: res.headers };
  };
  return Object.assign(call, { cookie: () => cookie, setCookie: (value: string) => (cookie = value) });
}

export async function login(email: string, options: { ip?: string; remember?: boolean; base?: string } = {}) {
  const browser = agent(options);
  const r = await browser("POST", "/auth/login", { email, password: DEMO_PASSWORD, remember: options.remember ?? true });
  if (r.status !== 200) throw new Error(`No se pudo entrar como ${email}: ${JSON.stringify(r.body)}`);
  return Object.assign(browser, { session: r.body });
}

export const sql = (query: string) =>
  execFileSync("psql", [process.env.TEST_DATABASE_URL!, "-qAtc", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
export const count = (query: string) => Number(sql(query));
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** Otra API contra la misma base, con otras variables (p. ej. como si estuviera en la nube). */
export async function startApi(env: Record<string, string | undefined>) {
  const port = await freePort();
  let output = "";
  let exited: number | null = null;
  const child: ChildProcess = spawn(process.execPath, ["src/server.ts"], {
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (chunk) => (output += chunk));
  child.stderr!.on("data", (chunk) => (output += chunk));
  child.on("exit", (code) => (exited = code ?? -1));
  const base = `http://127.0.0.1:${port}/api`;
  for (let i = 0; i < 100 && exited === null; i++) {
    if (await fetch(`${base}/health`).then((res) => res.ok, () => false)) break;
    await sleep(100);
  }
  return { base, output: () => output, exited: () => exited, stop: () => child.kill("SIGTERM") };
}

/** Un ntfy de mentira: guarda los avisos que recibe. */
export async function fakeNtfy() {
  const received: { title: string; message: string; priority: number; click?: string }[] = [];
  const server = createHttpServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received.push(JSON.parse(body));
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, received, close: () => server.close() };
}

/** Una pasada del cron de GitHub (scripts/cron.ts) contra la base de prueba, con el ntfy de mentira. */
export function runCron(ntfyUrl: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn(process.execPath, ["scripts/cron.ts"], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: "test",
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        DATABASE_SSL: "false",
        FRONTEND_URL: "https://agendo.example",
        LOCAL_STORAGE_DIR: process.env.LOCAL_STORAGE_DIR,
        NTFY_TOPIC: "agendo-pruebas",
        NTFY_SERVER: ntfyUrl,
        APP_URL: "https://agendo.example",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (chunk) => (output += chunk));
    child.stderr!.on("data", (chunk) => (output += chunk));
    child.on("exit", (code) => resolve({ code, output }));
  });
}
