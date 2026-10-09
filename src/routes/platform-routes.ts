import { Router } from "express";
import { config } from "../config.ts";
import { requireCaptcha } from "../http/captcha.ts";
import { handle, limitRequests } from "../http/handlers.ts";
import { requireSuperAdminTwoFactor } from "../http/session.ts";
import { adminService, platformService } from "../services/admin-service.ts";
import { categoryService } from "../services/category-service.ts";
import { paymentService } from "../services/payment-service.ts";
import { publicBookingService } from "../services/public-booking-service.ts";

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

/* --------------------------------------- /api/admin (super admin) ----------- */

export const adminRoutes = Router();

// El super admin sin la verificación en dos pasos (obligatoria) no pasa de aquí: `two_factor_required`.
adminRoutes.use(requireSuperAdminTwoFactor);

adminRoutes.get(
  "/stats",
  handle((req) => adminService.getStats(req.ctx)),
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
// Enlace de un solo uso para que el usuario defina su contraseña (el super admin no la elige ni la ve).
adminRoutes.post(
  "/users/:userId/password-link",
  handle((req) => adminService.sendPasswordLink(req.ctx, req.params.userId)),
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
  handle((req) => adminService.listEmails(req.ctx)),
);
adminRoutes.put(
  "/settings",
  handle((req) => adminService.updateSettings(req.ctx, req.body)),
);
