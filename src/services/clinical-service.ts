import { clinicalNoteColumns, clinicalProfileColumns } from "../db/columns.ts";
import { isUuid, many, one, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { DEFAULT_TIMEZONE } from "../shared/lib/constants/app.ts";
import { getZonedNow } from "../shared/lib/time.ts";
import { clinicalAddendumSchema, clinicalNoteSchema, clinicalProfileSchema } from "../shared/lib/validations/clinical.ts";
import type { ClinicalNote, ClinicalNoteAddendum, ClinicalProfile, ClinicalRecord } from "../shared/types/index.ts";
import { logAudit } from "./audit.ts";
import { authorize, parseInput, type Actor, type RequestContext } from "./context.ts";

/**
 * Historia clínica (datos de salud: datos sensibles).
 * - El propietario, los miembros que él autoriza y el super admin desde "Gestionar negocio"
 *   (modo soporte, con los permisos del propietario).
 * - No hay borrado ni edición de evoluciones: se añaden aclaraciones con autor y fecha.
 * - Cada acceso queda en la auditoría.
 */

/** Como mucho un registro de "consultó la historia" por persona y paciente en este intervalo. */
const VIEW_LOG_INTERVAL_MINUTES = 30;

async function authorizeClinical(db: Db, ctx: RequestContext, businessId: string, lock = false): Promise<Actor> {
  // El super admin (modo soporte) entra con rol de propietario: queda identificado en la auditoría.
  const actor = await authorize(db, ctx, businessId, undefined, { lock });
  const access = await one<{ enabled: boolean; clinicalAccess: boolean | null }>(
    db,
    `select b.clinical_records_enabled as enabled, bu.clinical_access as "clinicalAccess"
       from businesses b left join business_users bu on bu.business_id = b.id and bu.user_id = $2
      where b.id = $1`,
    [businessId, actor.userId],
  );
  if (!access?.enabled) throw new AppError("forbidden", "La historia clínica no está activada en este negocio.");
  if (actor.role !== "owner" && !access.clinicalAccess) {
    throw new AppError("forbidden", "No tienes acceso a las historias clínicas. Pide al propietario que te lo habilite.");
  }
  return actor;
}

/** "Hoy" en la zona horaria del negocio: fecha de las evoluciones y del consentimiento. */
async function businessToday(db: Db, businessId: string): Promise<string> {
  const business = await one<{ timezone: string }>(db, "select timezone from businesses where id = $1", [businessId]);
  return getZonedNow(business?.timezone ?? DEFAULT_TIMEZONE).date;
}

async function findPatient(db: Db, businessId: string, clientId: string): Promise<{ name: string }> {
  const client = isUuid(clientId)
    ? await one<{ name: string }>(db, "select name from clients where id = $1 and business_id = $2", [clientId, businessId])
    : null;
  if (!client) throw new AppError("not_found", "Paciente no encontrado.");
  return client;
}

/** Evoluciones con sus aclaraciones, de la más reciente a la más antigua. */
async function loadNotes(db: Db, where: string, values: unknown[]): Promise<ClinicalNote[]> {
  const notes = await many<Omit<ClinicalNote, "addenda">>(
    db,
    `select ${clinicalNoteColumns()} from clinical_notes where ${where} order by date desc, created_at desc`,
    values,
  );
  if (notes.length === 0) return [];
  const addenda = await many<ClinicalNoteAddendum & { noteId: string }>(
    db,
    `select id, note_id as "noteId", text, author_id as "authorId", author_name as "authorName", created_at as "createdAt"
       from clinical_note_addenda where note_id = any($1::uuid[]) order by created_at`,
    [notes.map((note) => note.id)],
  );
  return notes.map((note) => ({
    ...note,
    addenda: addenda.filter((a) => a.noteId === note.id).map(({ noteId: _, ...addendum }) => addendum),
  }));
}

export const clinicalService = {
  /** Antecedentes y evoluciones del paciente. Registra el acceso en la auditoría. */
  async get(ctx: RequestContext, businessId: string, clientId: string): Promise<ClinicalRecord> {
    return transaction(async (db) => {
      const actor = await authorizeClinical(db, ctx, businessId);
      const client = await findPatient(db, businessId, clientId);
      const loggedRecently = await one(
        db,
        `select 1 from audit_logs
          where business_id = $1 and action = 'clinical_record.viewed' and entity_id = $2 and actor_id = $3
            and created_at > now() - make_interval(mins => $4)
          limit 1`,
        [businessId, clientId, actor.userId, VIEW_LOG_INTERVAL_MINUTES],
      );
      if (!loggedRecently) {
        await logAudit(db, {
          businessId,
          actor,
          action: "clinical_record.viewed",
          entityType: "clinical_record",
          entityId: clientId,
          summary: `Consultó la historia clínica de ${client.name}`,
        });
      }
      return {
        profile: await one<ClinicalProfile>(
          db,
          `select ${clinicalProfileColumns()} from clinical_profiles where business_id = $1 and client_id = $2`,
          [businessId, clientId],
        ),
        notes: await loadNotes(db, "business_id = $1 and client_id = $2", [businessId, clientId]),
      };
    });
  },

  async saveProfile(ctx: RequestContext, businessId: string, clientId: string, input: unknown): Promise<ClinicalProfile> {
    const data = parseInput(clinicalProfileSchema, input);
    return transaction(async (db) => {
      const actor = await authorizeClinical(db, ctx, businessId, true);
      const client = await findPatient(db, businessId, clientId);
      const previous = await one<{ consentDate: string | null }>(
        db,
        'select consent_date as "consentDate" from clinical_profiles where client_id = $1',
        [clientId],
      );
      // El consentimiento se fecha hoy la primera vez que se marca; después la fecha no cambia
      // ni se quita (lo garantiza también un trigger de la base de datos).
      const consentDate = data.consentSigned ? await businessToday(db, businessId) : null;
      const profile = (await one<ClinicalProfile>(
        db,
        `insert into clinical_profiles
           (business_id, client_id, document_id, birth_date, sex, blood_type, emergency_contact, allergies,
            conditions, medications, surgeries, family_history, consent_date, updated_at, updated_by_name)
         values ($1, $2, $3, nullif($4, '')::date, $5, $6, $7, $8, $9, $10, $11, $12, $13::date, now(), $14)
         on conflict (client_id) do update set
           document_id = excluded.document_id, birth_date = excluded.birth_date, sex = excluded.sex,
           blood_type = excluded.blood_type, emergency_contact = excluded.emergency_contact,
           allergies = excluded.allergies, conditions = excluded.conditions, medications = excluded.medications,
           surgeries = excluded.surgeries, family_history = excluded.family_history,
           consent_date = coalesce(clinical_profiles.consent_date, excluded.consent_date),
           updated_at = now(), updated_by_name = excluded.updated_by_name
         returning ${clinicalProfileColumns()}`,
        [
          businessId,
          clientId,
          data.documentId,
          data.birthDate,
          data.sex,
          data.bloodType,
          data.emergencyContact,
          data.allergies,
          data.conditions,
          data.medications,
          data.surgeries,
          data.familyHistory,
          consentDate,
          actor.name,
        ],
      ))!;
      await logAudit(db, {
        businessId,
        actor,
        action: "clinical_record.profile_updated",
        entityType: "clinical_record",
        entityId: clientId,
        summary:
          !previous?.consentDate && profile.consentDate
            ? `Actualizó los antecedentes de ${client.name} y registró su consentimiento informado`
            : `Actualizó los antecedentes de ${client.name}`,
      });
      return profile;
    });
  },

  async addNote(ctx: RequestContext, businessId: string, clientId: string, input: unknown): Promise<ClinicalNote> {
    const data = parseInput(clinicalNoteSchema, input);
    return transaction(async (db) => {
      const actor = await authorizeClinical(db, ctx, businessId, true);
      const client = await findPatient(db, businessId, clientId);
      if (data.appointmentId) {
        const appointment = isUuid(data.appointmentId)
          ? await one<{ clientId: string }>(
              db,
              'select client_id as "clientId" from appointments where id = $1 and business_id = $2',
              [data.appointmentId, businessId],
            )
          : null;
        if (!appointment) throw new AppError("not_found", "La cita no existe.");
        if (appointment.clientId !== clientId) throw new AppError("validation", "La cita es de otro paciente.");
      }
      const { id } = (await one<{ id: string }>(
        db,
        `insert into clinical_notes
           (business_id, client_id, appointment_id, date, reason, findings, diagnosis, treatment, indications,
            next_control, author_id, author_name)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         returning id`,
        [
          businessId,
          clientId,
          data.appointmentId,
          // La evolución lleva siempre la fecha de hoy: no se puede fechar con retraso.
          await businessToday(db, businessId),
          data.reason,
          data.findings,
          data.diagnosis,
          data.treatment,
          data.indications,
          data.nextControl,
          actor.userId,
          actor.name,
        ],
      ))!;
      await logAudit(db, {
        businessId,
        actor,
        action: "clinical_record.note_added",
        entityType: "clinical_record",
        entityId: clientId,
        summary: `Registró una evolución en la historia clínica de ${client.name}`,
      });
      return (await loadNotes(db, "id = $1", [id]))[0];
    });
  },

  /** Aclaración a una evolución: la nota original nunca se modifica. */
  async addAddendum(ctx: RequestContext, businessId: string, noteId: string, input: unknown): Promise<ClinicalNote> {
    const { text } = parseInput(clinicalAddendumSchema, input);
    return transaction(async (db) => {
      const actor = await authorizeClinical(db, ctx, businessId, true);
      const note = isUuid(noteId)
        ? await one<{ clientId: string; clientName: string }>(
            db,
            `select n.client_id as "clientId", c.name as "clientName"
               from clinical_notes n join clients c on c.id = n.client_id
              where n.id = $1 and n.business_id = $2`,
            [noteId, businessId],
          )
        : null;
      if (!note) throw new AppError("not_found", "Evolución no encontrada.");
      await db.query(
        "insert into clinical_note_addenda (note_id, business_id, text, author_id, author_name) values ($1, $2, $3, $4, $5)",
        [noteId, businessId, text, actor.userId, actor.name],
      );
      await logAudit(db, {
        businessId,
        actor,
        action: "clinical_record.addendum_added",
        entityType: "clinical_record",
        entityId: note.clientId,
        summary: `Añadió una aclaración a una evolución de ${note.clientName}`,
      });
      return (await loadNotes(db, "id = $1", [noteId]))[0];
    });
  },
};
