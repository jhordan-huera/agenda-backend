import { app } from "./app.ts";
import { config } from "./config.ts";
import { pool } from "./db/pool.ts";
import { startReminderJob } from "./jobs/reminders.ts";
import { startEmailWorker } from "./services/mailer.ts";

/** Comprueba la base de datos al arrancar y avisa de lo que falta, sin detener el servidor. */
async function checkDatabase(): Promise<void> {
  try {
    const { rows } = await pool.query("select to_regclass('public.schema_migrations') is not null as migrated");
    if (!rows[0].migrated) {
      console.warn("⚠ La base de datos está vacía: ejecuta `npm run db:migrate` para crear las tablas.");
    } else {
      console.info("✓ Conectado a PostgreSQL");
    }
  } catch (error) {
    console.error(
      "✗ No se pudo conectar a PostgreSQL. Revisa DATABASE_URL (y DATABASE_SSL) en .env:",
      error instanceof Error ? error.message : error,
    );
  }
}

const server = app.listen(config.port, () => {
  console.info(`API de Agendo en http://localhost:${config.port}/api (frontend: ${config.frontendUrl})`);
  void checkDatabase();
});
const stopReminderJob = startReminderJob();
const stopEmailWorker = startEmailWorker();

function shutdown() {
  stopReminderJob();
  stopEmailWorker();
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
