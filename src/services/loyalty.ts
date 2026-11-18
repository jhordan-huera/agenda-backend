import { randomInt } from "node:crypto";
import { isUuid, many, one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import {
  BENEFIT_KINDS,
  describeBenefit,
  formatRewardCode,
  levelOf,
  normalizeRewardCode,
  priceAfterReward,
  REWARD_CODE_ALPHABET,
  LOYALTY_NOT_ALLOWED_MESSAGE,
  STAMP_ICONS,
} from "../shared/lib/constants/loyalty.ts";
import { formatCurrency } from "../shared/lib/format.ts";
import { normalizePhone } from "../shared/lib/validations/fields.ts";
import { loyaltyBenefitSchema, loyaltyProgramSchema, loyaltyRedeemSchema } from "../shared/lib/validations/loyalty.ts";
import type {
  Appointment,
  AuditChange,
  ClientLoyalty,
  LoyaltyBenefit,
  LoyaltyMember,
  LoyaltyNext,
  LoyaltyProgram,
  LoyaltyReward,
  LoyaltyRewardStatus,
  LoyaltySummary,
} from "../shared/types/index.ts";
import { agendaScope, assertClientInScope } from "./agenda-scope.ts";
import { appointmentClientIds } from "./appointment-clients.ts";
import { logAudit } from "./audit.ts";
import { authorize, parseInput, type Actor, type RequestContext } from "./context.ts";

/*
 * Tarjeta de fidelización (spec 052). Cada cita que pasa a Atendida suma un sello a cada paciente de la cita (con la
 * tarjeta encendida); al llegar a las citas de un beneficio activo se desbloquea su recompensa, con la copia del
 * beneficio y un código. Si el propietario corrige la cita, el sello se anula y las recompensas sin canjear que ya no
 * alcanza, también. Los sellos y el desbloqueo corren dentro de la transacción del cambio de estado, con el negocio
 * bloqueado; las claves únicas de la 059 son la segunda barrera contra los duplicados.
 */

const DEFAULT_PROGRAM: LoyaltyProgram = {
  enabled: false,
  enabledAt: null,
  name: "Club de pacientes",
  description: "",
  stampIcon: "star",
  afterLast: "keep",
};

const PROGRAM_COLUMNS = `enabled_at is not null as enabled, enabled_at as "enabledAt", name, description,
  stamp_icon as "stampIcon", after_last as "afterLast"`;

const NOT_FOUND = "Ese beneficio ya no existe.";
const REWARD_NOT_FOUND = "Esa recompensa ya no existe.";
const VOIDED_BY_CORRECTION = "Se corrigió una cita atendida";

async function programOf(db: Db, businessId: string): Promise<LoyaltyProgram> {
  return (await one<LoyaltyProgram>(db, `select ${PROGRAM_COLUMNS} from loyalty_programs where business_id = $1`, [businessId])) ?? DEFAULT_PROGRAM;
}

/* ------------------------------------------------------------------ Beneficios -- */

const BENEFIT_COLUMNS = `b.id, b.name, b.description, b.visits_required as "visitsRequired", b.kind, b.value::float8 as value,
  b.service_id as "serviceId", s.name as "serviceName", b.conditions, b.valid_days as "validDays", b.is_active as "isActive",
  (select count(*) from loyalty_rewards r where r.benefit_id = b.id)::int as "timesWon"`;

async function benefitsOf(db: Db, businessId: string, onlyActive = false): Promise<LoyaltyBenefit[]> {
  return many<LoyaltyBenefit>(
    db,
    `select ${BENEFIT_COLUMNS}
       from loyalty_benefits b left join services s on s.id = b.service_id
      where b.business_id = $1 and b.archived_at is null ${onlyActive ? "and b.is_active" : ""}
      order by b.visits_required, b.created_at`,
    [businessId],
  );
}

/** Un beneficio activo, sin contar cuántas veces se ganó (lo que necesitan el desbloqueo y el próximo premio). */
type ActiveBenefit = Omit<LoyaltyBenefit, "timesWon" | "isActive">;

/**
 * Los beneficios activos de menos a más citas, en una consulta liviana: la usan el desbloqueo (en cada cita que pasa a
 * Atendida) y el próximo premio, así que no cuenta las recompensas de cada uno como la lista del panel.
 */
async function activeBenefits(db: Db, businessId: string): Promise<ActiveBenefit[]> {
  return many<ActiveBenefit>(
    db,
    `select b.id, b.name, b.description, b.visits_required as "visitsRequired", b.kind, b.value::float8 as value,
            b.service_id as "serviceId", s.name as "serviceName", b.conditions, b.valid_days as "validDays"
       from loyalty_benefits b left join services s on s.id = b.service_id
      where b.business_id = $1 and b.archived_at is null and b.is_active
      order by b.visits_required`,
    [businessId],
  );
}

const kindLabel = (kind: string) => BENEFIT_KINDS.find((item) => item.value === kind)?.label ?? kind;

function benefitChanges(before: LoyaltyBenefit | null, after: LoyaltyBenefit): AuditChange[] {
  const describe = (benefit: LoyaltyBenefit) => describeBenefit(benefit.kind, benefit.value, benefit.serviceName);
  const rows: [string, string | null, string][] = [
    ["Nombre", before?.name ?? null, after.name],
    ["Citas", before ? String(before.visitsRequired) : null, String(after.visitsRequired)],
    ["Tipo", before ? `${kindLabel(before.kind)}: ${describe(before)}` : null, `${kindLabel(after.kind)}: ${describe(after)}`],
    ["Vence", before ? (before.validDays ? `A los ${before.validDays} días` : "No vence") : null, after.validDays ? `A los ${after.validDays} días` : "No vence"],
    ["Activo", before ? (before.isActive ? "Sí" : "No") : null, after.isActive ? "Sí" : "No"],
  ];
  const changes: AuditChange[] = rows.filter(([, from, to]) => from !== to).map(([label, from, to]) => ({ label, before: from, after: to }));
  if (before && (before.description !== after.description || before.conditions !== after.conditions)) {
    changes.push({ label: "Descripción o condiciones", before: null, after: null });
  }
  return changes;
}

/** El servicio de «Servicio gratis» tiene que ser del negocio. */
async function assertServiceOf(db: Db, businessId: string, serviceId: string | null): Promise<void> {
  if (!serviceId) return;
  const found = isUuid(serviceId) ? await one(db, "select 1 from services where id = $1 and business_id = $2", [serviceId, businessId]) : null;
  if (!found) throw new AppError("validation", "Elige un servicio de tu negocio.");
}

/** Dos beneficios activos con las mismas citas: el índice único de la 059, como un error que se entiende. */
async function saveBenefit<T>(visitsRequired: number, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if ((error as { code?: string; constraint?: string }).constraint === "loyalty_benefits_visits_key") {
      throw new AppError("conflict", `Ya hay un beneficio activo a las ${visitsRequired} citas: cambia las citas o desactiva el otro.`);
    }
    throw error;
  }
}

/* ------------------------------------------------------------- Sellos y premios -- */

/** Una recompensa recién desbloqueada, con lo que necesita su email. */
export interface UnlockedReward {
  clientId: string;
  name: string;
  description: string;
  conditions: string;
  code: string;
  expiresAt: string | null;
}

function newCode(): string {
  return Array.from({ length: 6 }, () => REWARD_CODE_ALPHABET[randomInt(REWARD_CODE_ALPHABET.length)]).join("");
}

/** La tarjeta del paciente (se crea al primer sello), bloqueada hasta el final de la transacción. */
async function cardOf(db: Db, businessId: string, clientId: string): Promise<number> {
  await db.query(
    "insert into loyalty_cards (client_id, business_id) values ($1, $2) on conflict (client_id) do nothing",
    [clientId, businessId],
  );
  return (await one<{ cardNumber: number }>(db, `select card_number as "cardNumber" from loyalty_cards where client_id = $1 for update`, [clientId]))!
    .cardNumber;
}

const stampsIn = async (db: Db, clientId: string, cardNumber: number) =>
  (await one<{ count: number }>(
    db,
    "select count(*)::int as count from loyalty_stamps where client_id = $1 and card_number = $2 and voided_at is null",
    [clientId, cardNumber],
  ))!.count;

/**
 * Desbloquea las recompensas de los beneficios activos que alcanza el paciente en su tarjeta actual (cada beneficio,
 * una vez por tarjeta) y, con «Empezar una tarjeta nueva», pasa a la siguiente al ganar el último. Con la tarjeta
 * apagada, nada.
 */
async function unlock(
  db: Db,
  businessId: string,
  clientId: string,
  program: LoyaltyProgram,
  benefits: ActiveBenefit[],
): Promise<UnlockedReward[]> {
  if (!program.enabled || benefits.length === 0) return [];
  const cardNumber = await cardOf(db, businessId, clientId);
  const stamps = await stampsIn(db, clientId, cardNumber);
  const reachable = benefits.filter((benefit) => benefit.visitsRequired <= stamps);
  const unlocked: UnlockedReward[] = [];
  // Lo ya ganado en esta tarjeta, en una sola consulta.
  const won = new Set(
    reachable.length === 0
      ? []
      : (
          await many<{ benefitId: string }>(
            db,
            `select benefit_id as "benefitId" from loyalty_rewards where client_id = $1 and card_number = $2`,
            [clientId, cardNumber],
          )
        ).map((row) => row.benefitId),
  );
  const pending = reachable.filter((benefit) => !won.has(benefit.id));
  const timezone =
    pending.length === 0
      ? ""
      : (await one<{ timezone: string }>(db, "select timezone from businesses where id = $1", [businessId]))!.timezone;
  for (const benefit of pending) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const row = await one<UnlockedReward>(
        db,
        `insert into loyalty_rewards
           (business_id, client_id, benefit_id, card_number, name, description, kind, value, service_id, service_name,
            conditions, visits_required, code, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10, ''), $11, $12, $13,
                 case when $14::int is null then null else now() + make_interval(days => $14::int) end)
         on conflict do nothing
         returning client_id as "clientId", name, description, conditions, code,
                   to_char((expires_at at time zone $15)::date, 'YYYY-MM-DD') as "expiresAt"`,
        [
          businessId,
          clientId,
          benefit.id,
          cardNumber,
          benefit.name,
          benefit.description,
          benefit.kind,
          benefit.value,
          benefit.serviceId,
          benefit.serviceName,
          benefit.conditions,
          benefit.visitsRequired,
          newCode(),
          benefit.validDays,
          timezone,
        ],
      );
      if (row) {
        unlocked.push({ ...row, code: formatRewardCode(row.code) });
        break;
      }
      // Sin fila: el código ya lo tenía otra recompensa del negocio (la tarjeta está bloqueada, así que no es un
      // duplicado del mismo premio). Otro código.
    }
  }
  if (program.afterLast === "restart") {
    const last = benefits.at(-1);
    if (last && stamps >= last.visitsRequired) {
      await db.query("update loyalty_cards set card_number = card_number + 1 where client_id = $1 and card_number = $2", [clientId, cardNumber]);
    }
  }
  return unlocked;
}

/**
 * Lo llama cada camino que cambia el estado de una cita, dentro de su transacción (spec 052, decisión 2 del plan):
 * - **pasa a Atendida:** un sello a cada paciente activo de la cita y el desbloqueo;
 * - **deja de estar Atendida** (la corrección del propietario): anula esos sellos y las recompensas sin canjear que ya
 *   no alcanza.
 *
 * Devuelve las recompensas nuevas (para su email).
 */
export async function onAppointmentStatus(
  db: Db,
  before: Pick<Appointment, "status"> | null,
  after: Appointment,
  actor: Pick<Actor, "userId"> | null,
): Promise<UnlockedReward[]> {
  const was = before?.status === "completed";
  const is = after.status === "completed";
  if (was === is) return [];
  if (!is) {
    const voided = await many<{ clientId: string; cardNumber: number }>(
      db,
      `update loyalty_stamps set voided_at = now(), voided_by = $2
        where appointment_id = $1 and voided_at is null
        returning client_id as "clientId", card_number as "cardNumber"`,
      [after.id, actor?.userId ?? null],
    );
    for (const { clientId, cardNumber } of voided) {
      const stamps = await stampsIn(db, clientId, cardNumber);
      await db.query(
        `update loyalty_rewards set status = 'voided', voided_at = now(), voided_reason = $4
          where client_id = $1 and card_number = $2 and status = 'available' and visits_required > $3`,
        [clientId, cardNumber, stamps, VOIDED_BY_CORRECTION],
      );
    }
    return [];
  }
  const program = await programOf(db, after.businessId);
  if (!program.enabled) return [];
  const benefits = await activeBenefits(db, after.businessId);
  const clientIds = (
    await many<{ id: string }>(db, "select id from clients where id = any($1::uuid[]) and business_id = $2 and is_active", [
      appointmentClientIds(after),
      after.businessId,
    ])
  ).map((row) => row.id);
  const unlocked: UnlockedReward[] = [];
  for (const clientId of clientIds) {
    const cardNumber = await cardOf(db, after.businessId, clientId);
    // Una cita da un sello por paciente: si ya lo tenía (vigente), nada; si se había anulado, vuelve a contar.
    const stamped = await one(
      db,
      `insert into loyalty_stamps (appointment_id, client_id, business_id, card_number) values ($1, $2, $3, $4)
       on conflict (appointment_id, client_id) do update
         set voided_at = null, voided_by = null, counted_at = now(), card_number = excluded.card_number
         where loyalty_stamps.voided_at is not null
       returning 1`,
      [after.id, clientId, after.businessId, cardNumber],
    );
    if (stamped) unlocked.push(...(await unlock(db, after.businessId, clientId, program, benefits)));
  }
  return unlocked;
}

/**
 * Al guardar un beneficio: lo que ya alcanzaban los pacientes se desbloquea (sin email). Una sola consulta encuentra
 * las tarjetas a las que les falta algún premio que ya alcanzan; sólo esas se revisan (no todas las del negocio).
 */
async function unlockAll(db: Db, businessId: string): Promise<void> {
  const program = await programOf(db, businessId);
  if (!program.enabled) return;
  const benefits = await activeBenefits(db, businessId);
  if (benefits.length === 0) return;
  const candidates = await many<{ clientId: string }>(
    db,
    `with current_cards as (
       select k.client_id, k.card_number, count(s.client_id)::int as stamps
         from loyalty_cards k
         join clients c on c.id = k.client_id and c.is_active
         left join loyalty_stamps s on s.client_id = k.client_id and s.card_number = k.card_number and s.voided_at is null
        where k.business_id = $1
        group by k.client_id, k.card_number
     )
     select cc.client_id as "clientId" from current_cards cc
      where exists (
        select 1 from loyalty_benefits b
         where b.business_id = $1 and b.archived_at is null and b.is_active and b.visits_required <= cc.stamps
           and not exists (select 1 from loyalty_rewards r where r.client_id = cc.client_id and r.benefit_id = b.id and r.card_number = cc.card_number))
      order by cc.client_id`,
    [businessId],
  );
  for (const { clientId } of candidates) await unlock(db, businessId, clientId, program, benefits);
}

/**
 * «Unir a la ficha» de una reserva por verificar (spec 009): la tarjeta, los sellos y las recompensas del paciente que
 * desaparece pasan a la ficha que queda (lo que se repite, se descarta con él), y se revisa el desbloqueo.
 */
export async function mergeLoyalty(db: Db, businessId: string, fromClientId: string, toClientId: string): Promise<void> {
  await db.query(
    `update loyalty_stamps s set client_id = $2 where s.client_id = $1
        and not exists (select 1 from loyalty_stamps o where o.appointment_id = s.appointment_id and o.client_id = $2)`,
    [fromClientId, toClientId],
  );
  await db.query(
    `update loyalty_rewards r set client_id = $2 where r.client_id = $1
        and not exists (select 1 from loyalty_rewards o where o.client_id = $2 and o.benefit_id = r.benefit_id and o.card_number = r.card_number)`,
    [fromClientId, toClientId],
  );
  const from = await one<{ cardNumber: number; accountId: string | null; linkedAt: string | null; linkedBy: string | null }>(
    db,
    `select card_number as "cardNumber", patient_account_id as "accountId", linked_at as "linkedAt", linked_by as "linkedBy"
       from loyalty_cards where client_id = $1`,
    [fromClientId],
  );
  if (from) {
    await db.query("delete from loyalty_cards where client_id = $1", [fromClientId]);
    await db.query(
      `insert into loyalty_cards (client_id, business_id, card_number, patient_account_id, linked_at, linked_by)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (client_id) do update
         set card_number = greatest(loyalty_cards.card_number, excluded.card_number),
             patient_account_id = coalesce(loyalty_cards.patient_account_id, excluded.patient_account_id),
             linked_at = case when loyalty_cards.patient_account_id is null then excluded.linked_at else loyalty_cards.linked_at end,
             linked_by = case when loyalty_cards.patient_account_id is null then excluded.linked_by else loyalty_cards.linked_by end`,
      [toClientId, businessId, from.cardNumber, from.accountId, from.linkedAt, from.linkedBy],
    );
  }
  await unlock(db, businessId, toClientId, await programOf(db, businessId), await activeBenefits(db, businessId));
}

/* ---------------------------------------------------- Lo que ve el equipo -- */

const REWARD_STATUS_SQL = `case when r.status = 'available' and r.expires_at is not null and r.expires_at <= now() then 'expired' else r.status end`;

const REWARD_COLUMNS = `r.id, r.client_id as "clientId", c.name as "clientName", r.benefit_id as "benefitId", r.card_number as "cardNumber",
  r.name, r.description, r.kind, r.value::float8 as value, r.service_name as "serviceName", r.conditions,
  r.visits_required as "visitsRequired", r.code, r.unlocked_at as "unlockedAt", r.expires_at as "expiresAt",
  ${REWARD_STATUS_SQL} as status, r.redeemed_at as "redeemedAt",
  case when u.id is null then null else u.first_name || ' ' || u.last_name end as "redeemedByName",
  r.redeemed_appointment_id as "redeemedAppointmentId", r.voided_at as "voidedAt", r.voided_reason as "voidedReason"`;

const withCode = (reward: LoyaltyReward): LoyaltyReward => ({ ...reward, code: formatRewardCode(reward.code) });

function nextOf(benefits: ActiveBenefit[], stamps: number): LoyaltyNext | null {
  const next = benefits.find((benefit) => benefit.visitsRequired > stamps);
  return next ? { benefitId: next.id, name: next.name, visitsRequired: next.visitsRequired, missing: next.visitsRequired - stamps } : null;
}

type MemberRow = Omit<LoyaltyMember, "level" | "next">;

/**
 * Las tarjetas del negocio (o de esos pacientes) con sus sellos y sus premios disponibles. Los conteos se agrupan una
 * vez por tabla (no una subconsulta por cada tarjeta): «Pacientes» de un negocio grande sigue siendo una consulta.
 */
async function membersOf(db: Db, businessId: string, clientIds: string[] | null): Promise<LoyaltyMember[]> {
  const rows = await many<MemberRow>(
    db,
    `with cards as (
       select k.client_id, k.card_number, k.patient_account_id from loyalty_cards k
        where k.business_id = $1 and ($2::uuid[] is null or k.client_id = any($2::uuid[]))
     ),
     stamped as (
       select s.client_id, count(*) filter (where s.card_number = cards.card_number)::int as stamps, count(*)::int as total
         from loyalty_stamps s join cards on cards.client_id = s.client_id
        where s.voided_at is null
        group by s.client_id
     ),
     available as (
       select r.client_id, count(*)::int as count
         from loyalty_rewards r join cards on cards.client_id = r.client_id
        where r.status = 'available' and (r.expires_at is null or r.expires_at > now())
        group by r.client_id
     )
     select cards.client_id as "clientId", c.name as "clientName", c.phone as "clientPhone", cards.card_number as "cardNumber",
            coalesce(stamped.stamps, 0) as stamps, coalesce(stamped.total, 0) as "totalStamps",
            coalesce(available.count, 0) as "availableRewards", cards.patient_account_id is not null as "hasAccount"
       from cards join clients c on c.id = cards.client_id
       left join stamped on stamped.client_id = cards.client_id
       left join available on available.client_id = cards.client_id`,
    [businessId, clientIds],
  );
  const benefits = rows.length === 0 ? [] : await activeBenefits(db, businessId);
  return rows.map((row) => ({ ...row, level: levelOf(row.cardNumber), next: nextOf(benefits, row.stamps) }));
}

/** El progreso de la tarjeta de cada paciente, para el email de seguimiento (null: la tarjeta está apagada). */
export async function loyaltyProgressFor(
  db: Db,
  businessId: string,
  clientIds: string[],
): Promise<Map<string, { programName: string; stamps: number; next: { name: string; missing: number } | null }>> {
  const progress = new Map<string, { programName: string; stamps: number; next: { name: string; missing: number } | null }>();
  const program = await programOf(db, businessId);
  if (!program.enabled || clientIds.length === 0) return progress;
  for (const member of await membersOf(db, businessId, clientIds)) {
    progress.set(member.clientId, {
      programName: program.name,
      stamps: member.stamps,
      next: member.next ? { name: member.next.name, missing: member.next.missing } : null,
    });
  }
  return progress;
}

function programChanges(before: LoyaltyProgram, after: LoyaltyProgram): AuditChange[] {
  const icon = (value: string) => STAMP_ICONS.find((item) => item.value === value)?.label ?? value;
  const ending = (value: string) => (value === "restart" ? "Empezar una tarjeta nueva" : "Seguir sumando");
  const rows: [string, string, string][] = [
    ["Encendida", before.enabled ? "Sí" : "No", after.enabled ? "Sí" : "No"],
    ["Nombre", before.name, after.name],
    ["Sello", icon(before.stampIcon), icon(after.stampIcon)],
    ["Al llegar al último beneficio", ending(before.afterLast), ending(after.afterLast)],
  ];
  const changes: AuditChange[] = rows.filter(([, from, to]) => from !== to).map(([label, from, to]) => ({ label, before: from, after: to }));
  if (before.description !== after.description) changes.push({ label: "Descripción", before: null, after: null });
  return changes;
}

/**
 * La tarjeta sólo en los negocios que habilitó el super admin (migración 060). La ficha (su bloque y canjear lo ya
 * ganado) no pasa por aquí: después de quitarla, lo ganado se puede canjear.
 */
export async function assertLoyaltyAllowed(db: Db, businessId: string): Promise<void> {
  const row = await one<{ allowed: boolean }>(db, "select loyalty_allowed as allowed from businesses where id = $1", [businessId]);
  if (!row?.allowed) throw new AppError("forbidden", LOYALTY_NOT_ALLOWED_MESSAGE);
}

export const loyaltyService = {
  /** «Fidelización»: el programa (apagado y con los valores de siempre si nunca se guardó). */
  async program(ctx: RequestContext, businessId: string): Promise<LoyaltyProgram> {
    await authorize(pool, ctx, businessId, "loyalty.manage");
    await assertLoyaltyAllowed(pool, businessId);
    return programOf(pool, businessId);
  },

  async saveProgram(ctx: RequestContext, businessId: string, input: unknown): Promise<LoyaltyProgram> {
    const data = parseInput(loyaltyProgramSchema, input);
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "loyalty.manage", { lock: true });
      await assertLoyaltyAllowed(db, businessId);
      const before = await programOf(db, businessId);
      const after = (await one<LoyaltyProgram>(
        db,
        `insert into loyalty_programs (business_id, enabled_at, name, description, stamp_icon, after_last)
         values ($1, case when $2::boolean then now() end, $3, $4, $5, $6)
         on conflict (business_id) do update
           set enabled_at = case when not $2::boolean then null else coalesce(loyalty_programs.enabled_at, now()) end,
               name = excluded.name, description = excluded.description, stamp_icon = excluded.stamp_icon,
               after_last = excluded.after_last, updated_at = now()
         returning ${PROGRAM_COLUMNS}`,
        [businessId, data.enabled, data.name, data.description, data.stampIcon, data.afterLast],
      ))!;
      const changes = programChanges(before, after);
      if (changes.length > 0) {
        await logAudit(db, {
          businessId,
          actor,
          action: "loyalty.program_updated",
          entityType: "loyalty",
          entityId: businessId,
          summary:
            after.enabled && !before.enabled
              ? `Encendió la tarjeta de fidelización «${after.name}»`
              : !after.enabled && before.enabled
                ? `Apagó la tarjeta de fidelización «${after.name}»`
                : `Cambió la tarjeta de fidelización «${after.name}»`,
          changes,
        });
      }
      return after;
    });
  },

  async benefits(ctx: RequestContext, businessId: string): Promise<LoyaltyBenefit[]> {
    await authorize(pool, ctx, businessId, "loyalty.manage");
    await assertLoyaltyAllowed(pool, businessId);
    return benefitsOf(pool, businessId);
  },

  async createBenefit(ctx: RequestContext, businessId: string, input: unknown): Promise<LoyaltyBenefit> {
    const data = parseInput(loyaltyBenefitSchema, input);
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "loyalty.manage", { lock: true });
      await assertLoyaltyAllowed(db, businessId);
      await assertServiceOf(db, businessId, data.serviceId);
      const { id } = await saveBenefit(data.visitsRequired, async () =>
        (await one<{ id: string }>(
          db,
          `insert into loyalty_benefits (business_id, name, description, visits_required, kind, value, service_id, conditions, valid_days, is_active)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
          [businessId, data.name, data.description, data.visitsRequired, data.kind, data.value, data.serviceId, data.conditions, data.validDays, data.isActive],
        ))!,
      );
      const benefit = (await benefitsOf(db, businessId)).find((item) => item.id === id)!;
      await logAudit(db, {
        businessId,
        actor,
        action: "loyalty.benefit_created",
        entityType: "loyalty",
        entityId: id,
        summary: `Creó el beneficio «${benefit.name}» de la tarjeta de fidelización (${benefit.visitsRequired} citas)`,
        changes: benefitChanges(null, benefit),
      });
      await unlockAll(db, businessId);
      return benefit;
    });
  },

  async updateBenefit(ctx: RequestContext, businessId: string, benefitId: string, input: unknown): Promise<LoyaltyBenefit> {
    const data = parseInput(loyaltyBenefitSchema, input);
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "loyalty.manage", { lock: true });
      await assertLoyaltyAllowed(db, businessId);
      const before = isUuid(benefitId) ? (await benefitsOf(db, businessId)).find((item) => item.id === benefitId) : undefined;
      if (!before) throw new AppError("not_found", NOT_FOUND);
      await assertServiceOf(db, businessId, data.serviceId);
      await saveBenefit(data.visitsRequired, () =>
        db.query(
          `update loyalty_benefits
              set name = $3, description = $4, visits_required = $5, kind = $6, value = $7, service_id = $8, conditions = $9,
                  valid_days = $10, is_active = $11, updated_at = now()
            where id = $1 and business_id = $2`,
          [benefitId, businessId, data.name, data.description, data.visitsRequired, data.kind, data.value, data.serviceId, data.conditions, data.validDays, data.isActive],
        ),
      );
      const after = (await benefitsOf(db, businessId)).find((item) => item.id === benefitId)!;
      const changes = benefitChanges(before, after);
      if (changes.length > 0) {
        await logAudit(db, {
          businessId,
          actor,
          action: "loyalty.benefit_updated",
          entityType: "loyalty",
          entityId: benefitId,
          summary: `Cambió el beneficio «${after.name}» de la tarjeta de fidelización`,
          changes,
        });
      }
      await unlockAll(db, businessId);
      return after;
    });
  },

  /** «Eliminar»: lo borra si nadie lo ganó; si alguien lo ganó, lo archiva y sus recompensas se conservan. */
  async deleteBenefit(ctx: RequestContext, businessId: string, benefitId: string): Promise<{ archived: boolean }> {
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "loyalty.manage", { lock: true });
      await assertLoyaltyAllowed(db, businessId);
      const benefit = isUuid(benefitId) ? (await benefitsOf(db, businessId)).find((item) => item.id === benefitId) : undefined;
      if (!benefit) throw new AppError("not_found", NOT_FOUND);
      const archived = benefit.timesWon > 0;
      if (archived) {
        await db.query("update loyalty_benefits set archived_at = now(), is_active = false, updated_at = now() where id = $1", [benefitId]);
      } else {
        await db.query("delete from loyalty_benefits where id = $1", [benefitId]);
      }
      await logAudit(db, {
        businessId,
        actor,
        action: archived ? "loyalty.benefit_archived" : "loyalty.benefit_deleted",
        entityType: "loyalty",
        entityId: benefitId,
        summary: archived
          ? `Archivó el beneficio «${benefit.name}» de la tarjeta de fidelización (ya lo ganaron ${benefit.timesWon === 1 ? "1 vez" : `${benefit.timesWon} veces`})`
          : `Eliminó el beneficio «${benefit.name}» de la tarjeta de fidelización`,
      });
      return { archived };
    });
  },

  /** El bloque de la ficha: el programa, la tarjeta del paciente y todas sus recompensas. */
  async clientLoyalty(ctx: RequestContext, businessId: string, clientId: string): Promise<ClientLoyalty> {
    const actor = await authorize(pool, ctx, businessId);
    const client = isUuid(clientId)
      ? await one<{ phone: string }>(pool, "select coalesce(phone, '') as phone from clients where id = $1 and business_id = $2", [clientId, businessId])
      : null;
    if (!client) throw new AppError("not_found", "Cliente no encontrado.");
    await assertClientInScope(pool, await agendaScope(pool, actor, businessId), clientId);
    const phone = normalizePhone(client.phone);
    const [program, [card = null], rewards, byPhone] = await Promise.all([
      programOf(pool, businessId),
      membersOf(pool, businessId, [clientId]),
      many<LoyaltyReward>(
        pool,
        `select ${REWARD_COLUMNS} from loyalty_rewards r join clients c on c.id = r.client_id left join users u on u.id = r.redeemed_by
          where r.business_id = $1 and r.client_id = $2 order by r.unlocked_at desc`,
        [businessId, clientId],
      ),
      // La cuenta con el teléfono de la ficha (índice único): si existe y si ya está unida a otra ficha de aquí.
      phone
        ? one<{ linkedHere: boolean }>(
            pool,
            `select exists (select 1 from loyalty_cards k where k.business_id = $2 and k.patient_account_id = a.id) as "linkedHere"
               from patient_accounts a where a.phone = $1`,
            [phone, businessId],
          )
        : null,
    ]);
    const account: ClientLoyalty["account"] = card?.hasAccount ? "linked" : !byPhone ? "none" : byPhone.linkedHere ? "elsewhere" : "pending";
    return { program, card, rewards: rewards.map(withCode), account };
  },

  /** «Pacientes» de Fidelización: los de menos citas por faltar primero. */
  async members(ctx: RequestContext, businessId: string): Promise<LoyaltyMember[]> {
    await authorize(pool, ctx, businessId, "loyalty.manage");
    await assertLoyaltyAllowed(pool, businessId);
    const members = await membersOf(pool, businessId, null);
    return members
      .filter((member) => member.totalStamps > 0 || member.hasAccount)
      .sort(
        (a, b) =>
          (a.next?.missing ?? Number.MAX_SAFE_INTEGER) - (b.next?.missing ?? Number.MAX_SAFE_INTEGER) ||
          b.stamps - a.stamps ||
          a.clientName.localeCompare(b.clientName, "es"),
      );
  },

  /** «Recompensas» de Fidelización, con filtros; `code` busca una para canjearla. */
  async rewards(
    ctx: RequestContext,
    businessId: string,
    query: { clientId?: string; benefitId?: string; status?: string; code?: string },
  ): Promise<LoyaltyReward[]> {
    await authorize(pool, ctx, businessId, "loyalty.manage");
    await assertLoyaltyAllowed(pool, businessId);
    const statuses: LoyaltyRewardStatus[] = ["available", "redeemed", "expired", "voided"];
    const status = statuses.includes(query.status as LoyaltyRewardStatus) ? query.status : null;
    const code = query.code ? normalizeRewardCode(query.code) : null;
    const rewards = await many<LoyaltyReward>(
      pool,
      `select ${REWARD_COLUMNS} from loyalty_rewards r join clients c on c.id = r.client_id left join users u on u.id = r.redeemed_by
        where r.business_id = $1
          and ($2::uuid is null or r.client_id = $2::uuid)
          and ($3::uuid is null or r.benefit_id = $3::uuid)
          and ($4::text is null or ${REWARD_STATUS_SQL} = $4::text)
          and ($5::text is null or r.code = $5::text)
        order by r.unlocked_at desc
        limit 500`,
      [businessId, isUuid(query.clientId) ? query.clientId : null, isUuid(query.benefitId) ? query.benefitId : null, status, code || null],
    );
    return rewards.map(withCode);
  },

  async summary(ctx: RequestContext, businessId: string): Promise<LoyaltySummary> {
    await authorize(pool, ctx, businessId, "loyalty.manage");
    await assertLoyaltyAllowed(pool, businessId);
    return (await one<LoyaltySummary>(
      pool,
      `select (select count(distinct s.client_id) from loyalty_stamps s where s.business_id = $1 and s.voided_at is null)::int as participants,
              (select count(*) from loyalty_stamps s where s.business_id = $1 and s.voided_at is null)::int as stamps,
              count(*) filter (where ${REWARD_STATUS_SQL} = 'available')::int as available,
              count(*) filter (where r.status = 'redeemed')::int as redeemed,
              count(*) filter (where ${REWARD_STATUS_SQL} = 'expired')::int as expired
         from loyalty_rewards r where r.business_id = $1`,
      [businessId],
    ))!;
  },

  /**
   * «Canjear»: una sola vez, sólo si está disponible. En una cita del paciente que no está pagada, su precio baja
   * según el beneficio (nunca de $0), y el cambio queda en la actividad junto al canje.
   */
  async redeem(ctx: RequestContext, businessId: string, rewardId: string, input: unknown): Promise<LoyaltyReward> {
    const { appointmentId } = parseInput(loyaltyRedeemSchema, input ?? {});
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "loyalty.redeem", { lock: true });
      const reward = isUuid(rewardId)
        ? await one<LoyaltyReward>(
            db,
            `select ${REWARD_COLUMNS} from loyalty_rewards r join clients c on c.id = r.client_id left join users u on u.id = r.redeemed_by
              where r.id = $1 and r.business_id = $2 for update of r`,
            [rewardId, businessId],
          )
        : null;
      if (!reward) throw new AppError("not_found", REWARD_NOT_FOUND);
      await assertClientInScope(db, await agendaScope(db, actor, businessId), reward.clientId);
      if (reward.status === "redeemed") throw new AppError("conflict", "Esta recompensa ya se canjeó.");
      if (reward.status === "voided") throw new AppError("conflict", "Esta recompensa se anuló: no se puede canjear.");
      if (reward.status === "expired") throw new AppError("conflict", "Esta recompensa venció: no se puede canjear.");

      let appointment: { id: string; price: number; paidAt: string | null; date: string } | null = null;
      if (appointmentId) {
        appointment = isUuid(appointmentId)
          ? await one(
              db,
              `select a.id, a.price::float8 as price, a.paid_at as "paidAt", to_char(a.date, 'YYYY-MM-DD') as date
                 from appointments a
                where a.id = $1 and a.business_id = $2 and a.status <> 'cancelled'
                  and (a.client_id = $3 or exists (select 1 from appointment_clients ac where ac.appointment_id = a.id and ac.client_id = $3))
                for update of a`,
              [appointmentId, businessId, reward.clientId],
            )
          : null;
        if (!appointment) throw new AppError("validation", "Elige una cita de este paciente.");
      }
      const done = await one(
        db,
        `update loyalty_rewards set status = 'redeemed', redeemed_at = now(), redeemed_by = $2, redeemed_appointment_id = $3
          where id = $1 and status = 'available' and (expires_at is null or expires_at > now()) returning 1`,
        [reward.id, actor.userId, appointment?.id ?? null],
      );
      if (!done) throw new AppError("conflict", "Esta recompensa ya no está disponible.");

      const changes: AuditChange[] = [];
      if (appointment && appointment.paidAt === null) {
        const price = priceAfterReward(appointment.price, reward.kind, reward.value);
        if (price !== appointment.price) {
          await db.query("update appointments set price = $2, updated_at = now() where id = $1", [appointment.id, price]);
          changes.push({ label: "Precio", before: formatCurrency(appointment.price), after: formatCurrency(price) });
        }
      }
      await logAudit(db, {
        businessId,
        actor,
        action: "loyalty.reward_redeemed",
        entityType: "loyalty",
        entityId: reward.id,
        summary: `Canjeó «${reward.name}» (${formatRewardCode(reward.code)}) de ${reward.clientName}${appointment ? " en su cita" : ""}`,
        changes,
      });
      return withCode(
        (await one<LoyaltyReward>(
          db,
          `select ${REWARD_COLUMNS} from loyalty_rewards r join clients c on c.id = r.client_id left join users u on u.id = r.redeemed_by
            where r.id = $1`,
          [reward.id],
        ))!,
      );
    });
  },
};

