import { randomUUID } from "node:crypto";
import { clinicalAttachmentColumns } from "../db/columns.ts";
import { isUuid, one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { CLINICAL_ATTACHMENT_MAX_BYTES, clinicalAttachmentInputSchema } from "../shared/lib/validations/clinical.ts";
import type { ClinicalAttachment, ClinicalAttachmentUpload } from "../shared/types/index.ts";
import { logAudit } from "./audit.ts";
import { authorizeClinical, findPatient } from "./clinical-service.ts";
import { parseInput, type RequestContext } from "./context.ts";
import { fileStorage, type FileStorage } from "./file-storage.ts";
import { planOf } from "./plan-limits.ts";

/**
 * Archivos de la historia clínica (planes Pro y Business). El navegador sube el archivo directo al
 * almacenamiento con una URL firmada; luego la API comprueba que llegó y lo da por subido.
 * No se borran: forman parte de la historia del paciente.
 */

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

function requireStorage(): FileStorage {
  if (!fileStorage) {
    throw new AppError("unavailable", "El almacenamiento de archivos no está configurado. Escribe a soporte.");
  }
  return fileStorage;
}

async function findAttachment(db: Db, businessId: string, attachmentId: string) {
  const attachment = isUuid(attachmentId)
    ? await one<{ clientId: string; clientName: string; fileName: string; storagePath: string; status: string; sizeBytes: number }>(
        db,
        `select a.client_id as "clientId", c.name as "clientName", a.file_name as "fileName", a.storage_path as "storagePath",
                a.status, a.size_bytes as "sizeBytes"
           from clinical_attachments a join clients c on c.id = a.client_id
          where a.id = $1 and a.business_id = $2`,
        [attachmentId, businessId],
      )
    : null;
  if (!attachment) throw new AppError("not_found", "Archivo no encontrado.");
  return attachment;
}

export const clinicalAttachmentService = {
  /** Registra el archivo (pendiente) y devuelve la URL firmada para subirlo. */
  async requestUpload(ctx: RequestContext, businessId: string, clientId: string, input: unknown): Promise<ClinicalAttachmentUpload> {
    const data = parseInput(clinicalAttachmentInputSchema, input);
    const storage = requireStorage();
    return transaction(async (db) => {
      const actor = await authorizeClinical(db, ctx, businessId, true);
      await findPatient(db, businessId, clientId);
      if (!(await planOf(db, businessId)).clinicalAttachments) {
        throw new AppError("plan_limit", "Los archivos en la historia clínica están en los planes Pro y Business.");
      }
      const id = randomUUID();
      // Ruta sin el nombre original (puede llevar datos del paciente): sólo ids y la extensión.
      const storagePath = `${businessId}/${clientId}/${id}.${EXTENSIONS[data.contentType]}`;
      const attachment = (await one<ClinicalAttachment>(
        db,
        `insert into clinical_attachments
           (id, business_id, client_id, file_name, content_type, size_bytes, description, storage_path, uploaded_by_id, uploaded_by_name)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         returning ${clinicalAttachmentColumns()}`,
        [id, businessId, clientId, data.fileName, data.contentType, data.sizeBytes, data.description, storagePath, actor.userId, actor.name],
      ))!;
      const upload = await storage.createUploadUrl(storagePath, data.contentType);
      return { attachment, upload: { url: upload.url, method: "PUT", headers: upload.headers } };
    });
  },

  /** El navegador terminó de subir: se comprueba que el archivo llegó y queda en la historia. */
  async completeUpload(ctx: RequestContext, businessId: string, attachmentId: string): Promise<ClinicalAttachment> {
    const storage = requireStorage();
    return transaction(async (db) => {
      const actor = await authorizeClinical(db, ctx, businessId, true);
      const attachment = await findAttachment(db, businessId, attachmentId);
      if (attachment.status === "pending") {
        const size = await storage.sizeOf(attachment.storagePath);
        if (size === null) throw new AppError("conflict", "El archivo no terminó de subirse. Vuelve a intentarlo.");
        if (size > CLINICAL_ATTACHMENT_MAX_BYTES) throw new AppError("validation", "El archivo supera los 15 MB.");
        await db.query("update clinical_attachments set status = 'ready', size_bytes = $2 where id = $1", [attachmentId, size]);
        await logAudit(db, {
          businessId,
          actor,
          action: "clinical_record.attachment_added",
          entityType: "clinical_record",
          entityId: attachment.clientId,
          summary: `Subió el archivo «${attachment.fileName}» a la historia clínica de ${attachment.clientName}`,
        });
      }
      return (await one<ClinicalAttachment>(
        db,
        `select ${clinicalAttachmentColumns()} from clinical_attachments where id = $1`,
        [attachmentId],
      ))!;
    });
  },

  /** URL de unos minutos para ver o descargar el archivo. */
  async downloadUrl(ctx: RequestContext, businessId: string, attachmentId: string): Promise<{ url: string }> {
    const storage = requireStorage();
    return transaction(async (db) => {
      const actor = await authorizeClinical(db, ctx, businessId);
      const attachment = await findAttachment(db, businessId, attachmentId);
      if (attachment.status !== "ready") throw new AppError("not_found", "Archivo no encontrado.");
      const url = await storage.createDownloadUrl(attachment.storagePath, attachment.fileName);
      // Datos de salud: también queda quién abre cada archivo.
      await logAudit(db, {
        businessId,
        actor,
        action: "clinical_record.attachment_opened",
        entityType: "clinical_record",
        entityId: attachment.clientId,
        summary: `Abrió el archivo «${attachment.fileName}» de la historia clínica de ${attachment.clientName}`,
      });
      return { url };
    });
  },
};

/** Subidas que nunca se completaron (más de un día): se olvidan. Lo llama el cron. */
export async function deleteStalePendingAttachments(): Promise<void> {
  await pool.query("delete from clinical_attachments where status = 'pending' and created_at < now() - interval '1 day'");
}
