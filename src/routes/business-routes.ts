import express, { Router } from "express";
import { clientIp } from "../http/client-ip.ts";
import { handle, limitRequests, queryParam } from "../http/handlers.ts";
import { requireSuperAdminTwoFactor } from "../http/session.ts";
import { businessService, subscriptionService, teamService, userService } from "../services/account-service.ts";
import { auditLogService, notificationService } from "../services/activity-service.ts";
import { appointmentSeriesService } from "../services/appointment-series-service.ts";
import { appointmentsToCloseService } from "../services/appointments-to-close.ts";
import { clinicalAttachmentService } from "../services/clinical-attachment-service.ts";
import { clinicalService } from "../services/clinical-service.ts";
import { clinicalTemplateService } from "../services/clinical-template-service.ts";
import { clientImportService } from "../services/client-import-service.ts";
import { requireUser } from "../services/context.ts";
import {
  appointmentService,
  blockedTimeService,
  clientService,
  scheduleService,
  serviceService,
  setAppointmentArrival,
} from "../services/business-data-service.ts";
import { imageService } from "../services/image-service.ts";
import { panelNoticeService } from "../services/panel-notices.ts";
import { paymentService } from "../services/payment-service.ts";
import { professionalService } from "../services/professional-service.ts";
import { referralService } from "../services/referral-service.ts";

/* ------------------------------------------------------------ /api/users ---- */

export const userRoutes = Router();

userRoutes.get(
  "/:userId",
  // El perfil de otro usuario: al super admin le pide antes la verificación en dos pasos, como el
  // resto del panel (spec 009). El propio, no: lo necesita para activarla.
  (req, res, next) => (req.params.userId === req.ctx.user?.id ? next() : requireSuperAdminTwoFactor(req, res, next)),
  handle((req) => userService.getById(req.ctx, req.params.userId)),
);
// Cambiar el email pide la contraseña actual y queda en los eventos de sesión (con IP y navegador).
userRoutes.put(
  "/:userId",
  handle((req) =>
    userService.update(req.ctx, req.params.userId, req.body, { ip: clientIp(req), userAgent: req.get("user-agent") ?? null }),
  ),
);

/* ------------------------------------------------------------ /api/images --- */

/** Logo o foto de perfil: URL firmada para subirla al almacenamiento y su dirección pública. */
export const imageRoutes = Router();

// Modo soporte del super admin: sin la verificación en dos pasos (obligatoria), `two_factor_required`.
imageRoutes.use(requireSuperAdminTwoFactor);

imageRoutes.post(
  "/",
  limitRequests({ windowMinutes: 15, max: 40, message: "Demasiadas imágenes seguidas. Espera unos minutos." }),
  handle((req) => imageService.requestUpload(req.ctx, req.body)),
);

/* ------------------------------------------------------- /api/businesses ---- */

/**
 * Todo lo que cuelga de /api/businesses/:businessId pertenece a un negocio: cada
 * servicio comprueba que la sesión es miembro y que su rol tiene permiso.
 */
export const businessRoutes = Router();

// El super admin entra a los negocios en modo soporte ("Gestionar negocio"): con la verificación en dos pasos.
businessRoutes.use(requireSuperAdminTwoFactor);

businessRoutes.post(
  "/",
  handle((req) => businessService.create(req.ctx, req.body)),
);
businessRoutes.get(
  "/slug-availability",
  handle(async (req) => ({
    available: await businessService.isSlugAvailable(req.ctx, queryParam(req, "slug") ?? "", queryParam(req, "exclude")),
  })),
);

businessRoutes.get(
  "/:businessId",
  handle((req) => businessService.getById(req.ctx, req.params.businessId)),
);
businessRoutes.patch(
  "/:businessId",
  handle((req) => businessService.update(req.ctx, req.params.businessId, req.body)),
);
businessRoutes.get(
  "/:businessId/professional",
  handle((req) => businessService.getProfessional(req.ctx, req.params.businessId)),
);

// Profesionales (agendas): los ve todo el equipo; los gestionan el propietario y los administradores.
businessRoutes.get(
  "/:businessId/professionals",
  handle((req) => professionalService.list(req.ctx, req.params.businessId)),
);
businessRoutes.post(
  "/:businessId/professionals",
  handle((req) => professionalService.create(req.ctx, req.params.businessId, req.body)),
);
businessRoutes.put(
  "/:businessId/professionals/:professionalId",
  handle((req) => professionalService.update(req.ctx, req.params.businessId, req.params.professionalId, req.body)),
);
businessRoutes.delete(
  "/:businessId/professionals/:professionalId",
  handle((req) => professionalService.remove(req.ctx, req.params.businessId, req.params.professionalId)),
);
// Las invitaciones de calendario de una agenda (spec 027): el profesional, la suya; quien gestiona los profesionales, cualquiera.
businessRoutes.patch(
  "/:businessId/professionals/:professionalId/calendar-invites",
  handle((req) => professionalService.setCalendarInvites(req.ctx, req.params.businessId, req.params.professionalId, req.body)),
);
businessRoutes.put(
  "/:businessId/professionals/:professionalId/schedule",
  handle((req) => scheduleService.saveWeek(req.ctx, req.params.businessId, req.body, req.params.professionalId)),
);

// Equipo
businessRoutes.get(
  "/:businessId/team",
  handle((req) => teamService.list(req.ctx, req.params.businessId)),
);
businessRoutes.patch(
  "/:businessId/team/:userId",
  handle((req) => teamService.updateRole(req.ctx, req.params.businessId, req.params.userId, req.body?.role)),
);
businessRoutes.patch(
  "/:businessId/team/:userId/clinical-access",
  handle((req) => teamService.setClinicalAccess(req.ctx, req.params.businessId, req.params.userId, req.body?.access)),
);
businessRoutes.delete(
  "/:businessId/team/:userId",
  handle((req) => teamService.remove(req.ctx, req.params.businessId, req.params.userId)),
);

// El programa de referidos (spec 023): la tarjeta «Recomienda Agenda360», sólo del propietario.
businessRoutes.get(
  "/:businessId/referrals",
  handle((req) => referralService.getForBusiness(req.ctx, req.params.businessId)),
);

// Suscripción
businessRoutes.get(
  "/:businessId/subscription",
  handle((req) => subscriptionService.get(req.ctx, req.params.businessId)),
);
businessRoutes.get(
  "/:businessId/subscription/usage",
  handle((req) => subscriptionService.getUsage(req.ctx, req.params.businessId)),
);
businessRoutes.get(
  "/:businessId/subscription/request",
  handle((req) => subscriptionService.getPendingRequest(req.ctx, req.params.businessId)),
);
businessRoutes.post(
  "/:businessId/subscription/request",
  handle((req) => subscriptionService.requestPlanChange(req.ctx, req.params.businessId, req.body?.plan)),
);
businessRoutes.delete(
  "/:businessId/subscription/request",
  handle((req) => subscriptionService.cancelPlanRequest(req.ctx, req.params.businessId)),
);

// Clientes
businessRoutes.get(
  "/:businessId/clients",
  handle((req) => clientService.list(req.ctx, req.params.businessId)),
);
businessRoutes.get(
  "/:businessId/clients/activity",
  handle((req) => clientService.activity(req.ctx, req.params.businessId)),
);
businessRoutes.post(
  "/:businessId/clients",
  handle((req) => clientService.create(req.ctx, req.params.businessId, req.body)),
);
// Importar pacientes desde un Excel o un CSV (spec 012): primero la sesión (un anónimo no hace leer
// 4 MB), después el límite por conexión y por último el cuerpo, de hasta 4 MB (el resto de la API, 2 MB:
// ver app.ts). El rol y el negocio los comprueba el servicio.
businessRoutes.post(
  "/:businessId/clients/import",
  (req, _res, next) => {
    requireUser(req.ctx);
    next();
  },
  limitRequests({
    name: "importar-pacientes",
    windowMinutes: 15,
    max: 20,
    message: "Demasiadas importaciones seguidas. Espera unos minutos.",
  }),
  express.json({ limit: "4mb" }),
  handle((req) => clientImportService.importMany(req.ctx, req.params.businessId, req.body)),
);
businessRoutes.get(
  "/:businessId/clients/:clientId",
  handle((req) => clientService.getById(req.ctx, req.params.businessId, req.params.clientId)),
);
businessRoutes.put(
  "/:businessId/clients/:clientId",
  handle((req) => clientService.update(req.ctx, req.params.businessId, req.params.clientId, req.body)),
);
businessRoutes.delete(
  "/:businessId/clients/:clientId",
  handle((req) => clientService.remove(req.ctx, req.params.businessId, req.params.clientId)),
);
// «Es el mismo paciente»: une un paciente «Por verificar» a la ficha cuya cédula escribió (spec 009).
businessRoutes.post(
  "/:businessId/clients/:clientId/confirm-claim",
  handle((req) => clientService.confirmClaim(req.ctx, req.params.businessId, req.params.clientId, req.body)),
);

// Historia clínica (propietario y miembros autorizados; el super admin en modo soporte, sólo los formatos)
businessRoutes.get(
  "/:businessId/clinical-templates",
  handle((req) => clinicalService.listTemplates(req.ctx, req.params.businessId, req.query.all === "1")),
);
businessRoutes.post(
  "/:businessId/clinical-templates",
  handle((req) => clinicalTemplateService.create(req.ctx, req.params.businessId, req.body)),
);
businessRoutes.get(
  "/:businessId/clinical-templates/:templateId",
  handle((req) => clinicalTemplateService.get(req.ctx, req.params.businessId, req.params.templateId)),
);
businessRoutes.put(
  "/:businessId/clinical-templates/:templateId",
  handle((req) => clinicalTemplateService.update(req.ctx, req.params.businessId, req.params.templateId, req.body)),
);
businessRoutes.patch(
  "/:businessId/clinical-templates/:templateId/active",
  handle((req) => clinicalTemplateService.setActive(req.ctx, req.params.businessId, req.params.templateId, req.body?.active)),
);
businessRoutes.put(
  "/:businessId/clinical-default-template",
  handle((req) => clinicalTemplateService.setDefault(req.ctx, req.params.businessId, req.body?.templateId)),
);
businessRoutes.post(
  "/:businessId/clients/:clientId/clinical-record/attachments",
  handle((req) => clinicalAttachmentService.requestUpload(req.ctx, req.params.businessId, req.params.clientId, req.body)),
);
businessRoutes.post(
  "/:businessId/clinical-attachments/:attachmentId/complete",
  handle((req) => clinicalAttachmentService.completeUpload(req.ctx, req.params.businessId, req.params.attachmentId)),
);
businessRoutes.get(
  "/:businessId/clinical-attachments/:attachmentId/url",
  handle((req) => clinicalAttachmentService.downloadUrl(req.ctx, req.params.businessId, req.params.attachmentId)),
);
businessRoutes.get(
  "/:businessId/clients/:clientId/clinical-record",
  handle((req) => clinicalService.get(req.ctx, req.params.businessId, req.params.clientId)),
);
businessRoutes.put(
  "/:businessId/clients/:clientId/clinical-record/profile",
  handle((req) => clinicalService.saveProfile(req.ctx, req.params.businessId, req.params.clientId, req.body)),
);
businessRoutes.post(
  "/:businessId/clients/:clientId/clinical-record/notes",
  handle((req) => clinicalService.addNote(req.ctx, req.params.businessId, req.params.clientId, req.body)),
);
businessRoutes.post(
  "/:businessId/clinical-notes/:noteId/addenda",
  handle((req) => clinicalService.addAddendum(req.ctx, req.params.businessId, req.params.noteId, req.body)),
);

// Servicios
businessRoutes.get(
  "/:businessId/services",
  handle((req) => serviceService.list(req.ctx, req.params.businessId)),
);
businessRoutes.post(
  "/:businessId/services",
  handle((req) => serviceService.create(req.ctx, req.params.businessId, req.body)),
);
businessRoutes.put(
  "/:businessId/services/:serviceId",
  handle((req) => serviceService.update(req.ctx, req.params.businessId, req.params.serviceId, req.body)),
);
businessRoutes.delete(
  "/:businessId/services/:serviceId",
  handle((req) => serviceService.remove(req.ctx, req.params.businessId, req.params.serviceId)),
);

// Citas
businessRoutes.get(
  "/:businessId/appointments",
  handle((req) =>
    appointmentService.list(req.ctx, req.params.businessId, {
      from: queryParam(req, "from"),
      to: queryParam(req, "to"),
      clientId: queryParam(req, "clientId"),
    }),
  ),
);
businessRoutes.post(
  "/:businessId/appointments",
  handle((req) => appointmentService.create(req.ctx, req.params.businessId, req.body)),
);
// Citas por cerrar (spec 018): la lista, el contador del panel y «Marcar todas como completadas». Antes
// de /appointments/:appointmentId, que si no tomaría «to-close» por el id de una cita.
businessRoutes.get(
  "/:businessId/appointments/to-close",
  handle((req) => appointmentsToCloseService.list(req.ctx, req.params.businessId, req.query)),
);
businessRoutes.get(
  "/:businessId/appointments/to-close/count",
  handle((req) => appointmentsToCloseService.count(req.ctx, req.params.businessId)),
);
businessRoutes.post(
  "/:businessId/appointments/close-all",
  handle((req) => appointmentsToCloseService.closeAll(req.ctx, req.params.businessId, req.body)),
);
businessRoutes.get(
  "/:businessId/appointments/:appointmentId",
  handle((req) => appointmentService.getById(req.ctx, req.params.businessId, req.params.appointmentId)),
);
businessRoutes.put(
  "/:businessId/appointments/:appointmentId",
  handle((req) => appointmentService.update(req.ctx, req.params.businessId, req.params.appointmentId, req.body)),
);
businessRoutes.patch(
  "/:businessId/appointments/:appointmentId/status",
  handle((req) =>
    appointmentService.updateStatus(
      req.ctx,
      req.params.businessId,
      req.params.appointmentId,
      req.body?.status,
      req.body?.notify,
      req.body?.onlyIfOpen,
    ),
  ),
);
// Corregir una cita completada (spec 020): sólo el propietario, con un motivo que queda en la actividad.
businessRoutes.post(
  "/:businessId/appointments/:appointmentId/correct-status",
  handle((req) => appointmentService.correctStatus(req.ctx, req.params.businessId, req.params.appointmentId, req.body)),
);
businessRoutes.patch(
  "/:businessId/appointments/:appointmentId/arrival",
  handle((req) => setAppointmentArrival(req.ctx, req.params.businessId, req.params.appointmentId, req.body?.arrived)),
);
businessRoutes.patch(
  "/:businessId/appointments/:appointmentId/payment",
  handle((req) => paymentService.setPaid(req.ctx, req.params.businessId, req.params.appointmentId, req.body?.paid)),
);
businessRoutes.get(
  "/:businessId/appointments/:appointmentId/receipts",
  handle((req) => paymentService.listReceipts(req.ctx, req.params.businessId, req.params.appointmentId)),
);
businessRoutes.get(
  "/:businessId/payment-receipts/:receiptId/url",
  handle((req) => paymentService.receiptUrl(req.ctx, req.params.businessId, req.params.receiptId)),
);
// Citas que se repiten (spec 011): la lista de fechas (no cambia nada), crear la serie y «Cancelar ésta
// y las siguientes».
businessRoutes.post(
  "/:businessId/appointment-series/preview",
  handle((req) => appointmentSeriesService.preview(req.ctx, req.params.businessId, req.body)),
);
businessRoutes.post(
  "/:businessId/appointment-series",
  handle(async (req, res) => {
    const created = await appointmentSeriesService.create(req.ctx, req.params.businessId, req.body);
    res.status(201);
    return created;
  }),
);
businessRoutes.post(
  "/:businessId/appointments/:appointmentId/cancel-following",
  handle((req) => appointmentSeriesService.cancelFollowing(req.ctx, req.params.businessId, req.params.appointmentId, req.body)),
);
businessRoutes.post(
  "/:businessId/appointments/:appointmentId/whatsapp-notice",
  handle((req) =>
    appointmentService.logWhatsAppNotice(req.ctx, req.params.businessId, req.params.appointmentId, req.body?.kind, req.body?.clientId),
  ),
);

// Horario semanal y bloqueos
businessRoutes.get(
  "/:businessId/schedules",
  handle((req) => scheduleService.list(req.ctx, req.params.businessId)),
);
businessRoutes.put(
  "/:businessId/schedules",
  handle((req) => scheduleService.saveWeek(req.ctx, req.params.businessId, req.body)),
);
businessRoutes.get(
  "/:businessId/blocked-times",
  handle((req) => blockedTimeService.list(req.ctx, req.params.businessId)),
);
businessRoutes.post(
  "/:businessId/blocked-times",
  handle((req) => blockedTimeService.create(req.ctx, req.params.businessId, req.body)),
);
businessRoutes.delete(
  "/:businessId/blocked-times/:blockedTimeId",
  handle((req) => blockedTimeService.remove(req.ctx, req.params.businessId, req.params.blockedTimeId)),
);

// Emails y auditoría
businessRoutes.get(
  "/:businessId/notifications",
  handle((req) => notificationService.list(req.ctx, req.params.businessId)),
);
businessRoutes.get(
  "/:businessId/audit-logs",
  handle((req) => auditLogService.list(req.ctx, req.params.businessId, req.query)),
);

// Centro de avisos del panel (spec 014): la campana de cada persona del equipo (cada una ve lo suyo y
// lleva su propio leído). El super admin en modo soporte recibe 403. Leer no va a la actividad.
businessRoutes.get(
  "/:businessId/notices/unread",
  handle((req) => panelNoticeService.unread(req.ctx, req.params.businessId)),
);
businessRoutes.get(
  "/:businessId/notices",
  handle((req) => panelNoticeService.list(req.ctx, req.params.businessId, req.query)),
);
businessRoutes.post(
  "/:businessId/notices/read-all",
  handle((req) => panelNoticeService.markAllRead(req.ctx, req.params.businessId)),
);
businessRoutes.post(
  "/:businessId/notices/:noticeId/read",
  handle((req) => panelNoticeService.markRead(req.ctx, req.params.businessId, req.params.noticeId)),
);
