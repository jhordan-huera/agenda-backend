import { randomUUID } from "node:crypto";
import { z } from "zod";
import { appointmentColumns, paymentReceiptColumns } from "../db/columns.ts";
import { isUuid, many, one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { isPriceVisible } from "../shared/lib/format.ts";
import {
  RECEIPT_MAX_BYTES,
  RECEIPT_RETENTION_MONTHS,
  RECEIPTS_PER_APPOINTMENT,
  receiptInputSchema,
} from "../shared/lib/validations/payment.ts";
import type {
  Appointment,
  BankAccount,
  PaymentReceipt,
  PaymentReceiptUpload,
  PublicPayment,
} from "../shared/types/index.ts";
import { agendaScope, assertAppointmentInScope } from "./agenda-scope.ts";
import { describeAppointment, logAudit } from "./audit.ts";
import { authorize, parseInput, type RequestContext } from "./context.ts";
import { receiptStorage, type FileStorage } from "./file-storage.ts";
import { notifyReceiptReceived } from "./notifications.ts";
import { greetingName } from "./public-booking-service.ts";

/**
 * Pago por transferencia. Cada cita tiene un enlace privado (/pago/:token) donde el paciente ve
 * los datos bancarios de la agenda y sube la foto o el PDF del comprobante, sin sesión: el token es
 * la autorización. El archivo va directo del navegador al bucket privado de comprobantes; el
 * negocio lo abre con una URL firmada de unos minutos y marca la cita como pagada.
 */

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

/** A una cita cancelada o en la que el paciente no se presentó ya no se le envían comprobantes. */
const CLOSED_STATUSES = ["cancelled", "no_show"];

interface PaymentContext {
  appointment: Appointment;
  businessStatus: string;
  businessName: string;
  businessSlug: string;
  logoUrl: string | null;
  phone: string;
  timezone: string;
  currency: string;
  brandColors: PublicPayment["business"]["brandColors"];
  clientName: string;
  serviceName: string;
  showPrice: boolean;
  professionalName: string;
  bankAccount: BankAccount | null;
}

/** La cita de un enlace de pago (con su negocio, servicio y agenda); un enlace inválido no existe. */
async function findByToken(db: Db, token: string, lock = false): Promise<PaymentContext> {
  const appointment = /^[0-9a-f]{32}$/.test(token)
    ? await one<Appointment>(
        db,
        `select ${appointmentColumns()} from appointments where payment_token = $1${lock ? " for update" : ""}`,
        [token],
      )
    : null;
  const details = appointment
    ? await one<Omit<PaymentContext, "appointment">>(
        db,
        `select b.status as "businessStatus", b.name as "businessName", b.slug as "businessSlug", b.logo_url as "logoUrl",
                b.phone, b.timezone, b.currency, b.brand_colors as "brandColors", c.name as "clientName",
                s.name as "serviceName", s.show_price as "showPrice", p.display_name as "professionalName",
                p.bank_account as "bankAccount"
           from businesses b, clients c, services s, professionals p
          where b.id = $1 and c.id = $2 and s.id = $3 and p.id = $4`,
        [appointment.businessId, appointment.clientId, appointment.serviceId, appointment.professionalId],
      )
    : null;
  // Un negocio suspendido no se distingue de un enlace inexistente.
  if (!appointment || !details || details.businessStatus !== "active") {
    throw new AppError("not_found", "Este enlace de pago no existe o ya no está disponible.");
  }
  return { appointment, ...details };
}

function requireReceiptStorage(): FileStorage {
  if (!receiptStorage) {
    throw new AppError("unavailable", "Por ahora no se pueden subir comprobantes aquí: envíalo por WhatsApp al negocio.");
  }
  return receiptStorage;
}

const readyReceipts = (db: Db, appointmentId: string) =>
  many<PaymentReceipt>(
    db,
    `select ${paymentReceiptColumns()} from payment_receipts where appointment_id = $1 and status = 'ready' order by created_at`,
    [appointmentId],
  );

export const paymentService = {
  /* ---------------------------------------------- Página de pago (sin sesión) -- */

  async getPublic(token: string): Promise<PublicPayment> {
    const found = await findByToken(pool, token);
    const { appointment } = found;
    return {
      business: {
        name: found.businessName,
        slug: found.businessSlug,
        logoUrl: found.logoUrl,
        phone: found.phone,
        timezone: found.timezone,
        currency: found.currency,
        brandColors: found.brandColors,
      },
      clientName: greetingName(found.clientName),
      serviceName: found.serviceName,
      professionalName: found.professionalName,
      date: appointment.date,
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      status: appointment.status,
      amount: isPriceVisible(found) && appointment.price > 0 ? appointment.price : null,
      bankAccount: found.bankAccount,
      receipts: (await readyReceipts(pool, appointment.id)).map(({ id, fileName, createdAt }) => ({ id, fileName, createdAt })),
      paid: Boolean(appointment.paidAt),
      receiptsEnabled: Boolean(receiptStorage),
    };
  },

  /** Registra el comprobante (pendiente) y devuelve la URL firmada para subirlo. */
  async requestUpload(token: string, input: unknown): Promise<PaymentReceiptUpload> {
    const data = parseInput(receiptInputSchema, input);
    const storage = requireReceiptStorage();
    return transaction(async (db) => {
      const { appointment } = await findByToken(db, token, true);
      const { businessId } = appointment;
      if (CLOSED_STATUSES.includes(appointment.status)) {
        throw new AppError("conflict", "Esta cita ya no está activa. Si pagaste, escríbele al negocio.");
      }
      const sent = await one<{ ready: number; total: number }>(
        db,
        `select count(*) filter (where status = 'ready')::int as ready, count(*)::int as total
           from payment_receipts where appointment_id = $1`,
        [appointment.id],
      );
      // Unos pocos por cita (para corregir uno equivocado) y un tope de intentos sin terminar.
      if ((sent?.ready ?? 0) >= RECEIPTS_PER_APPOINTMENT || (sent?.total ?? 0) >= RECEIPTS_PER_APPOINTMENT * 2) {
        throw new AppError("conflict", "Ya enviaste varios comprobantes para esta cita. Si necesitas otro, escríbele al negocio.");
      }
      const id = randomUUID();
      const storagePath = `${businessId}/${appointment.id}/${id}.${EXTENSIONS[data.contentType]}`;
      const receipt = (await one<PaymentReceipt>(
        db,
        `insert into payment_receipts (id, business_id, appointment_id, file_name, content_type, size_bytes, storage_path)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning ${paymentReceiptColumns()}`,
        [id, businessId, appointment.id, data.fileName, data.contentType, data.sizeBytes, storagePath],
      ))!;
      const upload = await storage.createUploadUrl(storagePath, data.contentType);
      return { receipt, upload: { url: upload.url, method: "PUT", headers: upload.headers } };
    });
  },

  /** El navegador terminó de subir: se comprueba que el archivo llegó y se avisa al negocio. */
  async completeUpload(token: string, receiptId: string): Promise<PaymentReceipt> {
    const storage = requireReceiptStorage();
    const result = await transaction(async (db) => {
      const { appointment } = await findByToken(db, token, true);
      const receipt = isUuid(receiptId)
        ? await one<{ storagePath: string; status: string; fileName: string }>(
            db,
            `select storage_path as "storagePath", status, file_name as "fileName" from payment_receipts
              where id = $1 and appointment_id = $2 for update`,
            [receiptId, appointment.id],
          )
        : null;
      if (!receipt) throw new AppError("not_found", "Comprobante no encontrado.");
      if (receipt.status === "pending") {
        const size = await storage.sizeOf(receipt.storagePath);
        if (size === null) throw new AppError("conflict", "El comprobante no terminó de subirse. Vuelve a intentarlo.");
        if (size > RECEIPT_MAX_BYTES) {
          await db.query("delete from payment_receipts where id = $1", [receiptId]);
          return { receipt: null, tooLarge: receipt.storagePath };
        }
        await db.query("update payment_receipts set status = 'ready', size_bytes = $2 where id = $1", [receiptId, size]);
        const updated = (await one<Appointment>(
          db,
          `update appointments set receipt_at = now() where id = $1 returning ${appointmentColumns()}`,
          [appointment.id],
        ))!;
        await notifyReceiptReceived(db, updated);
        await logAudit(db, {
          businessId: appointment.businessId,
          actor: null,
          action: "appointment.receipt_received",
          entityType: "appointment",
          entityId: appointment.id,
          summary: `Comprobante de pago recibido de ${await describeAppointment(db, updated)}`,
        });
      }
      const ready = await one<PaymentReceipt>(db, `select ${paymentReceiptColumns()} from payment_receipts where id = $1`, [receiptId]);
      return { receipt: ready!, tooLarge: null };
    });
    if (!result.receipt) {
      await removeReceiptFiles([result.tooLarge]);
      throw new AppError("validation", "El archivo supera los 10 MB.");
    }
    return result.receipt;
  },

  /* ------------------------------------------------------------- Panel -- */

  /** Comprobantes de una cita (los ve quien ve la cita). */
  async listReceipts(ctx: RequestContext, businessId: string, appointmentId: string): Promise<PaymentReceipt[]> {
    const actor = await authorize(pool, ctx, businessId);
    const appointment = await findAppointment(pool, businessId, appointmentId);
    assertAppointmentInScope(await agendaScope(pool, actor, businessId), appointment);
    return readyReceipts(pool, appointmentId);
  },

  /** URL de unos minutos para ver o descargar el comprobante. */
  async receiptUrl(ctx: RequestContext, businessId: string, receiptId: string): Promise<{ url: string }> {
    const storage = requireReceiptStorage();
    const actor = await authorize(pool, ctx, businessId);
    const receipt = isUuid(receiptId)
      ? await one<{ appointmentId: string; storagePath: string; fileName: string }>(
          pool,
          `select appointment_id as "appointmentId", storage_path as "storagePath", file_name as "fileName"
             from payment_receipts where id = $1 and business_id = $2 and status = 'ready'`,
          [receiptId, businessId],
        )
      : null;
    if (!receipt) throw new AppError("not_found", "Comprobante no encontrado.");
    const appointment = await findAppointment(pool, businessId, receipt.appointmentId);
    assertAppointmentInScope(await agendaScope(pool, actor, businessId), appointment);
    return { url: await storage.createDownloadUrl(receipt.storagePath, receipt.fileName) };
  },

  /** Marca la cita como pagada (o lo deshace). */
  async setPaid(ctx: RequestContext, businessId: string, appointmentId: string, paid: unknown): Promise<Appointment> {
    const value = parseInput(z.boolean({ error: "Indica si la cita está pagada" }), paid);
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "appointments.manage", { lock: true });
      const before = await findAppointment(db, businessId, appointmentId);
      assertAppointmentInScope(await agendaScope(db, actor, businessId), before);
      const appointment = (await one<Appointment>(
        db,
        `update appointments set paid_at = ${value ? "coalesce(paid_at, now())" : "null"}, updated_at = now()
          where id = $1 returning ${appointmentColumns()}`,
        [appointmentId],
      ))!;
      if (Boolean(before.paidAt) !== value) {
        await logAudit(db, {
          businessId,
          actor,
          action: value ? "appointment.paid" : "appointment.payment_cleared",
          entityType: "appointment",
          entityId: appointmentId,
          summary: `${value ? "Marcó como pagada la cita de" : "Quitó el pago de la cita de"} ${await describeAppointment(db, appointment)}`,
        });
      }
      return appointment;
    });
  },
};

async function findAppointment(db: Db, businessId: string, appointmentId: string): Promise<Appointment> {
  const appointment = isUuid(appointmentId)
    ? await one<Appointment>(db, `select ${appointmentColumns()} from appointments where id = $1 and business_id = $2`, [
        appointmentId,
        businessId,
      ])
    : null;
  if (!appointment) throw new AppError("not_found", "Cita no encontrada.");
  return appointment;
}

/** Archivos de los comprobantes de unas citas (para borrarlos del almacenamiento con ellas). */
export async function receiptPaths(db: Db, where: { businessId?: string; clientId?: string }): Promise<string[]> {
  const rows = await many<{ storagePath: string }>(
    db,
    `select r.storage_path as "storagePath" from payment_receipts r join appointments a on a.id = r.appointment_id
      where ($1::uuid is null or r.business_id = $1::uuid) and ($2::uuid is null or a.client_id = $2::uuid)`,
    [where.businessId ?? null, where.clientId ?? null],
  );
  return rows.map((row) => row.storagePath);
}

/** Borra archivos de comprobantes ya sin registro. Después de confirmar el borrado; nunca falla. */
export async function removeReceiptFiles(paths: string[]): Promise<void> {
  if (!paths.length || !receiptStorage) return;
  await receiptStorage
    .remove(paths)
    .catch((error: unknown) => console.error("No se pudieron borrar los comprobantes:", error));
}

/** Comprobantes que se borran en cada ejecución del cron, como máximo. */
const PURGE_BATCH = 500;

/**
 * Comprobantes de citas de hace más de RECEIPT_RETENTION_MONTHS meses: se borran sus archivos y
 * sus registros (la cita conserva si está pagada y cuándo llegó el comprobante). Primero los
 * archivos: si Supabase falla, los registros quedan y se reintenta en la próxima ejecución. Lo
 * llama el cron; devuelve cuántos borró, o null si no hay almacenamiento configurado.
 */
export async function purgeOldReceipts(): Promise<number | null> {
  if (!receiptStorage) return null;
  const old = await many<{ id: string; storagePath: string }>(
    pool,
    `select r.id, r.storage_path as "storagePath" from payment_receipts r join appointments a on a.id = r.appointment_id
      where a.date < (now() - make_interval(months => $1))::date
      order by a.date limit $2`,
    [RECEIPT_RETENTION_MONTHS, PURGE_BATCH],
  );
  if (old.length === 0) return 0;
  await receiptStorage.remove(old.map((receipt) => receipt.storagePath));
  await pool.query("delete from payment_receipts where id = any($1::uuid[])", [old.map((receipt) => receipt.id)]);
  return old.length;
}

/** Subidas que nunca se completaron (más de un día): se olvidan. Lo llama el cron. */
export async function deleteStalePendingReceipts(): Promise<void> {
  await pool.query("delete from payment_receipts where status = 'pending' and created_at < now() - interval '1 day'");
}
