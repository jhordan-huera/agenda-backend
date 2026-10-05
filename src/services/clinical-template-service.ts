import { randomUUID } from "node:crypto";
import { one, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { hasPermission } from "../shared/lib/permissions.ts";
import { clinicalTemplateInputSchema } from "../shared/lib/validations/clinical.ts";
import type { ClinicalField, ClinicalTemplate } from "../shared/types/index.ts";
import { logAudit } from "./audit.ts";
import { authorizeClinical, availableTemplates } from "./clinical-service.ts";
import { parseInput, type Actor, type RequestContext } from "./context.ts";
import { planOf } from "./plan-limits.ts";

/**
 * Formatos de historia clínica propios de un negocio (planes de pago). Los gestiona el
 * propietario (o el super admin en modo soporte). Guardar cambios crea una versión nueva:
 * las evoluciones ya escritas conservan la suya.
 */

const MAX_OWN_TEMPLATES = 30;

async function authorizeManager(db: Db, ctx: RequestContext, businessId: string): Promise<Actor> {
  const actor = await authorizeClinical(db, ctx, businessId, true);
  if (!hasPermission(actor.role, "business.manage")) {
    throw new AppError("forbidden", "Sólo el propietario del negocio gestiona los formatos de historia clínica.");
  }
  return actor;
}

async function assertPlanAllowsEditing(db: Db, businessId: string): Promise<void> {
  if (!(await planOf(db, businessId)).customClinicalTemplates) {
    throw new AppError("plan_limit", "Crear y adaptar formatos de historia clínica está en los planes Pro y Business.");
  }
}

async function ownTemplate(db: Db, businessId: string, templateId: string) {
  const template = await one<{ name: string; description: string; isActive: boolean; version: number; fields: ClinicalField[] }>(
    db,
    `select t.name, t.description, t.is_active as "isActive", v.version, v.fields
       from clinical_templates t join clinical_template_versions v on v.id = t.current_version_id
      where t.id = $1 and t.business_id = $2`,
    [templateId, businessId],
  );
  if (!template) throw new AppError("not_found", "Formato no encontrado. Los formatos de la plataforma no se editan: duplícalos.");
  return template;
}

/**
 * JSON con las claves ordenadas: PostgreSQL (jsonb) reordena las claves, así que comparar el texto
 * tal cual daría "cambiado" aunque los campos sean idénticos.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Un campo que ya existía conserva su tipo: si no, sus valores antiguos se leerían mal. */
function assertSameTypes(previous: ClinicalField[], next: ClinicalField[]): void {
  for (const field of next) {
    const before = previous.find((old) => old.id === field.id);
    if (before && before.type !== field.type) {
      throw new AppError("validation", `«${field.label}» ya existía con otro tipo. Para cambiarlo, quítalo y añade un campo nuevo.`);
    }
  }
}

async function insertVersion(db: Db, templateId: string, version: number, name: string, fields: ClinicalField[], actor: Actor) {
  const id = randomUUID();
  await db.query(
    `insert into clinical_template_versions (id, template_id, version, name, fields, created_by_name)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, templateId, version, name, JSON.stringify(fields), actor.name],
  );
  return id;
}

async function findTemplate(db: Db, businessId: string, templateId: string): Promise<ClinicalTemplate> {
  const [template] = await availableTemplates(db, businessId, { includeInactive: true, templateId });
  if (!template) throw new AppError("not_found", "Formato no encontrado.");
  return template;
}

export const clinicalTemplateService = {
  /** Un formato (de la plataforma o propio, también desactivado): para verlo, editarlo o duplicarlo. */
  async get(ctx: RequestContext, businessId: string, templateId: string): Promise<ClinicalTemplate> {
    return transaction(async (db) => {
      await authorizeClinical(db, ctx, businessId);
      return findTemplate(db, businessId, templateId);
    });
  },

  async create(ctx: RequestContext, businessId: string, input: unknown): Promise<ClinicalTemplate> {
    const data = parseInput(clinicalTemplateInputSchema, input);
    return transaction(async (db) => {
      const actor = await authorizeManager(db, ctx, businessId);
      await assertPlanAllowsEditing(db, businessId);
      const count = await one<{ count: number }>(db, "select count(*)::int as count from clinical_templates where business_id = $1", [
        businessId,
      ]);
      if ((count?.count ?? 0) >= MAX_OWN_TEMPLATES) {
        throw new AppError("conflict", `Puedes tener hasta ${MAX_OWN_TEMPLATES} formatos propios. Desactiva o reutiliza alguno.`);
      }
      const templateId = randomUUID();
      // La referencia a la versión vigente es diferida: plantilla y versión en la misma transacción.
      const versionId = randomUUID();
      await db.query(
        `insert into clinical_templates (id, business_id, name, description, current_version_id)
         values ($1, $2, $3, $4, $5)`,
        [templateId, businessId, data.name, data.description, versionId],
      );
      await db.query(
        `insert into clinical_template_versions (id, template_id, version, name, fields, created_by_name)
         values ($1, $2, 1, $3, $4, $5)`,
        [versionId, templateId, data.name, JSON.stringify(data.fields), actor.name],
      );
      await logAudit(db, {
        businessId,
        actor,
        action: "clinical_template.created",
        entityType: "business",
        entityId: businessId,
        summary: `Creó el formato de historia clínica «${data.name}»`,
      });
      return findTemplate(db, businessId, templateId);
    });
  },

  /** Guarda cambios: si cambian los campos o el nombre, crea la versión siguiente. */
  async update(ctx: RequestContext, businessId: string, templateId: string, input: unknown): Promise<ClinicalTemplate> {
    const data = parseInput(clinicalTemplateInputSchema, input);
    return transaction(async (db) => {
      const actor = await authorizeManager(db, ctx, businessId);
      await assertPlanAllowsEditing(db, businessId);
      const current = await ownTemplate(db, businessId, templateId);
      assertSameTypes(current.fields, data.fields);
      const changed = current.name !== data.name || canonicalJson(current.fields) !== canonicalJson(data.fields);
      if (changed) {
        const versionId = await insertVersion(db, templateId, current.version + 1, data.name, data.fields, actor);
        await db.query("update clinical_templates set current_version_id = $2 where id = $1", [templateId, versionId]);
      }
      await db.query("update clinical_templates set name = $2, description = $3, updated_at = now() where id = $1", [
        templateId,
        data.name,
        data.description,
      ]);
      await logAudit(db, {
        businessId,
        actor,
        action: "clinical_template.updated",
        entityType: "business",
        entityId: businessId,
        summary: changed
          ? `Modificó el formato «${data.name}» (versión ${current.version + 1})`
          : `Actualizó la descripción del formato «${data.name}»`,
      });
      return findTemplate(db, businessId, templateId);
    });
  },

  /** Desactivar oculta el formato al registrar evoluciones; las ya escritas se siguen viendo. */
  async setActive(ctx: RequestContext, businessId: string, templateId: string, active: unknown): Promise<ClinicalTemplate> {
    if (typeof active !== "boolean") throw new AppError("validation", "Indica si el formato queda activo.");
    return transaction(async (db) => {
      const actor = await authorizeManager(db, ctx, businessId);
      const template = await ownTemplate(db, businessId, templateId);
      await db.query("update clinical_templates set is_active = $2, updated_at = now() where id = $1", [templateId, active]);
      // Si era el formato del negocio, vuelve a usarse el recomendado para la especialidad.
      const wasDefault =
        !active &&
        (await db.query(
          "update businesses set clinical_default_template_id = null where id = $1 and clinical_default_template_id = $2",
          [businessId, templateId],
        )).rowCount === 1;
      await logAudit(db, {
        businessId,
        actor,
        action: "clinical_template.updated",
        entityType: "business",
        entityId: businessId,
        summary: `${active ? "Activó" : "Desactivó"} el formato «${template.name}»${wasDefault ? " (era el formato del negocio)" : ""}`,
      });
      return findTemplate(db, businessId, templateId);
    });
  },

  /**
   * El formato que se propone en todas las evoluciones nuevas del negocio: uno de la plataforma o
   * uno propio activo. No depende del plan (un formato propio se sigue usando en el plan Free).
   */
  async setDefault(ctx: RequestContext, businessId: string, templateId: unknown): Promise<ClinicalTemplate> {
    if (typeof templateId !== "string" || !templateId) throw new AppError("validation", "Indica el formato.");
    return transaction(async (db) => {
      const actor = await authorizeManager(db, ctx, businessId);
      const template = await findTemplate(db, businessId, templateId);
      if (!template.isActive) throw new AppError("validation", "Activa el formato antes de usarlo en todo el negocio.");
      await db.query("update businesses set clinical_default_template_id = $2 where id = $1", [businessId, template.id]);
      await logAudit(db, {
        businessId,
        actor,
        action: "clinical_template.updated",
        entityType: "business",
        entityId: businessId,
        summary: `Eligió «${template.name}» como formato de historia clínica de todo el negocio`,
      });
      return findTemplate(db, businessId, templateId);
    });
  },
};
