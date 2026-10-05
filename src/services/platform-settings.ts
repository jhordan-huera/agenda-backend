import { one, type Db } from "../db/pool.ts";
import type { PlatformSettings } from "../shared/types/index.ts";

/** Configuración global (una sola fila en platform_settings). */
export async function getPlatformSettings(db: Db): Promise<PlatformSettings> {
  return (await one<PlatformSettings>(
    db,
    `select allow_public_signup as "allowPublicSignup", support_email as "supportEmail", support_phone as "supportPhone"
       from platform_settings`,
  ))!;
}
