// Copia de agenda-front/src/lib/email/templates.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { APP_NAME } from "../constants/app.ts";
import { capitalize, formatCurrency, formatLongDate, formatTimeRange } from "../format.ts";
import { describeHomeVisit, getDirectionsUrl, getPlaceMapsUrl, hasMapPoint } from "../maps.ts";
import type { HomeVisitAddress, ISODate } from "../../types/index.ts";

/**
 * Plantillas de email (texto plano) en funciones puras: se pueden reutilizar tal
 * cual en el backend (agenda-backend tiene una copia y envía los emails por Gmail).
 */

export interface EmailContent {
  subject: string;
  body: string;
}

export interface AppointmentEmailData {
  clientName: string;
  businessName: string;
  businessAddress: string;
  /** Punto exacto del local en el mapa (null: se usa la dirección escrita). */
  businessLat: number | null;
  businessLng: number | null;
  businessPhone: string;
  professionalName: string;
  serviceName: string;
  date: ISODate;
  startTime: string;
  endTime: string;
  price: number;
  /** false: el email no menciona el precio. */
  showPrice: boolean;
  currency: string;
  cancellationPolicy: string;
  bookingUrl: string;
  /** null = en el local del negocio. */
  homeVisit: HomeVisitAddress | null;
}

const signature = (data: Pick<AppointmentEmailData, "businessName" | "businessPhone" | "businessAddress">) =>
  [data.businessName, data.businessAddress, data.businessPhone].filter(Boolean).join("\n");

function appointmentDetails(data: AppointmentEmailData): string {
  const place = { address: data.businessAddress, lat: data.businessLat, lng: data.businessLng };
  return [
    `Servicio: ${data.serviceName}`,
    `Profesional: ${data.professionalName}`,
    `Fecha: ${capitalize(formatLongDate(data.date))}`,
    `Hora: ${formatTimeRange(data.startTime, data.endTime)}`,
    data.showPrice && `Precio: ${formatCurrency(data.price, data.currency)}`,
    ...(data.homeVisit
      ? [`Lugar: a domicilio – ${describeHomeVisit(data.homeVisit)}`, `Ubicación: ${getPlaceMapsUrl(data.homeVisit)}`]
      : [
          data.businessAddress && `Dirección: ${data.businessAddress}`,
          (data.businessAddress || hasMapPoint(place)) && `Cómo llegar: ${getDirectionsUrl(place)}`,
        ]),
  ]
    .filter(Boolean)
    .join("\n");
}

const lines = (...parts: (string | false | null | undefined)[]) => parts.filter((p) => p !== false && p != null).join("\n\n");

export const emailTemplates = {
  welcome: (firstName: string): EmailContent => ({
    subject: `Bienvenido a ${APP_NAME}`,
    body: lines(
      `Hola ${firstName}:`,
      `Te damos la bienvenida a ${APP_NAME}. Ya puedes configurar tu negocio, tus servicios y tus horarios, y compartir tu página de reservas con tus clientes.`,
      `El equipo de ${APP_NAME}`,
    ),
  }),

  teamInvite: (data: {
    firstName: string;
    businessName: string;
    roleLabel: string;
    email: string;
    password: string;
    loginUrl: string;
  }): EmailContent => ({
    subject: `Te invitaron a ${data.businessName} en ${APP_NAME}`,
    body: lines(
      `Hola ${data.firstName}:`,
      `Te añadieron al equipo de ${data.businessName} con el rol ${data.roleLabel}.`,
      `Inicia sesión en ${data.loginUrl} con:\nEmail: ${data.email}\nContraseña: ${data.password}`,
      "Guarda este email: si necesitas otra contraseña, pídesela al soporte.",
    ),
  }),

  businessCreated: (data: {
    firstName: string;
    businessName: string;
    email: string;
    password: string;
    loginUrl: string;
    bookingUrl: string;
  }): EmailContent => ({
    subject: `Tu negocio ${data.businessName} ya está en ${APP_NAME}`,
    body: lines(
      `Hola ${data.firstName}:`,
      `Creamos la cuenta de ${data.businessName} en ${APP_NAME}. Ya puedes gestionar tu agenda, tus clientes y tus servicios.`,
      `Inicia sesión en ${data.loginUrl} con:\nEmail: ${data.email}\nContraseña: ${data.password}`,
      "Guarda este email: si necesitas otra contraseña, pídesela al soporte.",
      `Tu página de reservas: ${data.bookingUrl}`,
      `El equipo de ${APP_NAME}`,
    ),
  }),

  businessSuspended: (firstName: string, businessName: string, supportEmail: string): EmailContent => ({
    subject: `${businessName} fue suspendido`,
    body: lines(
      `Hola ${firstName}:`,
      `Suspendimos temporalmente la cuenta de ${businessName}. Mientras tanto, el panel y la página de reservas no estarán disponibles.`,
      `Si crees que es un error o quieres reactivarla, escríbenos a ${supportEmail}.`,
      `El equipo de ${APP_NAME}`,
    ),
  }),

  businessReactivated: (firstName: string, businessName: string, loginUrl: string): EmailContent => ({
    subject: `${businessName} está activo de nuevo`,
    body: lines(
      `Hola ${firstName}:`,
      `Reactivamos la cuenta de ${businessName}. Tu agenda y tu página de reservas vuelven a estar disponibles.`,
      `Entra en ${loginUrl}`,
      `El equipo de ${APP_NAME}`,
    ),
  }),

  passwordChanged: (firstName: string, email: string, password: string, loginUrl: string): EmailContent => ({
    subject: "Tu nueva contraseña",
    body: lines(
      `Hola ${firstName}:`,
      `El equipo de soporte de ${APP_NAME} cambió tu contraseña.`,
      `Inicia sesión en ${loginUrl} con:\nEmail: ${email}\nContraseña: ${password}`,
      "Si no pediste este cambio, responde a este email.",
    ),
  }),

  planChangeRequested: (data: {
    businessName: string;
    requestedByName: string;
    requestedByEmail: string;
    currentPlanName: string;
    requestedPlanName: string;
    reviewUrl: string;
  }): EmailContent => ({
    subject: `${data.businessName} solicita el plan ${data.requestedPlanName}`,
    body: lines(
      `${data.requestedByName} (${data.requestedByEmail}) solicita cambiar ${data.businessName} del plan ${data.currentPlanName} al plan ${data.requestedPlanName}.`,
      `Apruébala o recházala en el panel de la plataforma: ${data.reviewUrl}`,
    ),
  }),

  planChangeApproved: (firstName: string, businessName: string, planName: string, settingsUrl: string): EmailContent => ({
    subject: `Tu plan ${planName} ya está activo`,
    body: lines(
      `Hola ${firstName}:`,
      `Aprobamos tu solicitud: ${businessName} ya tiene el plan ${planName}.`,
      `Puedes ver tu suscripción en ${settingsUrl}`,
      `El equipo de ${APP_NAME}`,
    ),
  }),

  planChanged: (firstName: string, businessName: string, planName: string, settingsUrl: string): EmailContent => ({
    subject: `Tu plan ahora es ${planName}`,
    body: lines(
      `Hola ${firstName}:`,
      `El equipo de ${APP_NAME} cambió el plan de ${businessName} a ${planName}.`,
      `Puedes ver tu suscripción en ${settingsUrl}`,
      `El equipo de ${APP_NAME}`,
    ),
  }),

  planChangeRejected: (
    firstName: string,
    businessName: string,
    planName: string,
    reason: string,
    supportEmail: string,
  ): EmailContent => ({
    subject: `Tu solicitud del plan ${planName}`,
    body: lines(
      `Hola ${firstName}:`,
      `No pudimos aprobar el cambio de ${businessName} al plan ${planName}.`,
      reason && `Motivo: ${reason}`,
      `Si tienes dudas, escríbenos a ${supportEmail}.`,
      `El equipo de ${APP_NAME}`,
    ),
  }),

  bookingCreated: (data: AppointmentEmailData): EmailContent => ({
    subject: "Tu cita ha sido reservada",
    body: lines(
      `Hola ${data.clientName}:`,
      `Tu cita en ${data.businessName} ha sido reservada. Te avisaremos cuando quede confirmada.`,
      appointmentDetails(data),
      data.cancellationPolicy && `Política de cancelación: ${data.cancellationPolicy}`,
      signature(data),
    ),
  }),

  bookingReceived: (data: AppointmentEmailData): EmailContent => ({
    subject: `Nueva reserva: ${data.clientName} · ${capitalize(formatLongDate(data.date))} ${data.startTime}`,
    body: lines(
      `Recibiste una nueva reserva online de ${data.clientName}.`,
      // El negocio siempre ve el precio real, aunque no se muestre a los clientes.
      appointmentDetails({ ...data, showPrice: true }),
      "Entra a tu agenda para confirmarla.",
    ),
  }),

  appointmentConfirmed: (data: AppointmentEmailData): EmailContent => ({
    subject: "Tu cita ha sido confirmada",
    body: lines(`Hola ${data.clientName}:`, `Tu cita en ${data.businessName} está confirmada.`, appointmentDetails(data), signature(data)),
  }),

  appointmentUpdated: (data: AppointmentEmailData): EmailContent => ({
    subject: "Tu cita ha sido modificada",
    body: lines(
      `Hola ${data.clientName}:`,
      `Tu cita en ${data.businessName} ha sido modificada. Estos son los nuevos datos:`,
      appointmentDetails(data),
      signature(data),
    ),
  }),

  appointmentCancelled: (data: AppointmentEmailData): EmailContent => ({
    subject: "Tu cita ha sido cancelada",
    body: lines(
      `Hola ${data.clientName}:`,
      `Tu cita del ${formatLongDate(data.date)} a las ${data.startTime} en ${data.businessName} ha sido cancelada.`,
      `Puedes reservar una nueva cita en ${data.bookingUrl}`,
      signature(data),
    ),
  }),

  appointmentReminder: (data: AppointmentEmailData, when: "hoy" | "mañana" | null): EmailContent => ({
    subject: when ? `Recuerda que tienes una cita ${when}` : "Recordatorio de tu cita",
    body: lines(`Hola ${data.clientName}:`, "Te recordamos tu próxima cita:", appointmentDetails(data), signature(data)),
  }),
};
