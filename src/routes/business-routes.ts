import { Router } from "express";
import { handle, queryParam } from "../http/handlers.ts";
import { businessService, subscriptionService, teamService, userService } from "../services/account-service.ts";
import { auditLogService, notificationService } from "../services/activity-service.ts";
import { clinicalService } from "../services/clinical-service.ts";
import {
  appointmentService,
  blockedTimeService,
  clientService,
  scheduleService,
  serviceService,
} from "../services/business-data-service.ts";
import type { AuditEntityType } from "../shared/types/index.ts";

/* ------------------------------------------------------------ /api/users ---- */

export const userRoutes = Router();

userRoutes.get(
  "/:userId",
  handle((req) => userService.getById(req.ctx, req.params.userId)),
);
userRoutes.put(
  "/:userId",
  handle((req) => userService.update(req.ctx, req.params.userId, req.body)),
);

/* ------------------------------------------------------- /api/businesses ---- */

/**
 * Todo lo que cuelga de /api/businesses/:businessId pertenece a un negocio: cada
 * servicio comprueba que la sesión es miembro y que su rol tiene permiso.
 */
export const businessRoutes = Router();

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
businessRoutes.post(
  "/:businessId/clients",
  handle((req) => clientService.create(req.ctx, req.params.businessId, req.body)),
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

// Historia clínica (propietario, miembros autorizados y super admin en modo soporte)
businessRoutes.get(
  "/:businessId/clinical-templates",
  handle((req) => clinicalService.listTemplates(req.ctx, req.params.businessId)),
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
businessRoutes.put(
  "/:businessId/appointments/:appointmentId",
  handle((req) => appointmentService.update(req.ctx, req.params.businessId, req.params.appointmentId, req.body)),
);
businessRoutes.patch(
  "/:businessId/appointments/:appointmentId/status",
  handle((req) =>
    appointmentService.updateStatus(req.ctx, req.params.businessId, req.params.appointmentId, req.body?.status),
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
businessRoutes.post(
  "/:businessId/notifications/reminders",
  handle(async (req) => ({ sent: await notificationService.runReminderJob(req.ctx, req.params.businessId) })),
);
businessRoutes.get(
  "/:businessId/audit-logs",
  handle((req) =>
    auditLogService.list(req.ctx, req.params.businessId, {
      entityType: queryParam(req, "entityType") as AuditEntityType | undefined,
      entityId: queryParam(req, "entityId"),
    }),
  ),
);
