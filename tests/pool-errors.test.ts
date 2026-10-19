/**
 * Un corte de red en una conexión prestada no tumba el proceso (2026-10-19: el pooler de Supabase cerró
 * con ECONNRESET una conexión en uso y `npm run dev` terminó con «Unhandled 'error' event»). Se simula
 * rompiendo el socket de un cliente que está fuera del pool.
 */
import { pool } from "../src/db/pool.ts";
import { checks } from "./helpers/harness.ts";

const { ok, done } = checks();
let crashed: unknown = null;
process.on("uncaughtException", (error) => {
  crashed = error;
});

console.log("Un corte de red en una conexión en uso");
const client = await pool.connect();
const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
(client as unknown as { connection: { stream: { destroy(error: Error): void } } }).connection.stream.destroy(reset);
await new Promise((resolve) => setTimeout(resolve, 200));
ok(crashed === null, "el proceso sigue vivo: el error se escucha", crashed instanceof Error ? crashed.message : crashed);
const failed = await client.query("select 1").then(
  () => false,
  () => true,
);
ok(failed, "la consulta en esa conexión falla, como debe");
client.release();
const fresh = await pool.query("select 1 as uno").then(
  (r) => r.rows[0]?.uno === 1,
  () => false,
);
ok(fresh, "el pool descarta la conexión rota y la siguiente consulta funciona");
await pool.end();

done("de los cortes de conexión");
