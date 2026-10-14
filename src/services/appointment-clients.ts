import { appointmentColumns } from "../db/columns.ts";
import { isUuid, many, one, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import type { Appointment } from "../shared/types/index.ts";
import { assertClientInScope, type AgendaScope } from "./agenda-scope.ts";

/**
 * Citas con varios pacientes (spec 004, p. ej. sesiones de pareja): además del principal
 * (appointments.client_id) hasta 2 más, en la tabla appointment_clients. Sólo en los negocios que el
 * super admin habilitó (businesses.multi_client_appointments); al apagarlo, las citas que ya los tienen
 * los conservan y sólo se pueden quitar.
 */

/** Todos los pacientes de la cita: el principal primero y luego los demás, en orden. */
export const appointmentClientIds = (appointment: Pick<Appointment, "clientId"> & { extraClientIds?: string[] }): string[] => [
  appointment.clientId,
  ...(appointment.extraClientIds ?? []),
];

interface ResolveExtraClients {
  businessId: string;
  scope: AgendaScope;
  /** El paciente principal que tendrá la cita. */
  clientId: string;
  /** Lo que pidió el formulario; undefined (un front anterior): se conservan los que tenía. */
  requested: string[] | undefined;
  /** Los que tiene la cita guardada ([] al crearla). */
  current: string[];
}

/**
 * Los otros pacientes con los que quedará la cita. Quitar siempre se puede; agregar, sólo si el negocio
 * lo tiene habilitado, y cada paciente nuevo tiene que ser del negocio, estar activo y (rol Profesional
 * con "sólo sus pacientes") estar en su alcance. Repetidos, el principal en la lista y más de 2 los
 * rechaza antes appointmentSchema.
 */
export async function resolveExtraClients(db: Db, input: ResolveExtraClients): Promise<string[]> {
  const extra = (input.requested ?? input.current).filter((id) => id !== input.clientId);
  const added = extra.filter((id) => !input.current.includes(id));
  if (added.length === 0) return extra;

  const business = await one<{ enabled: boolean }>(
    db,
    "select multi_client_appointments as enabled from businesses where id = $1",
    [input.businessId],
  );
  if (!business?.enabled) {
    throw new AppError("validation", "Este negocio no tiene habilitadas las citas con varios pacientes.");
  }
  for (const id of added) {
    const client = isUuid(id)
      ? await one<{ name: string; isActive: boolean }>(
          db,
          `select name, is_active as "isActive" from clients where id = $1 and business_id = $2`,
          [id, input.businessId],
        )
      : null;
    if (!client) throw new AppError("not_found", "Cliente no encontrado.");
    if (!client.isActive) throw new AppError("validation", `${client.name} está inactivo.`);
    await assertClientInScope(db, input.scope, id);
  }
  return extra;
}

/**
 * Guarda los otros pacientes de la cita (quita los que salen y agrega los que entran, en ese orden) y
 * devuelve la cita releída. Va después de guardar el paciente principal: la base no deja que el
 * principal sea también uno de los otros (migración 032).
 */
export async function saveExtraClients(db: Db, appointment: Appointment, next: string[], current: string[]): Promise<Appointment> {
  const removed = current.filter((id) => !next.includes(id));
  if (removed.length > 0) {
    await db.query("delete from appointment_clients where appointment_id = $1 and client_id = any($2::uuid[])", [
      appointment.id,
      removed,
    ]);
  }
  for (const id of next) {
    if (current.includes(id)) continue;
    // clock_timestamp(): cada uno con su hora, así se muestran en el orden en que se eligieron.
    await db.query(
      `insert into appointment_clients (appointment_id, client_id, business_id, created_at)
       values ($1, $2, $3, clock_timestamp())`,
      [appointment.id, id, appointment.businessId],
    );
  }
  if (removed.length === 0 && next.every((id) => current.includes(id))) return appointment;
  return (await one<Appointment>(db, `select ${appointmentColumns()} from appointments where id = $1`, [appointment.id]))!;
}

/** Los nombres de unos pacientes en el orden pedido ("cliente" si alguno ya no existe). */
export async function clientNamesOf(db: Db, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await many<{ id: string; name: string }>(db, "select id, name from clients where id = any($1::uuid[])", [ids]);
  const byId = new Map(rows.map((row) => [row.id, row.name]));
  return ids.map((id) => byId.get(id) ?? "cliente");
}
