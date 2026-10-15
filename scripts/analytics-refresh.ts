/**
 * `npm run analytics:refresh`: prepara ya la foto de hoy de la analítica del super admin (spec 016), la
 * de 30 y la de 90 días, contra la base del entorno, a cualquier hora y aunque ya estuviera (la
 * reemplaza). Es para probar en local: en producción la prepara el cron de GitHub cada mañana, después
 * de las 06:00 de Ecuador (para no esperar, GitHub → Actions → «Run workflow»).
 *
 * Con la base de producción desde este equipo no hace nada: desde aquí sólo se consulta en lectura. Sólo
 * imprime cifras, nunca datos de pacientes.
 */
const { config } = await import("../src/config.ts");
const { pool } = await import("../src/db/pool.ts");

if (config.productionDbFromHere && !process.env.GITHUB_ACTIONS) {
  console.error(
    "Es la base de producción: desde este equipo sólo se consulta en lectura. La foto la prepara el cron de GitHub " +
      "cada mañana (para no esperar: GitHub → Actions → «Run workflow»).",
  );
  await pool.end();
  process.exit(1);
}

const { refreshAnalytics } = await import("../src/services/analytics-service.ts");
try {
  const started = Date.now();
  const result = await refreshAnalytics({ force: true });
  console.info(
    `✓ Analítica preparada: ${result.businesses ?? 0} negocios, 30 y 90 días (${Date.now() - started} ms). ` +
      `Fotos de más de 30 días borradas: ${result.purged}.`,
  );
} catch (error) {
  console.error("✗ No se pudo preparar la analítica:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
