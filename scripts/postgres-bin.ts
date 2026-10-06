import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Carpeta con initdb/pg_ctl/psql: PG_BIN, pg_config o las rutas habituales. */
export function findPostgresBin(): string | null {
  const candidates = [
    process.env.PG_BIN,
    (() => {
      try {
        return execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim();
      } catch {
        return undefined;
      }
    })(),
    "/opt/homebrew/opt/postgresql@16/bin",
    "/usr/local/opt/postgresql@16/bin",
    "/usr/lib/postgresql/16/bin",
  ];
  return candidates.find((dir) => dir && existsSync(join(dir, "initdb"))) ?? null;
}
