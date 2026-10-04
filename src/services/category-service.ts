import { categoryColumns } from "../db/columns.ts";
import { many, one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { slugify } from "../shared/lib/format.ts";
import { businessCategoryInputSchema } from "../shared/lib/validations/admin.ts";
import type { AdminBusinessCategory, BusinessCategoryInfo } from "../shared/types/index.ts";
import { logAudit } from "./audit.ts";
import { authorizeSuperAdmin, parseInput, type RequestContext } from "./context.ts";

/**
 * Categorías de negocio (tabla business_categories). Las crea y edita el super admin; los
 * negocios guardan su id. Una categoría en uso no se borra: se desactiva (deja de ofrecerse a
 * negocios nuevos y los que ya la tienen la conservan).
 */

export async function findCategory(db: Db, id: string): Promise<BusinessCategoryInfo | null> {
  return one<BusinessCategoryInfo>(db, `select ${categoryColumns()} from business_categories where id = $1`, [id]);
}

/** Categoría para asignar a un negocio: debe existir y estar activa (salvo que el negocio ya la tenga). */
export async function requireAssignableCategory(db: Db, id: string, currentCategory?: string): Promise<BusinessCategoryInfo> {
  const category = await findCategory(db, id);
  if (!category || (!category.isActive && id !== currentCategory)) {
    throw new AppError("validation", "Selecciona un tipo de negocio de la lista.");
  }
  return category;
}

/** Id estable a partir del nombre: "Peluquería canina" → "peluqueria_canina". */
async function uniqueCategoryId(db: Db, name: string): Promise<string> {
  const root = slugify(name).replace(/-/g, "_") || "categoria";
  let id = root;
  for (let suffix = 2; await one(db, "select 1 from business_categories where id = $1", [id]); suffix++) {
    id = `${root}_${suffix}`;
  }
  return id;
}

async function assertUniqueName(db: Db, name: string, excludeId?: string) {
  const duplicate = await one(
    db,
    "select 1 from business_categories where lower(name) = lower($1) and ($2::text is null or id <> $2)",
    [name, excludeId ?? null],
  );
  if (duplicate) throw new AppError("conflict", "Ya existe una categoría con ese nombre.");
}

export const categoryService = {
  /**
   * Pública (registro, onboarding, página de reservas): todas, con `isActive`. Los selectores
   * sólo ofrecen las activas, pero un negocio con una categoría desactivada sigue viendo su nombre.
   */
  listPublic(): Promise<BusinessCategoryInfo[]> {
    return many<BusinessCategoryInfo>(pool, `select ${categoryColumns()} from business_categories order by sort_order, name`);
  },

  /** Todas, con cuántos negocios usan cada una. Incluye las inactivas. */
  async listForAdmin(ctx: RequestContext): Promise<AdminBusinessCategory[]> {
    authorizeSuperAdmin(ctx);
    return many<AdminBusinessCategory>(
      pool,
      `select ${categoryColumns("c")}, (select count(*) from businesses b where b.category = c.id) as "businessCount"
         from business_categories c
        order by c.sort_order, c.name`,
    );
  },

  async create(ctx: RequestContext, input: unknown): Promise<BusinessCategoryInfo> {
    const actor = authorizeSuperAdmin(ctx);
    const data = parseInput(businessCategoryInputSchema, input);
    return transaction(async (db) => {
      await assertUniqueName(db, data.name);
      const id = await uniqueCategoryId(db, data.name);
      const category = (await one<BusinessCategoryInfo>(
        db,
        `insert into business_categories
           (id, name, icon, is_health, suggested_service_name, suggested_service_duration, suggested_service_price,
            is_active, sort_order)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning ${categoryColumns()}`,
        [
          id,
          data.name,
          data.icon,
          data.isHealth,
          data.suggestedServiceName,
          data.suggestedServiceDuration,
          data.suggestedServicePrice,
          data.isActive,
          data.sortOrder,
        ],
      ))!;
      await logAudit(db, {
        businessId: null,
        actor,
        action: "platform.category_created",
        entityType: "platform",
        entityId: null,
        summary: `Creó la categoría ${category.name}`,
      });
      return category;
    });
  },

  async update(ctx: RequestContext, id: string, input: unknown): Promise<BusinessCategoryInfo> {
    const actor = authorizeSuperAdmin(ctx);
    const data = parseInput(businessCategoryInputSchema, input);
    return transaction(async (db) => {
      const before = await findCategory(db, id);
      if (!before) throw new AppError("not_found", "Categoría no encontrada.");
      await assertUniqueName(db, data.name, id);
      const category = (await one<BusinessCategoryInfo>(
        db,
        `update business_categories
            set name = $2, icon = $3, is_health = $4, suggested_service_name = $5, suggested_service_duration = $6,
                suggested_service_price = $7, is_active = $8, sort_order = $9
          where id = $1
          returning ${categoryColumns()}`,
        [
          id,
          data.name,
          data.icon,
          data.isHealth,
          data.suggestedServiceName,
          data.suggestedServiceDuration,
          data.suggestedServicePrice,
          data.isActive,
          data.sortOrder,
        ],
      ))!;
      const summary =
        before.isActive !== category.isActive
          ? `${category.isActive ? "Activó" : "Desactivó"} la categoría ${category.name}`
          : `Actualizó la categoría ${category.name}`;
      await logAudit(db, { businessId: null, actor, action: "platform.category_updated", entityType: "platform", entityId: null, summary });
      return category;
    });
  },

  /** Sólo si ningún negocio la usa; si no, hay que desactivarla. */
  async remove(ctx: RequestContext, id: string): Promise<void> {
    const actor = authorizeSuperAdmin(ctx);
    await transaction(async (db) => {
      const category = await findCategory(db, id);
      if (!category) throw new AppError("not_found", "Categoría no encontrada.");
      const { count } = (await one<{ count: number }>(db, "select count(*) from businesses where category = $1", [id]))!;
      if (count > 0) {
        throw new AppError(
          "conflict",
          `${count} negocio(s) tienen esta categoría. Desactívala para que deje de ofrecerse, o cámbiales la categoría antes.`,
        );
      }
      await db.query("delete from business_categories where id = $1", [id]);
      await logAudit(db, {
        businessId: null,
        actor,
        action: "platform.category_deleted",
        entityType: "platform",
        entityId: null,
        summary: `Eliminó la categoría ${category.name}`,
      });
    });
  },
};
