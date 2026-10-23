import { Router } from "express";
import { config } from "../config.ts";
import { requireCaptcha } from "../http/captcha.ts";
import { handle, limitRequests } from "../http/handlers.ts";
import { requireSuperAdminTwoFactor } from "../http/session.ts";
import { adminCalendarService } from "../services/admin-calendar-service.ts";
import { adminService, platformService } from "../services/admin-service.ts";
import { analyticsService } from "../services/analytics-service.ts";
import { adminBillingService } from "../services/billing-service.ts";
import { appointmentPageService } from "../services/appointment-page-service.ts";
import { categoryService } from "../services/category-service.ts";
import { databaseStatsService } from "../services/database-stats-service.ts";
import { platformNoticeService } from "../services/panel-notices.ts";
import { paymentService } from "../services/payment-service.ts";
import { publicBookingService } from "../services/public-booking-service.ts";
import { adminReferralService, publicReferralService } from "../services/referral-service.ts";

/* -------------------------------------- /api/public (sin sesión) ------------ */

export const publicRoutes = Router();

const bookingLimit = limitRequests({
  name: "reservas",
  windowMinutes: 15,
  max: 20,
  message: "Demasiadas reservas desde esta conexión. Espera unos minutos o contacta al negocio.",
});

// Datos de la plataforma que cambian poco: la CDN de Vercel los guarda un minuto (corto, porque el
// super admin los edita y quiere verlos enseguida).
const shortCache = "public, max-age=0, s-maxage=60, stale-while-revalidate=60";

publicRoutes.get(
  "/platform-settings",
  handle(async (_req, res) => {
    const settings = await platformService.getSettings();
    res.set("Cache-Control", shortCache); // Sólo si salió bien: un error no se guarda.
    return settings;
  }),
);
publicRoutes.get(
  "/categories",
  handle(async (_req, res) => {
    const categories = await categoryService.listPublic();
    res.set("Cache-Control", shortCache);
    return categories;
  }),
);
// Site Key del CAPTCHA para las páginas sin negocio (el registro). null: no se pide.
publicRoutes.get(
  "/captcha",
  handle(async (_req, res) => {
    res.set("Cache-Control", shortCache);
    return { siteKey: config.turnstile?.siteKey ?? null };
  }),
);
publicRoutes.get(
  "/businesses/:slug",
  handle(async (req, res) => {
    const profile = await publicBookingService.getProfile(req.params.slug);
    // La CDN de Vercel la guarda 30 s (y la sirve vieja hasta 60 s más mientras la renueva): si un
    // enlace se hace viral, la mayoría de visitas no llegan a la base. La reserva vuelve a
    // comprobar la hora al confirmarla, así que nunca se reserva una hora ocupada.
    if (profile) res.set("Cache-Control", "public, max-age=0, s-maxage=30, stale-while-revalidate=60");
    return profile;
  }),
);
// La portada con `?ref=<código>` (spec 023): sólo el nombre de un negocio activo, para «Me recomendó
// <negocio>»; 404 si el código no existe o el negocio está suspendido. En la CDN como el perfil.
publicRoutes.get(
  "/referrals/:code",
  handle(async (req, res) => {
    const referrer = await publicReferralService.getReferrer(req.params.code);
    res.set("Cache-Control", "public, max-age=0, s-maxage=30, stale-while-revalidate=60");
    return referrer;
  }),
);
// Búsqueda por cédula de las versiones anteriores de la página: ya no dice si es cliente (ver lookupClient).
const lookupLimit = limitRequests({
  name: "busqueda-cedula",
  windowMinutes: 15,
  max: 30,
  message: "Demasiadas búsquedas desde esta conexión. Espera unos minutos o contacta al negocio.",
});

publicRoutes.post(
  "/businesses/:slug/clients/lookup",
  lookupLimit,
  requireCaptcha,
  handle((req) => publicBookingService.lookupClient(req.params.slug, req.body)),
);
publicRoutes.post(
  "/businesses/:slug/bookings",
  bookingLimit,
  requireCaptcha,
  handle((req) => publicBookingService.book(req.params.slug, req.body)),
);

// Enlace de pago de una cita (/pago/:token): el token es la autorización. Sin caché: el paciente
// tiene que ver enseguida el comprobante que acaba de subir.
const paymentLimit = limitRequests({
  name: "pagos",
  windowMinutes: 15,
  max: 60,
  message: "Demasiadas solicitudes desde esta conexión. Espera unos minutos.",
});
const receiptLimit = limitRequests({
  name: "comprobantes",
  windowMinutes: 15,
  max: 20,
  message: "Demasiados comprobantes desde esta conexión. Espera unos minutos o envíalo por WhatsApp.",
});

publicRoutes.get(
  "/payments/:token",
  paymentLimit,
  handle(async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    return paymentService.getPublic(req.params.token);
  }),
);
publicRoutes.post(
  "/payments/:token/receipts",
  receiptLimit,
  handle((req) => paymentService.requestUpload(req.params.token, req.body)),
);
publicRoutes.post(
  "/payments/:token/receipts/:receiptId/complete",
  receiptLimit,
  handle((req) => paymentService.completeUpload(req.params.token, req.params.receiptId)),
);

// Página «Tu cita» (/cita/:token, spec 010): ver la cita, «Confirmo que voy» y «Cancelar mi cita». El
// token (128 bits al azar) es la autorización, como en el pago; el límite frena a quien intente
// adivinarlo. Sin caché: el paciente tiene que ver enseguida lo que acaba de hacer.
const appointmentPageLimit = limitRequests({
  name: "mi-cita",
  windowMinutes: 15,
  max: 60,
  message: "Demasiadas solicitudes desde esta conexión. Espera unos minutos.",
});
const appointmentActionLimit = limitRequests({
  name: "mi-cita-acciones",
  windowMinutes: 15,
  max: 20,
  message: "Demasiadas solicitudes desde esta conexión. Espera unos minutos.",
});

publicRoutes.get(
  "/appointments/:token",
  appointmentPageLimit,
  handle(async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    return appointmentPageService.get(req.params.token);
  }),
);
publicRoutes.post(
  "/appointments/:token/confirm",
  appointmentActionLimit,
  handle((req) => appointmentPageService.confirm(req.params.token)),
);
publicRoutes.post(
  "/appointments/:token/cancel",
  appointmentActionLimit,
  handle((req) => appointmentPageService.cancel(req.params.token)),
);

/* --------------------------------------- /api/admin (super admin) ----------- */

export const adminRoutes = Router();

// El super admin sin la verificación en dos pasos (obligatoria) no pasa de aquí: `two_factor_required`.
adminRoutes.use(requireSuperAdminTwoFactor);

adminRoutes.get(
  "/stats",
  handle((req) => adminService.getStats(req.ctx)),
);
// Analítica (spec 016): la última foto que preparó el cron (?days=30|90). Lee una fila; no calcula nada.
adminRoutes.get(
  "/analytics",
  handle((req) => analyticsService.getSnapshot(req.ctx, req.query)),
);
// El calendario de la plataforma (spec 035): sólo cifras por día, hora, negocio, agenda y estado; nunca
// pacientes ni citas sueltas. Se calcula al abrirlo, con un rango de 42 días como mucho.
adminRoutes.get(
  "/calendar",
  handle((req) => adminCalendarService.getRange(req.ctx, req.query)),
);
adminRoutes.get(
  "/calendar/day",
  handle((req) => adminCalendarService.getDay(req.ctx, req.query)),
);
// La pantalla «Base de datos» (spec 024): sólo el super admin principal (los demás, 403 en el servicio),
// con su propio límite y sin caché. Se calcula al abrirla, en una transacción de sólo lectura.
const databaseLimit = limitRequests({
  name: "base-de-datos",
  windowMinutes: 15,
  max: 20,
  message: "Demasiadas consultas de la base de datos. Espera unos minutos.",
});

adminRoutes.get(
  "/database",
  databaseLimit,
  handle(async (req, res) => {
    res.set("Cache-Control", "no-store");
    return databaseStatsService.get(req.ctx);
  }),
);
adminRoutes.get(
  "/businesses",
  handle((req) => adminService.listBusinesses(req.ctx)),
);
adminRoutes.post(
  "/businesses",
  handle((req) => adminService.createBusiness(req.ctx, req.body)),
);
adminRoutes.get(
  "/businesses/:businessId",
  handle((req) => adminService.getBusiness(req.ctx, req.params.businessId)),
);
adminRoutes.delete(
  "/businesses/:businessId",
  handle((req) => adminService.deleteBusiness(req.ctx, req.params.businessId, req.body)),
);
adminRoutes.post(
  "/businesses/:businessId/owner",
  handle((req) => adminService.assignBusinessOwner(req.ctx, req.params.businessId, req.body)),
);
adminRoutes.post(
  "/businesses/:businessId/members",
  handle((req) => adminService.addBusinessMember(req.ctx, req.params.businessId, req.body)),
);
adminRoutes.patch(
  "/businesses/:businessId/status",
  handle((req) => adminService.setBusinessStatus(req.ctx, req.params.businessId, req.body?.status)),
);
adminRoutes.put(
  "/businesses/:businessId/plan",
  handle((req) => adminService.changeBusinessPlan(req.ctx, req.params.businessId, req.body?.plan)),
);
adminRoutes.put(
  "/businesses/:businessId/max-professionals",
  handle((req) => adminService.setMaxProfessionals(req.ctx, req.params.businessId, req.body?.maxProfessionals ?? null)),
);
// Datos obligatorios del paciente en el panel del negocio: { documentId, email, phone, address } (true: obligatorio).
adminRoutes.put(
  "/businesses/:businessId/client-required-fields",
  handle((req) => adminService.setClientRequiredFields(req.ctx, req.params.businessId, req.body)),
);
// Citas con varios pacientes en el negocio: { enabled: boolean }.
adminRoutes.put(
  "/businesses/:businessId/multi-client-appointments",
  handle((req) => adminService.setMultiClientAppointments(req.ctx, req.params.businessId, req.body?.enabled)),
);
// La mensualidad del negocio (spec 029): { customFee (el precio especial; null: el de su plan), billingDay,
// billingStart }. Devuelve la de la ficha.
adminRoutes.put(
  "/businesses/:businessId/billing",
  handle((req) => adminBillingService.setBusinessBilling(req.ctx, req.params.businessId, req.body)),
);
// «Recomendado por» (spec 023): { referredBy: id de otro negocio | null }. Devuelve los referidos de la ficha.
adminRoutes.put(
  "/businesses/:businessId/referred-by",
  handle((req) => adminReferralService.setReferredBy(req.ctx, req.params.businessId, req.body)),
);
// «Descuentos por referidos» del Inicio (spec 023): los ganados y pendientes, y «Marcar como aplicado».
adminRoutes.get(
  "/referral-rewards",
  handle((req) => adminReferralService.listRewards(req.ctx)),
);
adminRoutes.post(
  "/referral-rewards/:businessId/apply",
  handle((req) => adminReferralService.applyReward(req.ctx, req.params.businessId)),
);
// «Cobros» (spec 029): los cobros de las mensualidades por estado (?status=in_review|due|overdue|paid|
// rejected|void), sus comprobantes y las acciones del super admin. Sin caché, como toda la API.
adminRoutes.get(
  "/billing",
  handle((req) => adminBillingService.list(req.ctx, req.query)),
);
adminRoutes.post(
  "/billing/charges/:chargeId/approve",
  handle((req) => adminBillingService.approve(req.ctx, req.params.chargeId)),
);
adminRoutes.post(
  "/billing/charges/:chargeId/reject",
  handle((req) => adminBillingService.reject(req.ctx, req.params.chargeId, req.body)),
);
adminRoutes.post(
  "/billing/charges/:chargeId/mark-paid",
  handle((req) => adminBillingService.markPaid(req.ctx, req.params.chargeId, req.body)),
);
adminRoutes.post(
  "/billing/charges/:chargeId/void",
  handle((req) => adminBillingService.void(req.ctx, req.params.chargeId, req.body)),
);
adminRoutes.get(
  "/billing/charges/:chargeId/receipt",
  handle((req) => adminBillingService.receiptUrl(req.ctx, req.params.chargeId)),
);
// Los precios de los planes (spec 029, ampliación del 2026-10-20): { proPrice, businessPrice,
// businessIncludedAgendas, businessExtraAgendaPrice }. Como las cuentas, nunca en /public/platform-settings.
adminRoutes.get(
  "/plan-prices",
  handle((req) => adminBillingService.getPlanPrices(req.ctx)),
);
adminRoutes.put(
  "/plan-prices",
  handle((req) => adminBillingService.setPlanPrices(req.ctx, req.body)),
);
// Las cuentas de Agenda360 para recibir las mensualidades: nunca en /public/platform-settings (que va en la CDN).
adminRoutes.get(
  "/billing-accounts",
  handle((req) => adminBillingService.getAccounts(req.ctx)),
);
adminRoutes.put(
  "/billing-accounts",
  handle((req) => adminBillingService.setAccounts(req.ctx, req.body)),
);
adminRoutes.get(
  "/categories",
  handle((req) => categoryService.listForAdmin(req.ctx)),
);
adminRoutes.post(
  "/categories",
  handle((req) => categoryService.create(req.ctx, req.body)),
);
adminRoutes.put(
  "/categories/:categoryId",
  handle((req) => categoryService.update(req.ctx, req.params.categoryId, req.body)),
);
adminRoutes.delete(
  "/categories/:categoryId",
  handle((req) => categoryService.remove(req.ctx, req.params.categoryId)),
);
adminRoutes.get(
  "/plan-requests",
  handle((req) => adminService.listPlanRequests(req.ctx)),
);
adminRoutes.post(
  "/plan-requests/:requestId/approve",
  handle((req) => adminService.approvePlanRequest(req.ctx, req.params.requestId)),
);
adminRoutes.post(
  "/plan-requests/:requestId/reject",
  handle((req) => adminService.rejectPlanRequest(req.ctx, req.params.requestId, req.body)),
);
adminRoutes.get(
  "/users",
  handle((req) => adminService.listUsers(req.ctx)),
);
adminRoutes.patch(
  "/users/:userId/active",
  handle((req) => adminService.setUserActive(req.ctx, req.params.userId, req.body?.isActive)),
);
adminRoutes.put(
  "/users/:userId/password",
  handle((req) => adminService.setUserPassword(req.ctx, req.params.userId, req.body)),
);
adminRoutes.get(
  "/platform-admins",
  handle((req) => adminService.listPlatformAdmins(req.ctx)),
);
adminRoutes.post(
  "/platform-admins",
  handle((req) => adminService.addPlatformAdmin(req.ctx, req.body)),
);
adminRoutes.get(
  "/audit-logs",
  handle((req) => adminService.listAuditLogs(req.ctx, req.query)),
);
adminRoutes.get(
  "/emails",
  handle((req) => adminService.listEmails(req.ctx, req.query)),
);
adminRoutes.put(
  "/settings",
  handle((req) => adminService.updateSettings(req.ctx, req.body)),
);
// Colores del panel de plataforma de la cuenta que lo pide (spec 007).
adminRoutes.put(
  "/panel-colors",
  handle((req) => adminService.updatePanelColors(req.ctx, req.body)),
);
// Centro de avisos (spec 014): la campana de /admin, con los cuatro avisos del super admin (cada uno
// lleva su propio leído). Leer no va a la actividad.
adminRoutes.get(
  "/notices/unread",
  handle((req) => platformNoticeService.unread(req.ctx)),
);
adminRoutes.get(
  "/notices",
  handle((req) => platformNoticeService.list(req.ctx, req.query)),
);
adminRoutes.post(
  "/notices/read-all",
  handle((req) => platformNoticeService.markAllRead(req.ctx)),
);
adminRoutes.post(
  "/notices/:noticeId/read",
  handle((req) => platformNoticeService.markRead(req.ctx, req.params.noticeId)),
);
