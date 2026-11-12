import { businessColumns } from "../db/columns.ts";
import { isUuid, many, one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import {
  SURVEY_DAYS_BETWEEN,
  SURVEY_LINK_DAYS,
  SURVEY_LOW_RATING,
  SURVEY_MAX_DAYS_AFTER,
  SURVEY_SEND_HOUR,
} from "../shared/lib/constants/business.ts";
import { emailTemplates } from "../shared/lib/email/templates.ts";
import { addDaysISO, getZonedNow } from "../shared/lib/time.ts";
import { surveyAnswerSchema } from "../shared/lib/validations/survey.ts";
import type { Business, ISODate, PublicSurvey, SurveyResponse, SurveySummary } from "../shared/types/index.ts";
import { agendaScope } from "./agenda-scope.ts";
import { logAudit } from "./audit.ts";
import { PATIENT_LINK_ACTOR } from "./business-data-service.ts";
import { authorize, parseInput, type RequestContext } from "./context.ts";
import { queueEmail, surveyUrl } from "./notifications.ts";
import { addAppointmentNotice } from "./panel-notices.ts";

/**
 * Encuesta después de la cita (spec 048). Al día siguiente de una cita Atendida, desde las 10:00 de la hora del
 * negocio y hasta 3 días después, el paciente principal recibe «¿Cómo te fue?» con 5 estrellas (si tiene email,
 * no pidió dejar de recibirlas y no recibió otra del negocio en los últimos 90 días). Responde una vez, sin
 * iniciar sesión, en /encuesta/:token (vale 14 días). Las opiniones son privadas: sólo las ve en el panel quien
 * ve Reportes. Con 1 o 2 estrellas avisa la campana, sin el comentario. Los emails no llevan copia al profesional.
 */

const TOKEN_FORMAT = /^[0-9a-f]{32}$/;
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const LINK_NOT_FOUND = "Este enlace no es válido o ya no está disponible.";

export const surveysEnabled = (business: Pick<Business, "notificationSettings">) => business.notificationSettings.surveys === true;

const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * El envío de un negocio, desde el cron (`queueSurveyRequests`). `at`: el momento (las pruebas lo mueven). Elige una
 * cita por paciente (la más reciente) y deja la encuesta con su enlace. Devuelve cuántos emails quedaron en cola.
 */
export async function runSurveyJob(db: Db, businessId: string, at: Date = new Date()): Promise<number> {
  const business = await one<Business>(db, `select ${businessColumns()} from businesses where id = $1 and status = 'active'`, [businessId]);
  if (!business || !surveysEnabled(business)) return 0;
  const now = getZonedNow(business.timezone, at);
  if (now.minutes < SURVEY_SEND_HOUR * 60) return 0;
  const candidates = await many<{
    appointmentId: string;
    clientId: string;
    professionalId: string;
    date: ISODate;
    clientName: string;
    email: string;
    serviceName: string;
    professionalName: string;
  }>(
    db,
    `select distinct on (a.client_id)
            a.id as "appointmentId", a.client_id as "clientId", a.professional_id as "professionalId",
            to_char(a.date, 'YYYY-MM-DD') as date, c.name as "clientName", c.email, s.name as "serviceName",
            p.display_name as "professionalName"
       from appointments a
       join clients c on c.id = a.client_id
       join services s on s.id = a.service_id
       join professionals p on p.id = a.professional_id
      where a.business_id = $1 and a.status = 'completed' and a.date between $2 and $3
        and coalesce(c.email, '') <> '' and c.surveys_opted_out_at is null
        and not exists (select 1 from surveys v where v.appointment_id = a.id)
        and not exists (select 1 from surveys v where v.client_id = a.client_id
                         and v.sent_at > $4::timestamptz - make_interval(days => $5))
      order by a.client_id, a.date desc, a.start_time desc`,
    [businessId, addDaysISO(now.date, -SURVEY_MAX_DAYS_AFTER), addDaysISO(now.date, -1), at.toISOString(), SURVEY_DAYS_BETWEEN],
  );
  let queued = 0;
  for (const candidate of candidates) {
    const survey = await one<{ token: string }>(
      db,
      `insert into surveys (business_id, appointment_id, client_id, professional_id, sent_at, expires_at)
       values ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz + make_interval(days => $6))
       on conflict (appointment_id) do nothing
       returning token`,
      [businessId, candidate.appointmentId, candidate.clientId, candidate.professionalId, at.toISOString(), SURVEY_LINK_DAYS],
    );
    if (!survey) continue;
    const sent = await queueEmail(db, {
      businessId,
      type: "survey_request",
      to: candidate.email,
      appointmentId: candidate.appointmentId,
      dedupeKey: `survey:${candidate.appointmentId}`,
      ...emailTemplates.surveyRequest({
        clientName: firstNameOf(candidate.clientName),
        businessName: business.name,
        businessAddress: business.address,
        businessPhone: business.phone,
        professionalName: candidate.professionalName,
        serviceName: candidate.serviceName,
        date: candidate.date,
        surveyUrl: surveyUrl(survey.token),
      }),
    });
    if (sent) queued++;
  }
  return queued;
}

/** La encuesta de un enlace, con su negocio activo; null si no existe. */
async function findByToken(db: Db, token: string, lock = false) {
  if (!TOKEN_FORMAT.test(token)) return null;
  return one<{
    id: string;
    businessId: string;
    appointmentId: string;
    clientId: string;
    businessName: string;
    professionalName: string;
    serviceName: string;
    date: ISODate;
    clientName: string;
    rating: number | null;
    expired: boolean;
  }>(
    db,
    `select v.id, v.business_id as "businessId", v.appointment_id as "appointmentId", v.client_id as "clientId",
            b.name as "businessName", p.display_name as "professionalName", s.name as "serviceName",
            to_char(a.date, 'YYYY-MM-DD') as date, c.name as "clientName", v.rating, v.expires_at < now() as expired
       from surveys v
       join businesses b on b.id = v.business_id and b.status = 'active'
       join appointments a on a.id = v.appointment_id
       join services s on s.id = a.service_id
       join professionals p on p.id = v.professional_id
       join clients c on c.id = v.client_id
      where v.token = $1
      ${lock ? "for update of v" : ""}`,
    [token],
  );
}

const statusOf = (survey: { rating: number | null; expired: boolean }): PublicSurvey["status"] =>
  survey.rating !== null ? "answered" : survey.expired ? "expired" : "open";

/** Los filtros de las opiniones: fechas de la cita (YYYY-MM-DD) y los ids. Lo que no tiene su forma se ignora. */
function readFilters(query: { from?: string; to?: string; professionalId?: string; clientId?: string }) {
  return {
    from: query.from && DATE_FORMAT.test(query.from) ? query.from : null,
    to: query.to && DATE_FORMAT.test(query.to) ? query.to : null,
    professionalId: query.professionalId && isUuid(query.professionalId) ? query.professionalId : null,
    clientId: query.clientId && isUuid(query.clientId) ? query.clientId : null,
  };
}

export const surveyService = {
  /* ------------------------------------------------------------ Público (sin sesión) -- */

  /** La página de la encuesta: la cita y si está abierta, respondida o cerrada. */
  async get(token: string): Promise<PublicSurvey> {
    const survey = await findByToken(pool, token);
    if (!survey) throw new AppError("not_found", LINK_NOT_FOUND);
    return {
      businessName: survey.businessName,
      professionalName: survey.professionalName,
      serviceName: survey.serviceName,
      date: survey.date,
      firstName: firstNameOf(survey.clientName),
      status: statusOf(survey),
      rating: survey.rating,
    };
  },

  /** Responder: una sola vez y mientras el enlace esté abierto. Con 1 o 2 estrellas, el aviso de la campana. */
  async answer(token: string, input: unknown): Promise<PublicSurvey> {
    const data = parseInput(surveyAnswerSchema, input);
    return transaction(async (db) => {
      const survey = await findByToken(db, token, true);
      if (!survey) throw new AppError("not_found", LINK_NOT_FOUND);
      if (survey.rating !== null) throw new AppError("conflict", "Ya respondiste esta encuesta. ¡Gracias!");
      if (survey.expired) throw new AppError("validation", "Esta encuesta ya cerró.");
      await db.query("update surveys set rating = $2, comment = $3, answered_at = now() where id = $1", [survey.id, data.rating, data.comment]);
      await logAudit(db, {
        businessId: survey.businessId,
        actor: null,
        actorName: PATIENT_LINK_ACTOR,
        action: "survey.answered",
        entityType: "appointment",
        entityId: survey.appointmentId,
        // Las estrellas, nunca el comentario.
        summary: `${survey.clientName} respondió la encuesta de su cita del ${survey.date}: ${data.rating} ${data.rating === 1 ? "estrella" : "estrellas"}`,
      });
      if (data.rating <= SURVEY_LOW_RATING) {
        await addAppointmentNotice(db, {
          kind: "survey_low",
          businessId: survey.businessId,
          appointmentId: survey.appointmentId,
          clientId: survey.clientId,
          data: { rating: data.rating },
          dedupeKey: `survey-low:${survey.id}`,
        });
      }
      return { ...(await surveyService.get(token)), status: "answered", rating: data.rating };
    });
  },

  /** «No quiero recibir estas encuestas»: la marca del paciente en ese negocio. Repetirlo no hace nada. */
  async optOut(token: string): Promise<{ optedOut: true }> {
    return transaction(async (db) => {
      const survey = await findByToken(db, token, true);
      if (!survey) throw new AppError("not_found", LINK_NOT_FOUND);
      const changed = await one(
        db,
        "update clients set surveys_opted_out_at = now() where id = $1 and surveys_opted_out_at is null returning id",
        [survey.clientId],
      );
      if (changed) {
        await logAudit(db, {
          businessId: survey.businessId,
          actor: null,
          actorName: PATIENT_LINK_ACTOR,
          action: "client.surveys_opted_out",
          entityType: "client",
          entityId: survey.clientId,
          summary: `${survey.clientName} pidió no recibir más encuestas`,
        });
      }
      return { optedOut: true };
    });
  },

  /* --------------------------------------------------------------------- El panel -- */

  /**
   * Las opiniones (Reportes y la ficha del paciente): quien ve Reportes; el rol Profesional, sólo las de su agenda.
   * Filtra por la fecha de la cita, el profesional y el paciente.
   */
  async summary(
    ctx: RequestContext,
    businessId: string,
    query: { from?: string; to?: string; professionalId?: string; clientId?: string },
  ): Promise<SurveySummary> {
    const actor = await authorize(pool, ctx, businessId, "reports.view");
    const { professionalId: ownAgenda } = await agendaScope(pool, actor, businessId);
    const filters = readFilters(query);
    const professionalId = ownAgenda ?? filters.professionalId;
    const where = `v.business_id = $1 and v.answered_at is not null
      and ($2::date is null or a.date >= $2::date) and ($3::date is null or a.date <= $3::date)
      and ($4::uuid is null or v.professional_id = $4::uuid) and ($5::uuid is null or v.client_id = $5::uuid)`;
    const values = [businessId, filters.from, filters.to, professionalId, filters.clientId];
    const totals = (await one<{ average: number | null; count: number; r1: number; r2: number; r3: number; r4: number; r5: number }>(
      pool,
      `select round(avg(v.rating)::numeric, 1) as average, count(*)::int as count,
              count(*) filter (where v.rating = 1)::int as r1, count(*) filter (where v.rating = 2)::int as r2,
              count(*) filter (where v.rating = 3)::int as r3, count(*) filter (where v.rating = 4)::int as r4,
              count(*) filter (where v.rating = 5)::int as r5
         from surveys v join appointments a on a.id = v.appointment_id
        where ${where}`,
      values,
    ))!;
    const responses = await many<SurveyResponse>(
      pool,
      `select v.id, v.appointment_id as "appointmentId", to_char(a.date, 'YYYY-MM-DD') as "appointmentDate",
              v.answered_at as "answeredAt", v.client_id as "clientId", c.name as "clientName",
              v.professional_id as "professionalId", p.display_name as "professionalName", s.name as "serviceName",
              v.rating, v.comment
         from surveys v
         join appointments a on a.id = v.appointment_id
         join clients c on c.id = v.client_id
         join professionals p on p.id = v.professional_id
         join services s on s.id = a.service_id
        where ${where}
        order by v.answered_at desc, v.id
        limit 50`,
      values,
    );
    return {
      average: totals.count > 0 ? Number(totals.average) : null,
      count: totals.count,
      byRating: [totals.r1, totals.r2, totals.r3, totals.r4, totals.r5],
      responses,
    };
  },
};
