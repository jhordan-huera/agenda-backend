/**
 * `npm run push:keys`: crea el par de claves VAPID de los avisos en el celular (spec 013) y muestra las
 * dos líneas para copiarlas. Van en el backend de Vercel (Production), en la función de Lambda y en los
 * secretos de GitHub del cron (ver README, «Avisos en el celular»). No escribe nada en disco ni en git.
 *
 * Guárdalas en un lugar seguro, como TWO_FACTOR_KEY: si se pierden o se cambian, cada aparato tiene que
 * volver a activar los avisos. La pública no es secreta (la recibe el navegador); la privada, sí.
 */
import { generateVapidKeys } from "../src/services/web-push.ts";

const { publicKey, privateKey } = generateVapidKeys();
console.info(`VAPID_PUBLIC_KEY=${publicKey}`);
console.info(`VAPID_PRIVATE_KEY=${privateKey}`);
