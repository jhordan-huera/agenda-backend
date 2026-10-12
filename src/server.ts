import { createServer } from "node:http";
import { app } from "./app.ts";
import { config } from "./config.ts";
import { pool } from "./db/pool.ts";
import { startReminderJob } from "./jobs/reminders.ts";
import { startEmailWorker } from "./services/mailer.ts";
import { fileStorage } from "./services/file-storage.ts";

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

/**
 * En la nube (Lambda) escucha en todas las interfaces, como siempre. En un equipo propio, sólo en
 * 127.0.0.1: nadie de la misma red (la Wi-Fi) llega a la API; el frontend de desarrollo entra por el
 * proxy de Vite, que corre en este mismo equipo.
 */
const host = config.hosted ? undefined : "127.0.0.1";
const server = createServer(app);
server.on("error", (error) => {
  console.error(`✗ La API no pudo escuchar en el puerto ${config.port}: ${error.message}`);
  process.exit(1);
});
server.listen(config.port, host, () => {
  console.info(
    `API de Agenda360 en http://localhost:${config.port}/api${host ? " (sólo desde este equipo)" : ""} (frontend: ${config.frontendUrl})`,
  );
  if (config.productionDbFromHere) {
    console.warn(
      [
        "",
        "\x1b[41m\x1b[97m BASE DE PRODUCCIÓN \x1b[0m Lo que hagas aquí es real: negocios, clientes, citas y emails.",
        "  · Sin tareas de fondo: la cola de emails y los recordatorios siguen en el cron de GitHub.",
        "  · Los emails de lo que hagas van a sus destinatarios reales,",
        `    con enlaces a ${config.appUrl}${config.appUrl.includes("localhost") ? "  ⚠ define APP_URL con la web publicada" : ""}.`,
        fileStorage
          ? "  · Archivos, comprobantes, logos y fotos van al Supabase Storage de producción."
          : "  · Sin Supabase en .env: no se pueden subir archivos, comprobantes ni imágenes.",
        "",
      ].join("\n"),
    );
  }
  void checkDatabase();
});
// Alojada (Lambda) o contra la base de producción desde este equipo, no: el cron de GitHub ya lo
// hace (y aquí competiría con él por la cola).
const backgroundJobs = !config.hosted && !config.productionDbFromHere;
const stopReminderJob = backgroundJobs ? startReminderJob() : () => undefined;
const stopEmailWorker = backgroundJobs ? startEmailWorker() : () => undefined;

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
