import { z } from "zod";
import { appointmentColumns } from "../db/columns.ts";
import { isUuid, many, one, pool, transaction } from "../db/pool.ts";
import { PENDING_PAYMENTS_SINCE } from "../shared/lib/constants/business.ts";
import type { Appointment, PendingPaymentsSummary } from "../shared/types/index.ts";
import { agendaScope } from "./agenda-scope.ts";
import { describeAppointment, logAudit } from "./audit.ts";
import { authorize, parseInput, type RequestContext } from "./context.ts";

/**
 * «Por cobrar» (spec 046): una sesión Completada, con precio, sin la marca de pagada y atendida desde
 * PENDING_PAYMENTS_SINCE (`since`: el parámetro con esa fecha). Cuenta para el paciente principal
 * (`appointments.client_id`), el que paga. La misma regla que `isPendingPayment` del front.
 */
export const pendingPaymentSql = (alias: string, since: string) =>
  `(${alias}.status = 'completed' and ${alias}.price > 0 and ${alias}.paid_at is null and ${alias}.date >= ${since}::date)`;

/** Las sesiones que se marcan de una vez: las que el usuario vio en la ficha y confirmó. */
const payPendingSchema = z.object({
  appointmentIds: z
    .array(z.string().refine(isUuid, "Cita no válida"), { error: "Indica las sesiones" })
    .min(1, "Indica las sesiones")
    .max(100, "Como máximo 100 sesiones a la vez"),
});

export const pendingPaymentsService = {
  /**
   * El total de la tarjeta «Por cobrar» de Inicio: lo que suman las sesiones por cobrar, cuántos pacientes
   * deben y cuántas sesiones son. Lo ve todo el equipo; el rol Profesional, sólo lo de su agenda. Leer no
   * va a la actividad.
   */
  async summary(ctx: RequestContext, businessId: string): Promise<PendingPaymentsSummary> {
    const actor = await authorize(pool, ctx, businessId);
    const { professionalId } = await agendaScope(pool, actor, businessId);
    const row = await one<PendingPaymentsSummary>(
      pool,
      `select coalesce(sum(a.price), 0) as amount,
              count(distinct a.client_id)::int as clients,
              count(*)::int as sessions
         from appointments a
        where a.business_id = $1 and ($2::uuid is null or a.professional_id = $2::uuid)
          and ${pendingPaymentSql("a", "$3")}`,
      [businessId, professionalId, PENDING_PAYMENTS_SINCE],
    );
    return row ?? { amount: 0, clients: 0, sessions: 0 };
  },

  /**
   * «Marcar todas como pagadas» desde la ficha del paciente. Sólo marca, de las sesiones pedidas, las que son
   * de ese paciente como principal, están Completadas, siguen sin pagar y son de una agenda que quien lo pide
   * maneja; las demás se saltan sin error (p. ej. una que otro ya marcó). Cada una queda en la actividad como
   * al marcarla en su ficha.
   */
  async pay(ctx: RequestContext, businessId: string, clientId: string, input: unknown): Promise<{ paid: number }> {
    const { appointmentIds } = parseInput(payPendingSchema, input);
    if (!isUuid(clientId)) return { paid: 0 };
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "appointments.manage", { lock: true });
      const { professionalId } = await agendaScope(db, actor, businessId);
      const paid = await many<Appointment>(
        db,
        `update appointments a set paid_at = now(), updated_at = now()
          where a.business_id = $1 and a.client_id = $2 and a.id = any($3::uuid[])
            and a.status = 'completed' and a.paid_at is null
            and ($4::uuid is null or a.professional_id = $4::uuid)
          returning ${appointmentColumns("a")}`,
        [businessId, clientId, appointmentIds, professionalId],
      );
      for (const appointment of paid) {
        await logAudit(db, {
          businessId,
          actor,
          action: "appointment.paid",
          entityType: "appointment",
          entityId: appointment.id,
          summary: `Marcó como pagada la cita de ${await describeAppointment(db, appointment)}`,
        });
      }
      return { paid: paid.length };
    });
  },
};
