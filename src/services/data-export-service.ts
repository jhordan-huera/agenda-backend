import { clinicalAttachmentColumns, clinicalProfileColumns } from "../db/columns.ts";
import { isUuid, many, one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { DATA_EXPORT_BLOCKED_MESSAGE } from "../shared/lib/constants/business.ts";
import { formatCount, joinNames } from "../shared/lib/format.ts";
import type {
  ClinicalAttachment,
  ClinicalProfile,
  DataExportAppointment,
  DataExportClient,
  DataExportClinical,
  DataExportClinicalPage,
  DataExportClinicalRecord,
  DataExportPage,
  DataExportSummary,
} from "../shared/types/index.ts";
import { agendaScope, ownClientCondition } from "./agenda-scope.ts";
import { logAudit } from "./audit.ts";
import { requireStorage } from "./clinical-attachment-service.ts";
import { loadNotes, loadTemplateVersions } from "./clinical-service.ts";
import { authorize, type Actor, type RequestContext } from "./context.ts";

/**
 * Descargar los datos del negocio (spec 028). El ZIP se arma en el navegador con estas partes: la API no
 * guarda nada de la descarga, salvo su entrada en la actividad (una por descarga, al pedir el resumen).
 * - El propietario se lleva todo el negocio.
 * - El rol Profesional, lo de su agenda: sus pacientes, con la regla de «sólo sus pacientes»
 *   (ownClientCondition) aunque el negocio esté en «todos», y las citas de su agenda.
 * - Las historias clínicas y sus archivos, sólo con acceso clínico (el propietario siempre; el profesional,
 *   si el propietario se lo dio) y con la historia activada. Leerlas aquí no deja «Consultó la historia
 *   clínica» por paciente, ni pedir el enlace de un archivo «Abrió el archivo»: la descarga ya quedó
 *   registrada.
 * - Nadie más: ni el super admin, tampoco en modo soporte, ni el administrador ni la recepción
 *   (constitución, principio III).
 * Cada parte es corta para que ninguna respuesta se acerque al tope de 6 MB de Lambda, y se pide con el
 * cursor de la anterior (el id de su último registro: un orden que no cambia aunque cambien los datos).
 */

/** Pacientes por parte. */
const CLIENTS_PAGE = 500;
/** Citas por parte. */
const APPOINTMENTS_PAGE = 1000;
/** Pacientes por parte de las historias clínicas. */
const CLINICAL_PAGE = 50;
/**
 * Evoluciones por parte de las historias, como mucho (salvo un paciente que tenga más él solo): con
 * pacientes de cientos de evoluciones, 50 historias podrían pasar de los 6 MB.
 */
const CLINICAL_PAGE_NOTES = 1000;

/** Quién descarga y qué se lleva. */
interface ExportAccess {
  actor: Actor;
  businessId: string;
  /** Su agenda (el rol Profesional); null: todo el negocio (el propietario). */
  agenda: { professionalId: string; userId: string } | null;
  clinical: DataExportClinical;
}

/**
 * El propietario, todo el negocio; el rol Profesional, su agenda. El super admin (también en modo
 * soporte), el administrador y la recepción, `forbidden` con el mensaje de privacidad: no reciben nada.
 */
async function authorizeExport(db: Db, ctx: RequestContext, businessId: string): Promise<ExportAccess> {
  const actor = await authorize(db, ctx, businessId);
  if (actor.support || (actor.role !== "owner" && actor.role !== "professional")) {
    throw new AppError("forbidden", DATA_EXPORT_BLOCKED_MESSAGE);
  }
  let agenda: ExportAccess["agenda"] = null;
  if (actor.role === "professional") {
    // Sin agenda asignada, el mismo aviso que en el resto del panel.
    const { professionalId } = await agendaScope(db, actor, businessId);
    agenda = { professionalId: professionalId!, userId: actor.userId };
  }
  const access = await one<{ enabled: boolean; clinicalAccess: boolean | null }>(
    db,
    `select b.clinical_records_enabled as enabled, bu.clinical_access as "clinicalAccess"
       from businesses b left join business_users bu on bu.business_id = b.id and bu.user_id = $2
      where b.id = $1`,
    [businessId, actor.userId],
  );
  const clinical: DataExportClinical = !access?.enabled
    ? "disabled"
    : actor.role === "owner" || access.clinicalAccess
      ? "included"
      : "no_access";
  return { actor, businessId, agenda, clinical };
}

/** Lo clínico se pide sólo si la descarga lo lleva; si no, los avisos de siempre. */
function assertClinical(access: ExportAccess): void {
  if (access.clinical === "disabled") throw new AppError("forbidden", "La historia clínica no está activada en este negocio.");
  if (access.clinical === "no_access") {
    throw new AppError("forbidden", "No tienes acceso a las historias clínicas. Pide al propietario que te lo habilite.");
  }
}

/** Los pacientes que se lleva (alias `c`): $1 es el negocio y, para el profesional, $2 y $3 su agenda y su usuario. */
function clientScope(access: ExportAccess): { where: string; values: unknown[] } {
  if (!access.agenda) return { where: "c.business_id = $1", values: [access.businessId] };
  return {
    where: `c.business_id = $1 and ${ownClientCondition("c", 2, 3)}`,
    values: [access.businessId, access.agenda.professionalId, access.agenda.userId],
  };
}

/** Las citas que se lleva (alias `a`): todas las del negocio o las de su agenda. */
function appointmentScope(access: ExportAccess): { where: string; values: unknown[] } {
  if (!access.agenda) return { where: "a.business_id = $1", values: [access.businessId] };
  return { where: "a.business_id = $1 and a.professional_id = $2", values: [access.businessId, access.agenda.professionalId] };
}

/** El paciente `c` tiene historia: antecedentes, alguna evolución o algún archivo ya subido. */
const HAS_CLINICAL_RECORD = `(exists (select 1 from clinical_profiles cp where cp.client_id = c.id)
  or exists (select 1 from clinical_notes cn where cn.client_id = c.id)
  or exists (select 1 from clinical_attachments ca where ca.client_id = c.id and ca.status = 'ready'))`;

/** El cursor de la parte anterior (el id de su último registro); null: la primera. */
function parseCursor(cursor: string | undefined): string | null {
  if (cursor === undefined) return null;
  if (!isUuid(cursor)) throw new AppError("validation", "La descarga se desordenó. Vuelve a empezarla.");
  return cursor;
}

/** Una parte: las filas pedidas (una de más dice si hay otra) y el cursor de la siguiente. */
function pageOf<T extends { id: string }>(rows: T[], size: number): DataExportPage<T> {
  const items = rows.slice(0, size);
  return { items, nextCursor: rows.length > size ? items[items.length - 1].id : null };
}

const countOf = (count: number, singular: string, pluralForm: string) =>
  `${formatCount(count)} ${count === 1 ? singular : pluralForm}`;

export const dataExportService = {
  /**
   * Qué trae la descarga y cuánto. Cada descarga empieza aquí: queda en la actividad con las cifras,
   * «Descargó los datos del negocio (340 pacientes, 1.250 citas y 85 historias clínicas)» o, el
   * profesional, «Descargó sus datos (…)».
   */
  async summary(ctx: RequestContext, businessId: string): Promise<DataExportSummary> {
    return transaction(async (db) => {
      const access = await authorizeExport(db, ctx, businessId);
      const clients = clientScope(access);
      const appointments = appointmentScope(access);
      const included = access.clinical === "included";
      const business = (await one<DataExportSummary["business"]>(
        db,
        "select name, slug, timezone, currency, address, phone from businesses where id = $1",
        [businessId],
      ))!;
      const counts = (await one<DataExportSummary["counts"]>(
        db,
        `select (select count(*)::int from clients c where ${clients.where}) as clients,
                (select count(*)::int from clients c where ${clients.where} and $${clients.values.length + 1}::boolean
                    and ${HAS_CLINICAL_RECORD}) as "clinicalRecords",
                (select count(*)::int from clinical_attachments ca join clients c on c.id = ca.client_id
                  where ${clients.where} and $${clients.values.length + 1}::boolean and ca.status = 'ready') as attachments`,
        [...clients.values, included],
      ))!;
      const appointmentCount = (await one<{ count: number }>(
        db,
        `select count(*)::int as count from appointments a where ${appointments.where}`,
        appointments.values,
      ))!.count;
      const result = { ...counts, appointments: appointmentCount };
      const parts = [
        countOf(result.clients, "paciente", "pacientes"),
        countOf(result.appointments, "cita", "citas"),
        ...(included ? [countOf(result.clinicalRecords, "historia clínica", "historias clínicas")] : []),
      ];
      await logAudit(db, {
        businessId,
        actor: access.actor,
        action: "business.data_exported",
        entityType: "business",
        entityId: businessId,
        summary: `${access.agenda ? "Descargó sus datos" : "Descargó los datos del negocio"} (${joinNames(parts)})`,
      });
      return {
        scope: access.agenda ? "agenda" : "business",
        business,
        exportedBy: access.actor.name,
        exportedAt: new Date().toISOString(),
        clinical: access.clinical,
        counts: result,
      };
    });
  },

  /** pacientes.xlsx, de 500 en 500, con todos sus datos (son del negocio: nada a medias). */
  async clients(ctx: RequestContext, businessId: string, rawCursor?: string): Promise<DataExportPage<DataExportClient>> {
    const cursor = parseCursor(rawCursor);
    const access = await authorizeExport(pool, ctx, businessId);
    const scope = clientScope(access);
    const rows = await many<DataExportClient>(
      pool,
      `select c.id, c.name, c.document_id as "documentId", c.email, c.phone, c.address, c.notes, c.is_active as "isActive",
              c.claimed_client_id is not null as "pendingVerification", c.created_at as "createdAt"
         from clients c
        where ${scope.where} and ($${scope.values.length + 1}::uuid is null or c.id > $${scope.values.length + 1}::uuid)
        order by c.id
        limit ${CLIENTS_PAGE + 1}`,
      [...scope.values, cursor],
    );
    return pageOf(rows, CLIENTS_PAGE);
  },

  /** citas.xlsx, de 1000 en 1000, con los nombres de sus pacientes, del servicio y de la agenda. */
  async appointments(ctx: RequestContext, businessId: string, rawCursor?: string): Promise<DataExportPage<DataExportAppointment>> {
    const cursor = parseCursor(rawCursor);
    const access = await authorizeExport(pool, ctx, businessId);
    const scope = appointmentScope(access);
    const rows = await many<DataExportAppointment>(
      pool,
      `select a.id, a.date, a.start_time as "startTime", a.end_time as "endTime", a.status,
              array[c.name] || coalesce((select array_agg(xc.name order by ac.created_at, ac.client_id)
                                           from appointment_clients ac join clients xc on xc.id = ac.client_id
                                          where ac.appointment_id = a.id), '{}') as clients,
              coalesce(s.name, '') as service, coalesce(p.display_name, '') as professional,
              case when a.home_visit is not null then 'home' when a.is_virtual then 'virtual' else 'business' end as modality,
              coalesce(a.home_visit->>'address', '') as "homeAddress",
              a.price, a.paid_at is not null as paid, a.notes
         from appointments a
         join clients c on c.id = a.client_id
         left join services s on s.id = a.service_id
         left join professionals p on p.id = a.professional_id
        where ${scope.where} and ($${scope.values.length + 1}::uuid is null or a.id > $${scope.values.length + 1}::uuid)
        order by a.id
        limit ${APPOINTMENTS_PAGE + 1}`,
      [...scope.values, cursor],
    );
    return pageOf(rows, APPOINTMENTS_PAGE);
  },

  /**
   * Las historias clínicas, de 50 pacientes en 50 (menos si traen muchas evoluciones): antecedentes y
   * consentimiento, las evoluciones con su formato y sus aclaraciones, y los datos de sus archivos. No
   * registra «Consultó la historia clínica»: la descarga ya quedó en la actividad.
   */
  async clinical(ctx: RequestContext, businessId: string, rawCursor?: string): Promise<DataExportClinicalPage> {
    const cursor = parseCursor(rawCursor);
    const access = await authorizeExport(pool, ctx, businessId);
    assertClinical(access);
    const scope = clientScope(access);
    const candidates = await many<DataExportClinicalRecord["client"] & { notes: number }>(
      pool,
      `select c.id, c.name, c.document_id as "documentId", c.email, c.phone, c.address,
              (select count(*)::int from clinical_notes n where n.client_id = c.id) as notes
         from clients c
        where ${scope.where} and ${HAS_CLINICAL_RECORD}
          and ($${scope.values.length + 1}::uuid is null or c.id > $${scope.values.length + 1}::uuid)
        order by c.id
        limit ${CLINICAL_PAGE + 1}`,
      [...scope.values, cursor],
    );
    const patients: DataExportClinicalRecord["client"][] = [];
    let noteCount = 0;
    for (const { notes: patientNotes, ...patient } of candidates.slice(0, CLINICAL_PAGE)) {
      if (patients.length > 0 && noteCount + patientNotes > CLINICAL_PAGE_NOTES) break;
      patients.push(patient);
      noteCount += patientNotes;
    }
    const ids = patients.map((patient) => patient.id);
    const [profiles, notes, attachments] = await Promise.all([
      many<ClinicalProfile>(
        pool,
        `select ${clinicalProfileColumns()} from clinical_profiles where business_id = $1 and client_id = any($2::uuid[])`,
        [businessId, ids],
      ),
      loadNotes(pool, "business_id = $1 and client_id = any($2::uuid[])", [businessId, ids]),
      many<ClinicalAttachment>(
        pool,
        `select ${clinicalAttachmentColumns()} from clinical_attachments
          where business_id = $1 and client_id = any($2::uuid[]) and status = 'ready' order by created_at, id`,
        [businessId, ids],
      ),
    ]);
    const appointmentIds = [...new Set(notes.flatMap((note) => (note.appointmentId ? [note.appointmentId] : [])))];
    const [services, templateVersions] = await Promise.all([
      appointmentIds.length === 0
        ? []
        : many<{ id: string; name: string }>(
            pool,
            "select a.id, s.name from appointments a join services s on s.id = a.service_id where a.id = any($1::uuid[])",
            [appointmentIds],
          ),
      loadTemplateVersions(
        pool,
        notes.map((note) => note.templateVersionId),
      ),
    ]);
    const serviceOf = new Map(services.map((service) => [service.id, service.name]));
    // loadNotes las trae de la más reciente a la más antigua; la historia se lee al revés, como al imprimirla.
    const chronological = notes.toReversed();
    return {
      items: patients.map((client) => ({
        client,
        profile: profiles.find((profile) => profile.clientId === client.id) ?? null,
        notes: chronological
          .filter((note) => note.clientId === client.id)
          .map((note) => ({ ...note, serviceName: (note.appointmentId && serviceOf.get(note.appointmentId)) || null })),
        attachments: attachments.filter((attachment) => attachment.clientId === client.id),
      })),
      nextCursor: candidates.length > patients.length ? patients[patients.length - 1].id : null,
      templateVersions,
    };
  },

  /**
   * El enlace de unos minutos de un archivo de la historia, para meterlo en el ZIP: sólo de un paciente
   * que esa persona se lleva (si no, como si no existiera) y sin registrar cada apertura.
   */
  async attachmentUrl(ctx: RequestContext, businessId: string, attachmentId: string): Promise<{ url: string }> {
    const access = await authorizeExport(pool, ctx, businessId);
    assertClinical(access);
    const scope = clientScope(access);
    const attachment = isUuid(attachmentId)
      ? await one<{ fileName: string; storagePath: string }>(
          pool,
          `select a.file_name as "fileName", a.storage_path as "storagePath"
             from clinical_attachments a join clients c on c.id = a.client_id
            where a.id = $${scope.values.length + 1} and a.business_id = $1 and a.status = 'ready' and ${scope.where}`,
          [...scope.values, attachmentId],
        )
      : null;
    if (!attachment) throw new AppError("not_found", "Archivo no encontrado.");
    return { url: await requireStorage().createDownloadUrl(attachment.storagePath, attachment.fileName) };
  },
};
