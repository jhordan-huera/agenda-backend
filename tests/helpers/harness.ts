// Piezas comunes de las pruebas de la spec 009: comprobaciones, peticiones con su cookie y su IP,
// SQL contra la base de prueba, otra API (como otra instancia en la nube), un ntfy falso y el cron. Y de
// la spec 013: un servicio de avisos falso que descifra lo que recibe.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createDecipheriv, createECDH, hkdfSync, randomBytes, type ECDH } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { viaProxy } from "./proxy.mjs";

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
 * IP (con su firma): cada prueba usa las suyas y no gasta los límites de las demás.
 */
export function agent(options: { base?: string; ip?: string } = {}) {
  let cookie = "";
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> => {
    const res = await fetch((options.base ?? BASE) + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "fetch",
        ...(options.ip ? viaProxy(options.ip) : {}),
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

/**
 * Una pasada del cron de GitHub (scripts/cron.ts) contra la base de prueba, con el ntfy de mentira.
 * `env`: variables de más (p. ej. las claves VAPID de las pruebas, spec 013).
 */
export function runCron(ntfyUrl: string, env: Record<string, string | undefined> = {}): Promise<{ code: number | null; output: string }> {
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
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (chunk) => (output += chunk));
    child.stderr!.on("data", (chunk) => (output += chunk));
    child.on("exit", (code) => resolve({ code, output }));
  });
}

/**
 * Descifra un aviso como lo haría el navegador (RFC 8291 y 8188, un solo registro), con la clave privada
 * y el secreto del aparato de prueba. Devuelve el texto.
 */
export function decryptPushPayload(body: Buffer, device: { ecdh: ECDH; auth: Buffer }): string {
  const salt = body.subarray(0, 16);
  const keyLength = body[20];
  const serverPublicKey = body.subarray(21, 21 + keyLength);
  const encrypted = body.subarray(21 + keyLength);
  const userAgentPublicKey = device.ecdh.getPublicKey();
  const shared = device.ecdh.computeSecret(serverPublicKey);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0", "latin1"), userAgentPublicKey, serverPublicKey]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, device.auth, keyInfo, 32));
  const key = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0", "latin1"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0", "latin1"), 12));
  const decipher = createDecipheriv("aes-128-gcm", key, nonce);
  decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));
  const padded = Buffer.concat([decipher.update(encrypted.subarray(0, encrypted.length - 16)), decipher.final()]);
  let end = padded.length - 1;
  while (end > 0 && padded[end] === 0) end--;
  if (padded[end] !== 0x02) throw new Error("Falta el delimitador del último registro");
  return padded.subarray(0, end).toString("utf8");
}

/** Lo que recibió el servicio de avisos falso: el aviso descifrado y las cabeceras del envío. */
export interface ReceivedPush {
  endpoint: string;
  status: number;
  headers: Record<string, string | undefined>;
  payload: { title: string; body: string; url: string; tag: string; kind: string } | null;
}

/**
 * Un servicio de avisos de mentira (como el de Google o Apple) en 127.0.0.1: guarda cada POST, lo
 * descifra con la clave del aparato de prueba y responde 201 o lo que se le pida para ese aparato
 * (`respond`). La API lo acepta porque la base de las pruebas es local (config.pushAllowsLocalEndpoints).
 */
export async function fakePushService() {
  const received: ReceivedPush[] = [];
  const devices = new Map<string, { ecdh: ECDH; auth: Buffer }>();
  const replies = new Map<string, number[]>();
  const fixed = new Map<string, number>();
  let url = "";
  const server = createHttpServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const endpoint = `${url}${req.url}`;
      const device = devices.get(endpoint);
      let payload: ReceivedPush["payload"] = null;
      try {
        payload = device ? JSON.parse(decryptPushPayload(Buffer.concat(chunks), device)) : null;
      } catch {
        payload = null;
      }
      const status = replies.get(endpoint)?.shift() ?? fixed.get(endpoint) ?? 201;
      received.push({
        endpoint,
        status,
        headers: {
          ttl: req.headers.ttl as string | undefined,
          urgency: req.headers.urgency as string | undefined,
          authorization: req.headers.authorization,
          contentEncoding: req.headers["content-encoding"],
        },
        payload,
      });
      res.statusCode = status;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let seq = 0;
  return {
    url,
    received,
    /** Un aparato de prueba: su dirección en este servicio y sus claves, como las daría el navegador. */
    device() {
      const ecdh = createECDH("prime256v1");
      ecdh.generateKeys();
      const auth = randomBytes(16);
      const endpoint = `${url}/aparato/${++seq}-${randomBytes(4).toString("hex")}`;
      devices.set(endpoint, { ecdh, auth });
      return { endpoint, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } };
    },
    /** Las próximas respuestas a ese aparato (después, 201). */
    respond(endpoint: string, ...statuses: number[]) {
      replies.set(endpoint, [...(replies.get(endpoint) ?? []), ...statuses]);
    },
    /** Siempre esa respuesta a ese aparato (null: vuelve a 201). */
    always(endpoint: string, status: number | null) {
      if (status === null) fixed.delete(endpoint);
      else fixed.set(endpoint, status);
    },
    /** Lo que recibió ese aparato. */
    to(endpoint: string) {
      return received.filter((push) => push.endpoint === endpoint);
    },
    close: () => server.close(),
  };
}
