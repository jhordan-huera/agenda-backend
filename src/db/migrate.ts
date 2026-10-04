import { readdir, readFile } from "node:fs/promises";
import { pool } from "./pool.ts";

/**
 * `npm run db:migrate`: aplica en orden los archivos db/migrations/*.sql que aún no se
 * aplicaron. Cada archivo corre en su propia transacción y queda anotado en
 * schema_migrations, así que se puede ejecutar tantas veces como se quiera.
 * Para cambiar el esquema, añade un archivo nuevo (002_…sql); nunca edites uno aplicado.
 */
const MIGRATIONS_DIR = new URL("../../db/migrations/", import.meta.url);

async function migrate() {
  await pool.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const applied = new Set((await pool.query("select name from schema_migrations")).rows.map((row) => row.name as string));
  const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith(".sql")).sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(new URL(file, MIGRATIONS_DIR), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.info(`✓ ${file}`);
      count++;
    } catch (error) {
      await client.query("rollback");
      throw new Error(`Falló la migración ${file}: ${error instanceof Error ? error.message : error}`, { cause: error });
    } finally {
      client.release();
    }
  }
  console.info(count ? `Migraciones aplicadas: ${count}.` : "La base de datos ya está al día.");
}

try {
  await migrate();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
