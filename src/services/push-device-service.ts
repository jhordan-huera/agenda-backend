import { config } from "../config.ts";
import { one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import {
  AGENDA_PUSH_KINDS,
  MAX_PUSH_DEVICES,
  OWNER_PUSH_KINDS,
  PLATFORM_PUSH_KINDS,
  PUSH_KIND_LABELS,
  type MutablePushKind,
} from "../shared/lib/constants/push.ts";
import { getFullName } from "../shared/lib/format.ts";
import { describeUserAgent } from "../shared/lib/user-agent.ts";
import { pushDeviceSchema, pushEndpointBodySchema, pushKindsSchema } from "../shared/lib/validations/push.ts";
import type { AuditChange, PushConfig, PushDevice, PushKind } from "../shared/types/index.ts";
import { logAudit } from "./audit.ts";
import { parseInput, requireUser, superAdminNeedsTwoFactor, TWO_FACTOR_REQUIRED_MESSAGE, type AuditActor, type RequestContext } from "./context.ts";
import { isFreshDevice } from "./push-delivery.ts";
import { isAllowedPushEndpoint, isValidPushKeys, pushServiceName, sendWebPush } from "./web-push.ts";

/**
 * Los aparatos con avisos en el celular (spec 013, R3): uno por navegador, del usuario y con los tipos
 * que no quiere. Los tienen el propietario de un negocio activo, el super admin (con la verificación en
 * dos pasos, como el resto de /admin) y, desde la spec 017, el rol Profesional con una agenda activa en
 * un negocio activo, sólo para el resumen de las 8 de su agenda. Recepción y los administradores no
 * los tienen. El aparato se identifica por su dirección (`endpoint`), siempre en el cuerpo: nunca en la
 * URL ni en los registros.
 *
 * Auditoría: activar los avisos en un aparato, cambiar sus tipos, desactivarlos y el aviso de prueba
 * quedan en la actividad del negocio (el propietario y el profesional) o de la plataforma (el super
 * admin), con el navegador («Chrome en Mac»). La puesta al día silenciosa al abrir el panel, la
 * dirección renovada y la pausa al cerrar sesión no, porque no las hace la persona.
 */

const NOT_FOR_ROLE = "Los avisos en el celular son sólo para el propietario del negocio y los profesionales con su agenda.";
const NO_AGENDA =
  "Tu usuario no tiene una agenda asignada: los avisos en el celular son para el resumen de tu agenda. Pide al propietario que te la asigne en Profesionales.";
const UNAVAILABLE = "Los avisos en el celular todavía no están disponibles.";
const UNKNOWN_SERVICE = "Este navegador usa un servicio de avisos que no reconocemos. Prueba con Chrome, Safari, Edge o Firefox.";
const NOT_ACTIVE = "Este aparato no tiene los avisos activados. Vuelve a activarlos.";
/** Con un aparato recién activado, un 404 o 410 se reintenta una vez pasados estos milisegundos. */
const FRESH_RETRY_MS = 3_000;

/** El propietario, el rol Profesional con su agenda (spec 017) o el super admin. */
type PushRole = "owner" | "agenda" | "platform";

interface PushUser {
  userId: string;
  role: PushRole;
  kinds: readonly PushKind[];
  /** Dónde queda la auditoría: su negocio (el propietario y el profesional), o null (la plataforma) para el super admin. */
  businessId: string | null;
  actor: AuditActor;
}

/** Quién puede tener aparatos y qué tipos le corresponden. */
async function authorizePush(ctx: RequestContext): Promise<PushUser> {
  const user = requireUser(ctx);
  if (user.platformRole === "super_admin") {
    // La ruta ya responde `two_factor_required` (requireSuperAdminTwoFactor): ésta es la segunda barrera.
    if (superAdminNeedsTwoFactor(ctx)) throw new AppError("forbidden", TWO_FACTOR_REQUIRED_MESSAGE);
    return {
      userId: user.id,
      role: "platform",
      kinds: PLATFORM_PUSH_KINDS,
      businessId: null,
      actor: { userId: user.id, name: `${getFullName(user)} (Super admin)` },
    };
  }
  const actor = { userId: user.id, name: getFullName(user) };
  // El propietario de un negocio activo (el que reciba los avisos al enviarlos, ver push-delivery.ts).
  const owner = await one<{ id: string }>(pool, "select id from businesses where owner_id = $1 and status = 'active' order by created_at limit 1", [
    user.id,
  ]);
  if (owner) return { userId: user.id, role: "owner", kinds: OWNER_PUSH_KINDS, businessId: owner.id, actor };
  // El rol Profesional de un negocio activo, con su agenda activa (spec 017): sólo el resumen de las 8
  // de su agenda. Lo recibe quien tenga la agenda ese día y siga con este rol (`userOf`, push-delivery.ts).
  const member = await one<{ businessId: string; professionalId: string | null }>(
    pool,
    `select bu.business_id as "businessId",
            (select p.id from professionals p where p.business_id = bu.business_id and p.user_id = bu.user_id and p.is_active limit 1)
              as "professionalId"
       from business_users bu
       join businesses b on b.id = bu.business_id and b.status = 'active'
      where bu.user_id = $1 and bu.role = 'professional'
      order by bu.created_at
      limit 1`,
    [user.id],
  );
  if (!member) throw new AppError("forbidden", NOT_FOR_ROLE);
  if (!member.professionalId) throw new AppError("forbidden", NO_AGENDA);
  return { userId: user.id, role: "agenda", kinds: AGENDA_PUSH_KINDS, businessId: member.businessId, actor };
}

/** Qué dice el aviso de prueba y qué abre, según quién lo pide. */
const TEST_NOTICE: Record<PushRole, { body: string; url: string }> = {
  owner: { body: "Listo: aquí te avisaremos de las reservas.", url: "/dashboard" },
  agenda: { body: "Listo: aquí te avisaremos de las citas que quedan sin cerrar.", url: "/dashboard" },
  platform: { body: "Listo: aquí te avisaremos de lo importante de la plataforma.", url: "/admin" },
};

/** «Chrome en Mac», o «un aparato» si el navegador no se reconoce. */
function deviceLabel(userAgent: string | null): string {
  const label = describeUserAgent(userAgent);
  return label && label !== "Navegador desconocido" ? label : "un aparato";
}

/** Una entrada de la actividad sobre los avisos de esta persona. */
function logPushAudit(db: Db, who: PushUser, entry: { action: string; summary: string; changes?: AuditChange[] }): Promise<void> {
  return logAudit(db, { businessId: who.businessId, actor: who.actor, entityType: "user", entityId: who.userId, ...entry });
}

const kindLabel = (kind: PushKind) => PUSH_KIND_LABELS[kind as MutablePushKind]?.label ?? kind;

/** Las claves del servicio de avisos, o 503 si la API no las tiene. */
function requireWebPush() {
  if (!config.webPush) throw new AppError("unavailable", UNAVAILABLE);
  return config.webPush;
}

/** La dirección es de un servicio de avisos conocido (R4); si no, 400 con un mensaje claro. */
function assertAllowedEndpoint(endpoint: string): void {
  if (!isAllowedPushEndpoint(endpoint, { allowLocal: config.pushAllowsLocalEndpoints })) {
    throw new AppError("validation", UNKNOWN_SERVICE);
  }
}

/** Sólo los tipos del rol: un tipo de otro rol (o uno que se dejó de usar) no se guarda. */
const ownKinds = (kinds: readonly string[], role: readonly PushKind[]) => kinds.filter((kind): kind is PushKind => role.includes(kind as PushKind));

export const pushDeviceService = {
  /** GET /api/push/config: lo que necesita el front antes de activar. */
  async getConfig(ctx: RequestContext): Promise<PushConfig> {
    const { kinds } = await authorizePush(ctx);
    return { available: Boolean(config.webPush), publicKey: config.webPush?.publicKey ?? null, kinds: [...kinds] };
  },

  /**
   * PUT /api/push/device: activa o actualiza este aparato (al pulsar «Activar», al abrir el panel y
   * cuando el servicio renueva la dirección). Guarda la sesión actual y quita la pausa. Conserva los
   * tipos si el aparato era de esta persona; si era de otra, vuelven los de fábrica (todos encendidos).
   * Con `previousEndpoint` de esta persona, esa fila pasa a la dirección nueva. Hasta 10 aparatos: si
   * pasa, se quita el más antiguo.
   */
  async saveDevice(ctx: RequestContext, input: unknown, userAgent: string | null = null): Promise<PushDevice> {
    requireWebPush();
    const who = await authorizePush(ctx);
    const { userId, kinds } = who;
    const data = parseInput(pushDeviceSchema, input);
    assertAllowedEndpoint(data.endpoint);
    if (!isValidPushKeys(data.keys)) throw new AppError("validation", "Las claves de este navegador no son válidas. Vuelve a activar los avisos.");
    const p256dh = data.keys.p256dh.replace(/=+$/, "");
    const auth = data.keys.auth.replace(/=+$/, "");

    return transaction(async (db) => {
      let renewed = false;
      if (data.previousEndpoint && data.previousEndpoint !== data.endpoint) {
        // La dirección renovada: la fila anterior de esta persona pasa a la nueva, con sus tipos.
        const previous = await one<{ id: string }>(db, "select id from push_subscriptions where endpoint = $1 and user_id = $2 for update", [
          data.previousEndpoint,
          userId,
        ]);
        if (previous) {
          renewed = true;
          await db.query("delete from push_subscriptions where endpoint = $1 and id <> $2", [data.endpoint, previous.id]);
          await db.query(
            `update push_subscriptions
                set endpoint = $2, p256dh = $3, auth = $4, session_id = $5, signed_out_at = null, failures = 0, updated_at = now()
              where id = $1`,
            [previous.id, data.endpoint, p256dh, auth, ctx.sessionId],
          );
        }
      }
      // Activarlo de verdad (no la puesta al día de un aparato que ya era suyo): para la auditoría.
      const existing = renewed
        ? null
        : await one<{ userId: string }>(db, 'select user_id as "userId" from push_subscriptions where endpoint = $1', [data.endpoint]);
      const activated = !renewed && existing?.userId !== userId;
      const saved = (await one<{ id: string; mutedKinds: string[]; createdAt: string }>(
        db,
        `insert into push_subscriptions (user_id, session_id, endpoint, p256dh, auth)
         values ($1, $2, $3, $4, $5)
         on conflict (endpoint) do update
            set muted_kinds = case when push_subscriptions.user_id = excluded.user_id then push_subscriptions.muted_kinds else '{}' end,
                created_at = case when push_subscriptions.user_id = excluded.user_id then push_subscriptions.created_at else now() end,
                user_id = excluded.user_id, session_id = excluded.session_id, p256dh = excluded.p256dh, auth = excluded.auth,
                signed_out_at = null, failures = 0, updated_at = now()
         returning id, muted_kinds as "mutedKinds", created_at as "createdAt"`,
        [userId, ctx.sessionId, data.endpoint, p256dh, auth],
      ))!;
      // El undécimo aparato quita el más antiguo.
      const removed = await db.query(
        `delete from push_subscriptions
          where id in (select id from push_subscriptions where user_id = $1 and id <> $2 order by created_at desc offset $3)`,
        [userId, saved.id, MAX_PUSH_DEVICES - 1],
      );
      if (activated) {
        await logPushAudit(db, who, {
          action: "push.device_enabled",
          summary:
            `Activó los avisos en el celular en ${deviceLabel(userAgent)}` +
            ((removed.rowCount ?? 0) > 0 ? ` (se quitó el aparato más antiguo: son ${MAX_PUSH_DEVICES} como máximo)` : ""),
        });
      }
      return { mutedKinds: ownKinds(saved.mutedKinds, kinds), createdAt: saved.createdAt };
    });
  },

  /** PATCH /api/push/device: enciende o apaga tipos de este aparato (nunca el aviso de prueba). */
  async updateKinds(ctx: RequestContext, input: unknown, userAgent: string | null = null): Promise<Pick<PushDevice, "mutedKinds">> {
    const who = await authorizePush(ctx);
    const { userId, kinds } = who;
    const data = parseInput(pushKindsSchema, input);
    const foreign = data.mutedKinds.find((kind) => !kinds.includes(kind));
    if (foreign) throw new AppError("validation", "Ese tipo de aviso no es para tu cuenta.");
    return transaction(async (db) => {
      const before = await one<{ mutedKinds: string[] }>(
        db,
        'select muted_kinds as "mutedKinds" from push_subscriptions where endpoint = $1 and user_id = $2 for update',
        [data.endpoint, userId],
      );
      if (!before) throw new AppError("not_found", NOT_ACTIVE);
      const row = (await one<{ mutedKinds: string[] }>(
        db,
        `update push_subscriptions set muted_kinds = $3::text[], updated_at = now()
          where endpoint = $1 and user_id = $2
          returning muted_kinds as "mutedKinds"`,
        [data.endpoint, userId, [...new Set(data.mutedKinds)]],
      ))!;
      // Un interruptor por tipo que cambió: «Citas por cerrar: Encendido → Apagado».
      const state = (muted: readonly string[], kind: PushKind) => (muted.includes(kind) ? "Apagado" : "Encendido");
      const changes = kinds
        .filter((kind) => state(before.mutedKinds, kind) !== state(row.mutedKinds, kind))
        .map((kind) => ({ label: kindLabel(kind), before: state(before.mutedKinds, kind), after: state(row.mutedKinds, kind) }));
      if (changes.length > 0) {
        await logPushAudit(db, who, { action: "push.kinds_changed", summary: `Cambió qué avisos llegan a ${deviceLabel(userAgent)}`, changes });
      }
      return { mutedKinds: ownKinds(row.mutedKinds, kinds) };
    });
  },

  /** POST /api/push/device/off: «Desactivar en este celular». Sin error si ya no existía (doble toque). */
  async turnOff(ctx: RequestContext, input: unknown, userAgent: string | null = null): Promise<void> {
    const who = await authorizePush(ctx);
    const data = parseInput(pushEndpointBodySchema, input);
    await transaction(async (db) => {
      const deleted = await db.query("delete from push_subscriptions where endpoint = $1 and user_id = $2", [data.endpoint, who.userId]);
      if ((deleted.rowCount ?? 0) > 0) {
        await logPushAudit(db, who, { action: "push.device_disabled", summary: `Desactivó los avisos en el celular en ${deviceLabel(userAgent)}` });
      }
    });
  },

  /**
   * POST /api/push/device/test: el aviso de prueba, a este aparato, al momento y sin cola; espera la
   * respuesta del servicio de avisos (10 s como mucho). Si el servicio dice que el aparato ya no existe,
   * se borra y responde 409.
   */
  async sendTest(ctx: RequestContext, input: unknown, userAgent: string | null = null): Promise<{ sent: true }> {
    const vapid = requireWebPush();
    const who = await authorizePush(ctx);
    const { userId, role } = who;
    const data = parseInput(pushEndpointBodySchema, input);
    const device = await one<{ id: string; endpoint: string; p256dh: string; auth: string; savedAt: string }>(
      pool,
      `select id, endpoint, p256dh, auth, updated_at as "savedAt" from push_subscriptions where endpoint = $1 and user_id = $2`,
      [data.endpoint, userId],
    );
    if (!device) throw new AppError("not_found", NOT_ACTIVE);
    assertAllowedEndpoint(device.endpoint);
    const send = () =>
      sendWebPush(
        device,
        { title: "Avisos activados", ...TEST_NOTICE[role], tag: "prueba", kind: "test" },
        { vapid, ttlSeconds: 600, urgency: "high" },
      ).catch(() => null);
    let result = await send();
    // Recién activado (lo normal al pulsar «Activar»): Google a veces responde 410 en los primeros
    // segundos y después lo acepta. Se reintenta una vez y, si sigue igual, no se borra (ver FRESH_DEVICE_MS).
    const fresh = isFreshDevice(device.savedAt);
    if (result?.outcome === "gone" && fresh) {
      await new Promise((resolve) => setTimeout(resolve, FRESH_RETRY_MS));
      result = await send();
    }
    if (result?.outcome === "sent") {
      await pool.query("update push_subscriptions set failures = 0 where id = $1 and failures <> 0", [device.id]);
      await logPushAudit(pool, who, { action: "push.test_sent", summary: `Envió un aviso de prueba a ${deviceLabel(userAgent)}` });
      return { sent: true };
    }
    if (result?.outcome === "gone" && !fresh) {
      console.info(`[avisos] Aviso de prueba: el aparato ya no existe (${pushServiceName(device.endpoint)}, ${result.status}).`);
      await pool.query("delete from push_subscriptions where id = $1", [device.id]);
      throw new AppError("conflict", "Este aparato ya no recibe avisos. Vuelve a activarlos.");
    }
    console.warn(`[avisos] El aviso de prueba no salió (${pushServiceName(device.endpoint)}, ${result?.status ?? "error"}).`);
    throw new AppError("push_failed", "No pudimos enviar el aviso de prueba. Inténtalo de nuevo en un momento.");
  },
};

/**
 * «Cerrar sesión» pausa los aparatos activados desde esa sesión (R3): en una computadora compartida,
 * quien entra después no ve los avisos del propietario (ni los de otro profesional, spec 017). Al volver a entrar, la app los reanuda sola
 * (PUT /api/push/device). Que la sesión caduque no los pausa. Nunca impide cerrar la sesión.
 */
export async function pausePushDevices(sessionId: string): Promise<void> {
  try {
    await pool.query("update push_subscriptions set signed_out_at = now(), updated_at = now() where session_id = $1 and signed_out_at is null", [
      sessionId,
    ]);
  } catch (error) {
    console.error("[avisos] No se pudieron pausar los avisos al cerrar sesión:", (error as { code?: string })?.code ?? "error");
  }
}
