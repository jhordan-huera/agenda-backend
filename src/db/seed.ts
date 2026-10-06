import { config } from "../config.ts";
import { hashPassword } from "../services/accounts.ts";
import { many, pool, transaction, type Db } from "./pool.ts";
import { createSeedDatabase } from "./seed-data.ts";

/**
 * `npm run db:seed`: carga los datos de demostración (negocios, cuentas, clientes, citas…)
 * con fechas relativas a hoy. Sólo para desarrollo y demos.
 *
 * - Si la base ya tiene usuarios, no hace nada.
 * - `npm run db:seed -- --reset` BORRA todos los datos antes de cargarlos.
 * - Sólo con una base de datos local: el .env puede apuntar a producción (Supabase) y la demo
 *   crea cuentas con contraseñas conocidas (admin@demo.com / demo1234).
 */
const TABLES = [
  "cron_runs",
  "plan_change_requests",
  "clinical_note_addenda",
  "clinical_notes",
  "clinical_profiles",
  "audit_logs",
  "notifications",
  "appointments",
  "blocked_times",
  "schedules",
  "services",
  "clients",
  "subscriptions",
  "professional_services",
  "professionals",
  "business_users",
  "businesses",
  "sessions",
  "users",
];

/** Cédula ecuatoriana válida y estable para el cliente demo número `index` (provincia 17, Pichincha). */
function demoCedula(index: number): string {
  const nine = `170${String((index * 104_729 + 12_345) % 1_000_000).padStart(6, "0")}`;
  const sum = [...nine].reduce((total, digit, i) => {
    const product = Number(digit) * (i % 2 === 0 ? 2 : 1);
    return total + (product > 9 ? product - 9 : product);
  }, 0);
  return `${nine}${(10 - (sum % 10)) % 10}`;
}

/** Inserta muchas filas con pocas consultas (importante con una base de datos remota). */
async function insertRows(db: Db, table: string, columns: string[], rows: unknown[][]) {
  const rowsPerQuery = Math.floor(30_000 / columns.length);
  for (let start = 0; start < rows.length; start += rowsPerQuery) {
    const values: unknown[] = [];
    const tuples = rows.slice(start, start + rowsPerQuery).map(
      (row) => `(${row.map((value) => `$${values.push(value)}`).join(", ")})`,
    );
    await db.query(`insert into ${table} (${columns.join(", ")}) values ${tuples.join(", ")}`, values);
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", ""]);

/** El host de DATABASE_URL es este equipo (o un socket local, sin host). */
function isLocalDatabase(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function seed() {
  if (!isLocalDatabase(config.databaseUrl)) {
    console.error(
      "✗ DATABASE_URL no es una base de datos local: los datos demo sólo se cargan en desarrollo, nunca en producción.",
    );
    process.exitCode = 1;
    return;
  }
  const reset = process.argv.includes("--reset");
  const { rows } = await pool.query("select count(*)::int as count from users");
  if (rows[0].count > 0 && !reset) {
    console.info("La base de datos ya tiene datos. Usa `npm run db:seed -- --reset` para borrarlos y cargar la demo.");
    return;
  }

  const data = createSeedDatabase();
  // Una sola vez por contraseña distinta (todas las cuentas demo comparten la misma).
  const hashes = new Map<string, string>();
  for (const { password } of data.credentials) {
    if (!hashes.has(password)) hashes.set(password, await hashPassword(password));
  }
  const passwordOf = new Map(data.credentials.map((c) => [c.userId, hashes.get(c.password)!]));

  await transaction(async (db) => {
    if (reset) {
      // Las plantillas clínicas de la plataforma vienen de las migraciones y el truncate en cascada
      // las borraría (una plantilla puede pertenecer a un negocio): se guardan y se reponen.
      const templates = await many<unknown[]>(
        db,
        `select json_build_array(id, name, description, categories, sort_order, is_active, current_version_id, created_at, updated_at)
           from clinical_templates where business_id is null`,
      );
      const versions = await many<unknown[]>(
        db,
        `select json_build_array(v.id, v.template_id, v.version, v.name, v.fields::text, v.created_by_name, v.created_at)
           from clinical_template_versions v join clinical_templates t on t.id = v.template_id
          where t.business_id is null`,
      );
      await db.query(`truncate ${TABLES.join(", ")} cascade`);
      // El orden da igual: la referencia a la versión vigente se comprueba al confirmar.
      await insertRows(
        db,
        "clinical_templates",
        ["id", "name", "description", "categories", "sort_order", "is_active", "current_version_id", "created_at", "updated_at"],
        templates.map((row) => Object.values(row)[0] as unknown[]),
      );
      await insertRows(
        db,
        "clinical_template_versions",
        ["id", "template_id", "version", "name", "fields", "created_by_name", "created_at"],
        versions.map((row) => Object.values(row)[0] as unknown[]),
      );
    }

    await db.query("update platform_settings set allow_public_signup = $1, support_email = $2, support_phone = $3", [
      data.platformSettings.allowPublicSignup,
      data.platformSettings.supportEmail,
      data.platformSettings.supportPhone,
    ]);
    await insertRows(
      db,
      "users",
      ["id", "first_name", "last_name", "email", "phone", "avatar_url", "platform_role", "platform_owner", "is_active", "password_hash", "created_at"],
      data.users.map((u) => [
        u.id, u.firstName, u.lastName, u.email, u.phone, u.avatarUrl, u.platformRole, u.platformOwner, u.isActive, passwordOf.get(u.id), u.createdAt,
      ]),
    );
    await insertRows(
      db,
      "businesses",
      [
        "id", "owner_id", "status", "name", "slug", "description", "category", "timezone", "currency", "logo_url",
        "phone", "email", "address", "lat", "lng", "booking_settings", "notification_settings", "clinical_records_enabled",
        "created_at",
      ],
      data.businesses.map((b) => [
        b.id, b.ownerId, b.status, b.name, b.slug, b.description, b.category, b.timezone, b.currency, b.logoUrl,
        b.phone, b.email, b.address, b.lat, b.lng, b.bookingSettings, b.notificationSettings, b.clinicalRecordsEnabled,
        b.createdAt,
      ]),
    );
    await insertRows(
      db,
      "business_users",
      ["business_id", "user_id", "role", "clinical_access", "created_at"],
      data.businessUsers.map((m) => [m.businessId, m.userId, m.role, m.clinicalAccess, m.createdAt]),
    );
    await insertRows(
      db,
      "professionals",
      [
        "id", "business_id", "user_id", "display_name", "title", "avatar_url", "color", "email", "all_services",
        "notify_new_appointments", "daily_agenda", "is_active", "sort_order", "created_at",
      ],
      data.professionals.map((p) => [
        p.id, p.businessId, p.userId, p.displayName, p.title, p.avatarUrl, p.color, p.email, p.allServices,
        p.notifyNewAppointments, p.dailyAgenda, p.isActive, p.sortOrder, p.createdAt,
      ]),
    );
    await insertRows(
      db,
      "subscriptions",
      ["id", "business_id", "plan", "status", "current_period_end", "max_professionals"],
      data.subscriptions.map((s) => [s.id, s.businessId, s.plan, s.status, s.currentPeriodEnd, s.maxProfessionals]),
    );
    await insertRows(
      db,
      "services",
      [
        "id", "business_id", "name", "description", "duration_minutes", "price", "show_price", "modes",
        "home_visit_fee", "is_active", "created_at",
      ],
      data.services.map((s) => [
        s.id, s.businessId, s.name, s.description, s.durationMinutes, s.price, s.showPrice, s.modes,
        s.homeVisitFee, s.isActive, s.createdAt,
      ]),
    );
    await insertRows(
      db,
      "professional_services",
      ["professional_id", "service_id"],
      data.professionals.flatMap((p) => p.serviceIds.map((serviceId) => [p.id, serviceId])),
    );
    await insertRows(
      db,
      "clients",
      ["id", "business_id", "name", "document_id", "email", "phone", "address", "notes", "is_active", "created_at"],
      data.clients.map((c, index) => [
        c.id, c.businessId, c.name, demoCedula(index), c.email, c.phone, c.address, c.notes, c.isActive, c.createdAt,
      ]),
    );
    await insertRows(
      db,
      "schedules",
      ["id", "business_id", "professional_id", "day_of_week", "is_active", "intervals"],
      data.schedules.map((s) => [s.id, s.businessId, s.professionalId, s.dayOfWeek, s.isActive, JSON.stringify(s.intervals)]),
    );
    await insertRows(
      db,
      "blocked_times",
      ["id", "business_id", "professional_id", "reason", "start_date", "end_date", "all_day", "start_time", "end_time", "created_at"],
      data.blockedTimes.map((t) => [
        t.id, t.businessId, t.professionalId, t.reason, t.startDate, t.endDate, t.allDay, t.startTime, t.endTime, t.createdAt,
      ]),
    );
    await insertRows(
      db,
      "appointments",
      [
        "id", "business_id", "client_id", "service_id", "professional_id", "date", "start_time", "end_time",
        "status", "notes", "price", "home_visit", "is_virtual", "source", "created_at", "updated_at",
      ],
      data.appointments.map((a) => [
        a.id, a.businessId, a.clientId, a.serviceId, a.professionalId, a.date, a.startTime, a.endTime,
        a.status, a.notes, a.price, a.homeVisit ? JSON.stringify(a.homeVisit) : null, a.isVirtual, a.source, a.createdAt, a.updatedAt,
      ]),
    );
    await insertRows(
      db,
      "audit_logs",
      ["id", "business_id", "actor_id", "actor_name", "action", "entity_type", "entity_id", "summary", "created_at"],
      data.auditLogs.map((l) => [
        l.id, l.businessId, l.actorId, l.actorName, l.action, l.entityType, l.entityId, l.summary, l.createdAt,
      ]),
    );
    await insertRows(
      db,
      "clinical_profiles",
      [
        "business_id", "client_id", "document_id", "birth_date", "sex", "blood_type", "emergency_contact", "allergies",
        "conditions", "medications", "surgeries", "family_history", "consent_date", "updated_at", "updated_by_name",
      ],
      data.clinicalProfiles.map((p) => [
        p.businessId, p.clientId, p.documentId, p.birthDate || null, p.sex, p.bloodType, p.emergencyContact, p.allergies,
        p.conditions, p.medications, p.surgeries, p.familyHistory, p.consentDate || null, p.updatedAt, p.updatedByName,
      ]),
    );
    // Los ejemplos indican la plantilla por su id: aquí se cambia por su versión vigente.
    const templateVersions = await many<{ id: string; versionId: string }>(
      db,
      'select id, current_version_id as "versionId" from clinical_templates',
    );
    const versionOf = new Map(templateVersions.map((t) => [t.id, t.versionId]));
    await insertRows(
      db,
      "clinical_notes",
      ["id", "business_id", "client_id", "appointment_id", "date", "template_version_id", "data", "author_id", "author_name", "created_at"],
      data.clinicalNotes.map((n) => [
        n.id, n.businessId, n.clientId, n.appointmentId, n.date, versionOf.get(n.templateVersionId) ?? n.templateVersionId,
        n.data, n.authorId, n.authorName, n.createdAt,
      ]),
    );
    await insertRows(
      db,
      "clinical_note_addenda",
      ["id", "note_id", "business_id", "text", "author_id", "author_name", "created_at"],
      data.clinicalNotes.flatMap((n) =>
        n.addenda.map((a) => [a.id, n.id, n.businessId, a.text, a.authorId, a.authorName, a.createdAt]),
      ),
    );
  });

  console.info(
    `✓ Datos demo cargados: ${data.businesses.length} negocios, ${data.users.length} cuentas, ` +
      `${data.clients.length} clientes y ${data.appointments.length} citas.`,
  );
  console.info("  Todas las cuentas usan la contraseña demo1234 (p. ej. jhordan@demo.com y admin@demo.com).");
}

try {
  await seed();
} catch (error) {
  console.error("No se pudieron cargar los datos demo:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
