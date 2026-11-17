import { appointmentColumns } from "../db/columns.ts";
import { isUuid, many, one, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { APPOINTMENT_STATUS_CONFIG } from "../shared/lib/constants/appointment-status.ts";
import { getZonedNow } from "../shared/lib/time.ts";
import { scanCompleteSchema, scanLinkSchema, scanNewClientSchema, scanSchema } from "../shared/lib/validations/loyalty.ts";
import type { Appointment, ScanAppointment, ScanClient, ScanResult } from "../shared/types/index.ts";
import { normalizePhone } from "../shared/lib/validations/fields.ts";
import { agendaScope, assertAppointmentInScope, assertClientInScope, ownClientCondition, type AgendaScope } from "./agenda-scope.ts";
import { logAudit } from "./audit.ts";
import { changeAppointmentStatus, insertClient } from "./business-data-service.ts";
import { authorize, parseInput, type Actor, type RequestContext } from "./context.ts";

/*
 * «Escanear» (spec 052): el QR de la cuenta del paciente, en el panel. La primera vez en un negocio, el usuario elige
 * quién es: la ficha con el mismo teléfono que la cuenta (sin cita), la ficha de una de las citas de hoy que puede ver
 * o una ficha nueva con el teléfono de la cuenta. La cuenta queda unida a esa ficha: ese escaneo en persona es la
 * verificación (con sólo registrarse con un teléfono, nadie ve nada de un negocio). Al escanear o al unir, la única
 * cita de hoy pendiente o confirmada del paciente queda atendida sola (pedido del dueño), por el mismo camino que la
 * ficha; con varias, se elige cuál. Funciona aunque la tarjeta esté apagada.
 */

const QR_GONE = "Este QR ya no sirve: pídele al paciente que abra su tarjeta.";

interface ScannedAccount {
  id: string;
  name: string;
  phone: string;
}

async function accountByToken(db: Db, token: string): Promise<ScannedAccount> {
  const account = await one<ScannedAccount>(db, "select id, name, phone from patient_accounts where qr_token = $1", [token]);
  if (!account) throw new AppError("not_found", QR_GONE);
  return account;
}

async function todayOf(db: Db, businessId: string): Promise<string> {
  const { timezone } = (await one<{ timezone: string }>(db, "select timezone from businesses where id = $1", [businessId]))!;
  return getZonedNow(timezone).date;
}

const isOpen = (status: string) => status === "pending" || status === "confirmed";

/**
 * Las citas de hoy del negocio que el usuario puede ver, una fila por persona de cada cita (`clientId`: sólo esa), con
 * si el teléfono de la ficha es el de la cuenta (lo que mira el equipo para elegir: el nombre lo escribe la cuenta).
 */
async function todayAppointments(
  db: Db,
  businessId: string,
  scope: AgendaScope,
  clientId: string | null,
  account: ScannedAccount,
): Promise<ScanAppointment[]> {
  const rows = await many<Omit<ScanAppointment, "phoneMatches"> & { clientPhone: string }>(
    db,
    `select a.id, p.client_id as "clientId", c.name as "clientName", s.name as "serviceName", pr.display_name as "professionalName",
            left(a.start_time::text, 5) as "startTime", a.status, c.phone as "clientPhone"
       from appointments a
       cross join lateral (select a.client_id union all select ac.client_id from appointment_clients ac where ac.appointment_id = a.id) p(client_id)
       join clients c on c.id = p.client_id
       join services s on s.id = a.service_id
       join professionals pr on pr.id = a.professional_id
      where a.business_id = $1 and a.date = $2::date and a.status <> 'cancelled'
        and ($3::uuid is null or a.professional_id = $3::uuid)
        and ($4::uuid is null or p.client_id = $4::uuid)
      order by a.start_time, c.name`,
    [businessId, await todayOf(db, businessId), scope.professionalId, clientId],
  );
  return rows.map(({ clientPhone, ...row }) => ({ ...row, phoneMatches: normalizePhone(clientPhone ?? "") === account.phone }));
}

/**
 * Las fichas del negocio con el mismo teléfono que la cuenta (las que el usuario puede ver): se buscan por los 8
 * últimos dígitos y se confirman con el teléfono completo. Pocas filas: sólo al escanear una cuenta sin unir.
 */
async function phoneClients(db: Db, businessId: string, scope: AgendaScope, account: ScannedAccount): Promise<ScanClient[]> {
  const own = scope.ownClients;
  const rows = await many<ScanClient & { phone: string }>(
    db,
    `select c.id as "clientId", c.name as "clientName", c.phone, nullif(right(coalesce(c.document_id, ''), 4), '') as "documentEnd",
            exists (select 1 from loyalty_cards k where k.client_id = c.id and k.patient_account_id is not null and k.patient_account_id <> $3)
              as "linkedToOther"
       from clients c
      where c.business_id = $1 and right(regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g'), 8) = $2
        ${own ? `and ${ownClientCondition("c", 4, 5)}` : ""}
      order by c.is_active desc, c.name
      limit 10`,
    own ? [businessId, account.phone.slice(-8), account.id, own.professionalId, own.userId] : [businessId, account.phone.slice(-8), account.id],
  );
  return rows.filter((row) => normalizePhone(row.phone) === account.phone).map(({ phone: _phone, ...row }) => row);
}

/** El escaneo en persona renueva la unión: después de un enlace de contraseña, la tarjeta vuelve a verse (spec 052). */
const touchLink = (db: Db, businessId: string, accountId: string) =>
  db.query("update loyalty_cards set linked_at = now() where business_id = $1 and patient_account_id = $2", [businessId, accountId]);

async function linkedClient(db: Db, businessId: string, accountId: string): Promise<{ clientId: string; clientName: string } | null> {
  return one(
    db,
    `select k.client_id as "clientId", c.name as "clientName" from loyalty_cards k join clients c on c.id = k.client_id
      where k.business_id = $1 and k.patient_account_id = $2`,
    [businessId, accountId],
  );
}

/**
 * Marca como atendida una cita de hoy del paciente unido, por el mismo camino que la ficha (con su sello y el email de
 * seguimiento). Bloquea la fila: dos escaneos a la vez no la marcan dos veces. Devuelve la cita ya atendida o null si
 * ya no estaba pendiente ni confirmada.
 */
async function completeToday(
  db: Db,
  actor: Actor,
  businessId: string,
  scope: AgendaScope,
  linked: { clientId: string; clientName: string },
  appointment: ScanAppointment,
): Promise<ScanAppointment | null> {
  const before = (await one<Appointment>(db, `select ${appointmentColumns()} from appointments where id = $1 and business_id = $2 for update`, [
    appointment.id,
    businessId,
  ]))!;
  assertAppointmentInScope(scope, before);
  if (!isOpen(before.status)) return null;
  await changeAppointmentStatus(db, actor, before, "completed", true);
  await logAudit(db, {
    businessId,
    actor,
    action: "loyalty.qr_completed",
    entityType: "loyalty",
    entityId: appointment.id,
    summary: `Marcó como atendida, con el QR, la cita de hoy de ${linked.clientName}`,
  });
  return { ...appointment, status: "completed" };
}

/** Al escanear o al unir: si el paciente tiene una sola cita de hoy por atender, queda atendida. Con varias, se elige. */
async function completeOnlyOpen(
  db: Db,
  actor: Actor,
  businessId: string,
  scope: AgendaScope,
  linked: { clientId: string; clientName: string },
  account: ScannedAccount,
): Promise<ScanAppointment | null> {
  const open = (await todayAppointments(db, businessId, scope, linked.clientId, account)).filter((item) => isOpen(item.status));
  return open.length === 1 ? completeToday(db, actor, businessId, scope, linked, open[0]!) : null;
}

async function result(
  db: Db,
  businessId: string,
  scope: AgendaScope,
  account: ScannedAccount,
  completedNow: ScanAppointment | null = null,
): Promise<ScanResult> {
  const linked = await linkedClient(db, businessId, account.id);
  if (!linked) {
    const [clients, appointments] = await Promise.all([
      phoneClients(db, businessId, scope, account),
      todayAppointments(db, businessId, scope, null, account),
    ]);
    return { status: "unlinked", accountName: account.name, accountPhoneEnd: account.phone.slice(-4), phoneClients: clients, appointments };
  }
  await touchLink(db, businessId, account.id);
  return {
    status: "linked",
    ...linked,
    appointments: await todayAppointments(db, businessId, scope, linked.clientId, account),
    completedNow,
  };
}

/** Unir la cuenta a la ficha (dentro de la transacción): sin repetir cuenta ni ficha, con la actividad. */
async function linkAccount(db: Db, actor: Actor, businessId: string, account: ScannedAccount, client: { id: string; name: string }, how: string) {
  const already = await linkedClient(db, businessId, account.id);
  if (already && already.clientId !== client.id) {
    throw new AppError("conflict", `Esta cuenta ya está unida a la ficha de ${already.clientName}.`);
  }
  const other = await one(
    db,
    "select 1 from loyalty_cards where client_id = $1 and patient_account_id is not null and patient_account_id <> $2",
    [client.id, account.id],
  );
  if (other) throw new AppError("conflict", "Esta ficha ya está unida a otra cuenta.");
  if (already) return;
  await db.query(
    `insert into loyalty_cards (client_id, business_id, patient_account_id, linked_at, linked_by) values ($1, $2, $3, now(), $4)
     on conflict (client_id) do update set patient_account_id = excluded.patient_account_id, linked_at = now(), linked_by = excluded.linked_by`,
    [client.id, businessId, account.id, actor.userId],
  );
  await logAudit(db, {
    businessId,
    actor,
    action: "loyalty.account_linked",
    entityType: "loyalty",
    entityId: client.id,
    summary: `Escaneó el QR de ${account.name} y unió su cuenta a la ficha de ${client.name}${how}`,
  });
}

export const loyaltyScanService = {
  /** Escanear: quién es y, si ya está unida y tiene una sola cita de hoy por atender, la marca como atendida. */
  async scan(ctx: RequestContext, businessId: string, input: unknown): Promise<ScanResult> {
    const { token } = parseInput(scanSchema, input);
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "appointments.manage", { lock: true });
      const scope = await agendaScope(db, actor, businessId);
      const account = await accountByToken(db, token);
      const linked = await linkedClient(db, businessId, account.id);
      const completedNow = linked ? await completeOnlyOpen(db, actor, businessId, scope, linked, account) : null;
      return result(db, businessId, scope, account, completedNow);
    });
  },

  /**
   * Unir la cuenta a una ficha (la primera vez en este negocio): la de una cita de hoy (`appointmentId`) o, sin cita,
   * una ficha con el mismo teléfono que la cuenta. Después, la cita de hoy queda atendida (la elegida o la única).
   */
  async link(ctx: RequestContext, businessId: string, input: unknown): Promise<ScanResult> {
    const { token, appointmentId, clientId } = parseInput(scanLinkSchema, input);
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "appointments.manage", { lock: true });
      const scope = await agendaScope(db, actor, businessId);
      const account = await accountByToken(db, token);
      if (!isUuid(clientId) || (appointmentId !== null && !isUuid(appointmentId))) {
        throw new AppError("validation", "Elige la ficha o la cita de hoy de este paciente.");
      }
      // El rol Profesional con «sólo sus pacientes»: no une una ficha a la que todavía no tiene acceso (spec 009).
      await assertClientInScope(db, scope, clientId);
      let chosen: ScanAppointment | null = null;
      let client: { id: string; name: string; phone: string } | null;
      if (appointmentId) {
        chosen = (await todayAppointments(db, businessId, scope, clientId, account)).find((item) => item.id === appointmentId) ?? null;
        if (!chosen) throw new AppError("validation", "Elige la cita de hoy de este paciente.");
        client = { id: clientId, name: chosen.clientName, phone: "" };
      } else {
        client = await one(db, "select id, name, coalesce(phone, '') as phone from clients where id = $1 and business_id = $2", [clientId, businessId]);
        if (!client) throw new AppError("not_found", "Cliente no encontrado.");
        if (normalizePhone(client.phone) !== account.phone) {
          throw new AppError("validation", "Esta ficha tiene otro teléfono que la cuenta: elige su cita de hoy.");
        }
      }
      await linkAccount(db, actor, businessId, account, client, appointmentId ? "" : " (mismo teléfono)");
      const linked = { clientId: client.id, clientName: client.name };
      const completedNow = chosen
        ? isOpen(chosen.status)
          ? await completeToday(db, actor, businessId, scope, linked, chosen)
          : null
        : await completeOnlyOpen(db, actor, businessId, scope, linked, account);
      return result(db, businessId, scope, account, completedNow);
    });
  },

  /**
   * «Paciente nuevo»: crea su ficha con los datos que escribe el equipo y el teléfono de la cuenta (lo pone la API: el
   * panel sólo ve sus 4 últimos dígitos) y une la cuenta a ella.
   */
  async newClient(ctx: RequestContext, businessId: string, input: unknown): Promise<ScanResult> {
    const { token, client: fields } = parseInput(scanNewClientSchema, input);
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "clients.manage", { lock: true });
      await authorize(db, ctx, businessId, "appointments.manage");
      const scope = await agendaScope(db, actor, businessId);
      const account = await accountByToken(db, token);
      const already = await linkedClient(db, businessId, account.id);
      if (already) throw new AppError("conflict", `Esta cuenta ya está unida a la ficha de ${already.clientName}.`);
      const client = await insertClient(db, actor, businessId, {
        documentId: "",
        email: "",
        address: "",
        notes: "",
        ...fields,
        phone: account.phone,
        isActive: true,
      });
      await linkAccount(db, actor, businessId, account, client, " (paciente nuevo)");
      return result(db, businessId, scope, account);
    });
  },

  /**
   * «Desunir la cuenta» (revisión de seguridad): si se unió a la ficha equivocada, el equipo la quita. La ficha
   * conserva sus sellos y sus premios; la cuenta deja de ver esta tarjeta. Queda en la actividad.
   */
  async unlink(ctx: RequestContext, businessId: string, clientId: string): Promise<{ unlinked: true }> {
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "clients.manage", { lock: true });
      if (!isUuid(clientId)) throw new AppError("not_found", "Cliente no encontrado.");
      await assertClientInScope(db, await agendaScope(db, actor, businessId), clientId);
      const row = await one<{ clientName: string }>(
        db,
        `update loyalty_cards k set patient_account_id = null, linked_at = null, linked_by = null
           from clients c
          where k.client_id = $1 and k.business_id = $2 and k.patient_account_id is not null and c.id = k.client_id
          returning c.name as "clientName"`,
        [clientId, businessId],
      );
      if (!row) throw new AppError("conflict", "Este paciente no tiene una cuenta unida a su ficha.");
      await logAudit(db, {
        businessId,
        actor,
        action: "loyalty.account_unlinked",
        entityType: "loyalty",
        entityId: clientId,
        summary: `Desunió la cuenta de paciente de la ficha de ${row.clientName}`,
      });
      return { unlinked: true as const };
    });
  },

  /** «Marcar como atendida»: con varias citas de hoy, la que se elige, por el mismo camino que la ficha. */
  async complete(ctx: RequestContext, businessId: string, input: unknown): Promise<ScanResult> {
    const { token, appointmentId } = parseInput(scanCompleteSchema, input);
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "appointments.manage", { lock: true });
      const scope = await agendaScope(db, actor, businessId);
      const account = await accountByToken(db, token);
      const linked = await linkedClient(db, businessId, account.id);
      if (!linked) throw new AppError("conflict", "Primero elige a qué paciente de hoy corresponde este QR.");
      const chosen = isUuid(appointmentId)
        ? (await todayAppointments(db, businessId, scope, linked.clientId, account)).find((item) => item.id === appointmentId)
        : undefined;
      if (!chosen) throw new AppError("validation", "Esa cita no es de hoy ni de este paciente.");
      const completedNow = await completeToday(db, actor, businessId, scope, linked, chosen);
      if (!completedNow) throw new AppError("conflict", `Esta cita ya está «${APPOINTMENT_STATUS_CONFIG[chosen.status].label}».`);
      return result(db, businessId, scope, account, completedNow);
    });
  },
};
