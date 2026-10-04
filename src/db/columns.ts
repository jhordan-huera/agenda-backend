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
  createdAt: "created_at",
});

export const professionalColumns = columns({
  id: "id",
  businessId: "business_id",
  userId: "user_id",
  displayName: "display_name",
  title: "title",
  avatarUrl: "avatar_url",
});

export const subscriptionColumns = columns({
  id: "id",
  businessId: "business_id",
  plan: "plan",
  status: "status",
  currentPeriodEnd: "current_period_end",
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
});

export const serviceColumns = columns({
  id: "id",
  businessId: "business_id",
  name: "name",
  description: "description",
  durationMinutes: "duration_minutes",
  price: "price",
  showPrice: "show_price",
  location: "location",
  homeVisitFee: "home_visit_fee",
  isActive: "is_active",
  createdAt: "created_at",
});

export const appointmentColumns = columns({
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
  source: "source",
  createdAt: "created_at",
  updatedAt: "updated_at",
});

export const scheduleColumns = columns({
  id: "id",
  businessId: "business_id",
  dayOfWeek: "day_of_week",
  isActive: "is_active",
  intervals: "intervals",
});

export const blockedTimeColumns = columns({
  id: "id",
  businessId: "business_id",
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
  createdAt: "created_at",
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
  reason: "reason",
  findings: "findings",
  diagnosis: "diagnosis",
  treatment: "treatment",
  indications: "indications",
  nextControl: "next_control",
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
