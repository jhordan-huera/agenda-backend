/**
 * Columnas de cada tabla con su alias camelCase: las consultas devuelven directamente
 * los objetos de src/shared/types. `alias` prefija las columnas en consultas con join.
 */
function columns(spec: Record<string, string>) {
  return (alias?: string) =>
    Object.entries(spec)
      .map(([key, column]) => `${alias ? `${alias}.` : ""}${column} as "${key}"`)
      .join(", ");
}

export const userColumns = columns({
  id: "id",
  firstName: "first_name",
  lastName: "last_name",
  email: "email",
  phone: "phone",
  avatarUrl: "avatar_url",
  platformRole: "platform_role",
  platformOwner: "platform_owner",
  isActive: "is_active",
  createdAt: "created_at",
});

export const businessColumns = columns({
  id: "id",
  ownerId: "owner_id",
  status: "status",
  name: "name",
  slug: "slug",
  description: "description",
  category: "category",
  timezone: "timezone",
  currency: "currency",
  logoUrl: "logo_url",
  phone: "phone",
  email: "email",
  address: "address",
  lat: "lat",
  lng: "lng",
  bookingSettings: "booking_settings",
  notificationSettings: "notification_settings",
  clinicalRecordsEnabled: "clinical_records_enabled",
  clinicalDefaultTemplateId: "clinical_default_template_id",
  brandColors: "brand_colors",
  professionalScope: "professional_scope",
  clientRequiredFields: "client_required_fields",
  multiClientAppointments: "multi_client_appointments",
  createdAt: "created_at",
});

const professionalOwnColumns = columns({
  id: "id",
  businessId: "business_id",
  userId: "user_id",
  displayName: "display_name",
  title: "title",
  avatarUrl: "avatar_url",
  color: "color",
  email: "email",
  meetingUrl: "meeting_url",
  bankAccounts: "bank_accounts",
  /**
   * @deprecated La primera de `bankAccounts` (o null), sólo para los fronts viejos en caché (de antes
   * de las varias cuentas, migración 030): quitarla cuando ya no queden. Ver services/bank-accounts.ts.
   */
  bankAccount: "bank_accounts->0",
  allServices: "all_services",
  notifyNewAppointments: "notify_new_appointments",
  dailyAgenda: "daily_agenda",
  isActive: "is_active",
  sortOrder: "sort_order",
  createdAt: "created_at",
});

/** Con los servicios que atiende (`serviceIds`, de professional_services). */
export const professionalColumns = (alias?: string) =>
  `${professionalOwnColumns(alias)}, coalesce((select array_agg(ps.service_id::text order by ps.service_id)
     from professional_services ps where ps.professional_id = ${alias ?? "professionals"}.id), '{}') as "serviceIds"`;

/** Orden de las agendas en el calendario, la página de reservas y los reportes. */
export const PROFESSIONAL_ORDER = "sort_order, display_name";

export const subscriptionColumns = columns({
  id: "id",
  businessId: "business_id",
  plan: "plan",
  status: "status",
  currentPeriodEnd: "current_period_end",
  maxProfessionals: "max_professionals",
});

export const clientColumns = columns({
  id: "id",
  businessId: "business_id",
  name: "name",
  documentId: "document_id",
  email: "email",
  phone: "phone",
  address: "address",
  notes: "notes",
  isActive: "is_active",
  createdAt: "created_at",
  claimedClientId: "claimed_client_id",
  // El panel, la página de reservas o una importación (spec 012).
  source: "source",
});

export const serviceColumns = columns({
  id: "id",
  businessId: "business_id",
  name: "name",
  description: "description",
  durationMinutes: "duration_minutes",
  price: "price",
  showPrice: "show_price",
  modes: "modes",
  homeVisitFee: "home_visit_fee",
  peoplePerSession: "people_per_session",
  isActive: "is_active",
  createdAt: "created_at",
});

const appointmentBaseColumns = columns({
  id: "id",
  businessId: "business_id",
  clientId: "client_id",
  serviceId: "service_id",
  professionalId: "professional_id",
  date: "date",
  startTime: "start_time",
  endTime: "end_time",
  status: "status",
  notes: "notes",
  price: "price",
  homeVisit: "home_visit",
  isVirtual: "is_virtual",
  source: "source",
  arrivedAt: "arrived_at",
  paymentToken: "payment_token",
  receiptAt: "receipt_at",
  paidAt: "paid_at",
  createdAt: "created_at",
  updatedAt: "updated_at",
});

/**
 * Los otros pacientes de la cita (tabla appointment_clients), en el orden en que se agregaron; '{}' si no
 * hay. `alias`: el de la tabla appointments en la consulta (sin alias, "appointments").
 */
export const extraClientIdsSql = (alias = "appointments") =>
  `coalesce((select array_agg(ac.client_id::text order by ac.created_at, ac.client_id)
     from appointment_clients ac where ac.appointment_id = ${alias}.id), '{}')`;

/** Un instante en ISO y UTC ("2026-10-14T23:20:00.000Z"), como salen las demás fechas de las consultas. */
const isoSql = (column: string) => `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/**
 * Quienes confirmaron que van desde su email (spec 010): `[{ clientId, confirmedAt }]`, el principal
 * primero y luego los demás en su orden; '[]' si nadie. `alias`: como en extraClientIdsSql.
 */
export const clientConfirmationsSql = (alias = "appointments") =>
  `coalesce((select json_agg(json_build_object('clientId', cc.client_id, 'confirmedAt', ${isoSql("cc.confirmed_at")})
                             order by cc.ord, cc.created_at, cc.client_id)
     from (select ${alias}.client_id::text as client_id, ${alias}.client_confirmed_at as confirmed_at, 0 as ord,
                  null::timestamptz as created_at
            where ${alias}.client_confirmed_at is not null
           union all
           select ac.client_id::text, ac.confirmed_at, 1, ac.created_at from appointment_clients ac
            where ac.appointment_id = ${alias}.id and ac.confirmed_at is not null) cc), '[]'::json)`;

/**
 * La serie de la cita (spec 011): `{ id, index, total, frequency }`, con el total y la frecuencia leídos
 * de appointment_series por su clave primaria; null en una cita suelta. `alias`: como en extraClientIdsSql.
 */
export const seriesSql = (alias = "appointments") =>
  `(select json_build_object('id', s.id, 'index', ${alias}.series_index, 'total', s.created_count, 'frequency', s.frequency)
      from appointment_series s where s.id = ${alias}.series_id)`;

/**
 * Las columnas de la cita, sus otros pacientes (`extraClientIds`), quiénes confirmaron
 * (`clientConfirmations`) y su serie (`series`).
 */
export const appointmentColumns = (alias?: string) =>
  `${appointmentBaseColumns(alias)}, ${extraClientIdsSql(alias)} as "extraClientIds", ${clientConfirmationsSql(alias)} as "clientConfirmations", ${seriesSql(alias)} as "series"`;

export const paymentReceiptColumns = columns({
  id: "id",
  appointmentId: "appointment_id",
  fileName: "file_name",
  contentType: "content_type",
  sizeBytes: "size_bytes",
  createdAt: "created_at",
});

export const scheduleColumns = columns({
  id: "id",
  businessId: "business_id",
  professionalId: "professional_id",
  dayOfWeek: "day_of_week",
  isActive: "is_active",
  intervals: "intervals",
});

export const blockedTimeColumns = columns({
  id: "id",
  businessId: "business_id",
  professionalId: "professional_id",
  reason: "reason",
  startDate: "start_date",
  endDate: "end_date",
  allDay: "all_day",
  startTime: "start_time",
  endTime: "end_time",
  createdAt: "created_at",
});

export const notificationColumns = columns({
  id: "id",
  businessId: "business_id",
  type: "type",
  to: "to_email",
  subject: "subject",
  body: "body",
  appointmentId: "appointment_id",
  status: "status",
  createdAt: "created_at",
});

export const auditLogColumns = columns({
  id: "id",
  businessId: "business_id",
  actorId: "actor_id",
  actorName: "actor_name",
  action: "action",
  entityType: "entity_type",
  entityId: "entity_id",
  summary: "summary",
  changes: "changes",
  createdAt: "created_at",
});

/** Desde dónde (sólo eventos de sesión). Sólo para el super admin. */
export const auditLogConnectionColumns = columns({
  ip: "ip",
  userAgent: "user_agent",
});

export const teamMemberColumns = (membership: string, user: string) =>
  [
    `${membership}.business_id as "businessId"`,
    `${membership}.user_id as "userId"`,
    `${membership}.role as "role"`,
    `${membership}.clinical_access as "clinicalAccess"`,
    `${membership}.created_at as "createdAt"`,
    `${user}.first_name as "firstName"`,
    `${user}.last_name as "lastName"`,
    `${user}.email as "email"`,
    `${user}.avatar_url as "avatarUrl"`,
  ].join(", ");

export const clinicalProfileColumns = columns({
  businessId: "business_id",
  clientId: "client_id",
  documentId: "document_id",
  birthDate: "coalesce(to_char(birth_date, 'YYYY-MM-DD'), '')",
  sex: "sex",
  bloodType: "blood_type",
  emergencyContact: "emergency_contact",
  allergies: "allergies",
  conditions: "conditions",
  medications: "medications",
  surgeries: "surgeries",
  familyHistory: "family_history",
  consentDate: "coalesce(to_char(consent_date, 'YYYY-MM-DD'), '')",
  updatedAt: "updated_at",
  updatedByName: "updated_by_name",
});

export const clinicalNoteColumns = columns({
  id: "id",
  businessId: "business_id",
  clientId: "client_id",
  appointmentId: "appointment_id",
  date: "date",
  templateVersionId: "template_version_id",
  data: "data",
  authorId: "author_id",
  authorName: "author_name",
  createdAt: "created_at",
});

export const planRequestColumns = columns({
  id: "id",
  businessId: "business_id",
  currentPlan: "current_plan",
  requestedPlan: "requested_plan",
  status: "status",
  requestedByName: "requested_by_name",
  createdAt: "created_at",
  resolvedAt: "resolved_at",
  resolvedByName: "resolved_by_name",
  rejectionReason: "rejection_reason",
});

/** Categoría con su servicio sugerido anidado (BusinessCategoryInfo). */
export const categoryColumns = (alias?: string) => {
  const c = (column: string) => (alias ? `${alias}.${column}` : column);
  return [
    `${c("id")} as "id"`,
    `${c("name")} as "name"`,
    `${c("icon")} as "icon"`,
    `${c("is_health")} as "isHealth"`,
    `json_build_object('name', ${c("suggested_service_name")}, 'durationMinutes', ${c("suggested_service_duration")}, 'price', ${c("suggested_service_price")}::float8) as "suggestedService"`,
    `${c("is_active")} as "isActive"`,
    `${c("sort_order")} as "sortOrder"`,
  ].join(", ");
};

export const clinicalAttachmentColumns = columns({
  id: "id",
  clientId: "client_id",
  fileName: "file_name",
  contentType: "content_type",
  sizeBytes: "size_bytes",
  description: "description",
  uploadedByName: "uploaded_by_name",
  createdAt: "created_at",
});
