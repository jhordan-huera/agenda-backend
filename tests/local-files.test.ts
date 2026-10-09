// Almacenamiento local (npm run dev:local): nadie sale de la carpeta de archivos con "..", ni
// codificado (%2F) en un solo trozo de la ruta; la API sólo escucha en este equipo; y las
// respuestas de /api no se guardan en cachés salvo las públicas que lo piden.
import { mkdirSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join, relative } from "node:path";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
const ORIGIN = new URL(BASE).origin;
const STORAGE = process.env.LOCAL_STORAGE_DIR!;
const ROOT = new URL("..", import.meta.url).pathname;
let failures = 0;
const ok = (cond: unknown, label: string, extra?: unknown) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300));
  }
};

/** Una ruta con cada "/" codificada (%2F): Express la decodifica en un solo trozo. */
const encoded = (path: string) => path.split("/").map(encodeURIComponent).join("%2F");
const get = (path: string) => fetch(`${BASE}${path}`, { headers: { "X-Requested-With": "fetch" } });

console.log("Imágenes públicas sin salir de su carpeta");
const SECRET = "CONTENIDO-SECRETO-FUERA-DEL-BUCKET";
mkdirSync(join(STORAGE, "imagenes", "logos", "prueba"), { recursive: true });
writeFileSync(join(STORAGE, "imagenes", "logos", "prueba", "logo.png"), "imagen-de-prueba");
// Fuera del bucket público (p. ej. la carpeta de las historias clínicas o el .env de más arriba).
writeFileSync(join(STORAGE, "fuera.txt"), SECRET);

let res = await get("/files/public/imagenes/logos/prueba/logo.png");
ok(res.status === 200 && (await res.text()) === "imagen-de-prueba", "una imagen pública se sirve", res.status);
ok(res.headers.get("cache-control") === "public, max-age=3600", "con su propia caché", res.headers.get("cache-control"));

// El .env del proyecto (con la DATABASE_URL de producción), desde la carpeta del bucket.
const toEnv = relative(join(STORAGE, "imagenes"), join(ROOT, ".env"));
for (const [label, path] of [
  ["..%2F..%2F.env", `/files/public/imagenes/${encoded("../../.env")}`],
  [".env del proyecto con %2F", `/files/public/imagenes/${encoded(toEnv)}`],
  ["un archivo fuera del bucket con %2F", `/files/public/imagenes/${encoded("../fuera.txt")}`],
  ["con los puntos codificados", "/files/public/imagenes/%2E%2E%2Ffuera.txt"],
  ["con barra invertida", "/files/public/imagenes/..%5Cfuera.txt"],
  ["dentro de otra carpeta", `/files/public/imagenes/logos/${encoded("../../fuera.txt")}`],
  ["ruta absoluta", `/files/public/imagenes/${encoded("/etc/passwd")}`],
] as const) {
  res = await get(path);
  const body = await res.text();
  // Sólo el código: si fallara, el cuerpo podría ser el .env.
  ok(res.status === 404 && !body.includes(SECRET) && !body.includes("DATABASE_URL"), `${label}: 404`, res.status);
}

console.log("Rutas de archivo locales");
const { localFilePath, readLocalFile } = await import("../src/services/file-storage.ts");
const throws = (fn: () => unknown) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};
ok(localFilePath("imagenes", "logos/a.png") === join(STORAGE, "imagenes", "logos", "a.png"), "una ruta normal queda en su bucket");
ok(throws(() => localFilePath("imagenes", "../fuera.txt")), "con .. se rechaza");
ok(throws(() => localFilePath("imagenes", "logos/../../fuera.txt")), "también en medio de la ruta");
ok(throws(() => localFilePath("..", "fuera.txt")), "y en el nombre del bucket");
ok(await readLocalFile("imagenes", "../fuera.txt").then(() => false, () => true), "leer fuera del bucket falla");

console.log("Sólo escucha en este equipo");
const port = new URL(BASE).port;
const lanAddresses = Object.values(networkInterfaces())
  .flat()
  .filter((net) => net && net.family === "IPv4" && !net.internal)
  .map((net) => net!.address);
if (lanAddresses.length === 0) console.log("  (sin red local: no se comprueba)");
for (const address of lanAddresses.slice(0, 2)) {
  const reached = await fetch(`http://${address}:${port}/api/health`, { signal: AbortSignal.timeout(3_000) }).then(
    () => true,
    () => false,
  );
  ok(!reached, `no responde desde la red local (${address})`);
}
ok((await fetch(`${ORIGIN}/api/health`)).ok, "sí desde 127.0.0.1");

console.log("Cachés");
res = await get("/health");
ok(res.headers.get("cache-control") === "no-store", "las respuestas de /api llevan no-store", res.headers.get("cache-control"));
res = await get("/public/businesses/no-existe-este-negocio");
ok(res.headers.get("cache-control") === "no-store", "también los errores", res.headers.get("cache-control"));
res = await get("/public/categories");
ok(
  res.status === 200 && res.headers.get("cache-control") === "public, max-age=0, s-maxage=60, stale-while-revalidate=60",
  "las públicas que ponen su caché la conservan",
  res.headers.get("cache-control"),
);

console.log(failures === 0 ? "\nTodo bien." : `\n${failures} fallos.`);
process.exitCode = failures === 0 ? 0 : 1;
