/**
 * Las invitaciones de calendario que no llegaron (spec 027, 2026-10-22). calendar_invites anota lo enviado
 * a cada agenda al ponerlo en cola: si ese email no sale nunca (agotó los reintentos o, en local, quedó en
 * cola al reiniciar dev:local), el calendario no tiene esa versión aunque la fila diga que sí. Invalidar la
 * fila (sin huella y sin cancelar) hace que la siguiente sincronización (la API o el cron) la vuelva a
 * enviar, con un SEQUENCE mayor: una invitación si la cita sigue activa en esa agenda, o su cancelación si
 * no.
 *
 * Sin imports: lo usan el mailer y scripts/dev-local.ts, que no puede cargar la configuración de la API.
 */

/** El SEQUENCE de un iCalendar guardado en notifications.calendar (null si ya se borró el contenido). */
export const inviteSequenceSql = (alias: string) => `substring(${alias}.calendar from '\\nSEQUENCE:([0-9]+)')::int`;

/**
 * Invalida las filas de calendar_invites de las invitaciones de `where` (una condición sobre `n`, la
 * tabla notifications): sólo si la fila sigue siendo de esa versión (mismo buzón y mismo SEQUENCE). Si
 * después salió otra, la fila ya es de ésa y no se toca.
 */
export const resetUndeliveredInvitesSql = (where: string) =>
  `update calendar_invites ci
      set fingerprint = '', cancelled = false, updated_at = now()
     from notifications n
    where n.type = 'calendar_invite' and (${where})
      and ci.appointment_id = n.appointment_id and ci.email = n.to_email
      and ci.sequence = ${inviteSequenceSql("n")}`;
