import { many, one, transaction } from "../db/pool.ts";
import { DEFAULT_TIMEZONE } from "../shared/lib/constants/app.ts";
import { clientRequiredFieldsOf } from "../shared/lib/constants/business.ts";
import {
  classifyImportRows,
  clientImportSchema,
  importSummary,
  prepareImportRow,
  type ImportExistingClient,
} from "../shared/lib/validations/client-import.ts";
import type { ClientImportResult, ClientRequiredFields } from "../shared/types/index.ts";
import { logAudit } from "./audit.ts";
import { authorize, parseInput, type RequestContext } from "./context.ts";
import { remainingClientSlots } from "./plan-limits.ts";

/**
 * Importar pacientes desde un Excel o un CSV (spec 012). El archivo se lee en el navegador: aquí sólo
 * llegan los datos de cada fila, que se vuelven a revisar con el mismo código que la revisión del panel
 * (classifyImportRows). Todo o nada, en una transacción con el negocio bloqueado: si se corta la
 * conexión, o se importaron todos o ninguno, y repetir la importación no duplica (lo que ya entró
 * cuenta como «ya existía»). Un paciente que ya existe no se toca. Nunca se registran las filas ni sus
 * valores, y no sale ningún email. Con `includeIncomplete` («Importar también los que tienen datos por
 * completar», ampliación del 2026-10-15) también se crean las filas a las que les falta un dato
 * obligatorio del negocio: basta el nombre y quedan «Por completar». Sin él (o si no viene), como antes.
 */
export const clientImportService = {
  async importMany(ctx: RequestContext, businessId: string, input: unknown): Promise<ClientImportResult> {
    return transaction(async (db) => {
      // El bloqueo pone una importación detrás de otra (un doble clic, dos pestañas) y detrás de las
      // altas y reservas de ese negocio: nadie se cuela en el último cupo del plan.
      const actor = await authorize(db, ctx, businessId, "clients.import", { lock: true });
      const { rows, includeIncomplete } = parseInput(clientImportSchema, input);
      const business = await one<{ timezone: string; clientRequiredFields: ClientRequiredFields }>(
        db,
        `select timezone, client_required_fields as "clientRequiredFields" from businesses where id = $1`,
        [businessId],
      );
      const timezone = business?.timezone ?? DEFAULT_TIMEZONE;
      // Los que pueden coincidir: los que tienen alguna de las cédulas del archivo y los que no tienen
      // cédula (se comparan por nombre, email y teléfono).
      const documentIds = [...new Set(rows.map((row) => prepareImportRow(row, timezone).documentId).filter(Boolean))];
      const existing = await many<ImportExistingClient>(
        db,
        `select id, document_id as "documentId", name, email, phone from clients
          where business_id = $1 and (document_id = '' or document_id = any($2::text[]))`,
        [businessId, documentIds],
      );
      const { newClients, ...result } = classifyImportRows(rows, {
        required: clientRequiredFieldsOf(business),
        timezone,
        existing,
        remaining: await remainingClientSlots(db, businessId),
        allowIncomplete: includeIncomplete,
      });
      if (newClients.length > 0) {
        // Una sola sentencia, con un solo now(): todos quedan con el mismo created_at que la entrada de
        // la actividad. Con el bloqueo no debería chocar con el índice único de la cédula; si choca, esa
        // fila cuenta como «ya existía» en vez de fallar.
        const inserted = await many<{ documentId: string }>(
          db,
          `insert into clients (business_id, name, document_id, email, phone, address, notes, is_active, created_by, source)
           select $1, r.name, r.document_id, r.email, r.phone, r.address, r.notes, true, $2, 'import'
             from jsonb_to_recordset($3::jsonb) as r(name text, document_id text, email text, phone text, address text, notes text)
           on conflict (business_id, document_id) where document_id <> '' do nothing
           returning document_id as "documentId"`,
          [
            businessId,
            actor.userId,
            JSON.stringify(
              newClients.map((client) => ({
                name: client.name,
                document_id: client.documentId,
                email: client.email,
                phone: client.phone,
                address: client.address,
                notes: client.notes,
              })),
            ),
          ],
        );
        result.created = inserted.length;
        if (inserted.length < newClients.length) {
          const insertedDocuments = new Set(inserted.map((row) => row.documentId));
          const skipped = newClients.filter((client) => client.documentId && !insertedDocuments.has(client.documentId));
          const owners = await many<{ id: string; documentId: string }>(
            db,
            `select id, document_id as "documentId" from clients where business_id = $1 and document_id = any($2::text[])`,
            [businessId, skipped.map((client) => client.documentId)],
          );
          const moved = new Set<number>();
          for (const client of skipped) {
            const owner = owners.find((row) => row.documentId === client.documentId);
            if (owner) {
              result.existing.push({ row: client.row, clientId: owner.id });
              moved.add(client.row);
            }
          }
          result.existing.sort((a, b) => a.row - b.row);
          // Una fila «por completar» que resultó ser de un paciente que ya existía no se creó.
          result.incomplete = result.incomplete.filter((entry) => !moved.has(entry.row));
        }
      }
      // Si todo ya existía (o tenía errores), no queda entrada ni aviso, como cuando sólo se consulta.
      if (result.created > 0) {
        await logAudit(db, {
          businessId,
          actor,
          action: "client.imported",
          entityType: "client",
          entityId: null,
          summary: importSummary(result),
        });
      }
      return result;
    });
  },
};
