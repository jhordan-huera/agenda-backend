// Copia de agenda-front/src/lib/email/templates.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { APP_NAME } from "../constants/app.ts";
import { capitalize, formatCurrency, formatLongDate, formatTimeRange } from "../format.ts";
import { describeHomeVisit, getDirectionsUrl, getPlaceMapsUrl, hasMapPoint } from "../maps.ts";
import type { HomeVisitAddress, ISODate } from "../../types/index.ts";
import { composeEmail, type EmailBlock, type EmailContent, type EmailMessage } from "./layout.ts";

/**
 * Plantillas de email en funciones puras (el backend tiene una copia y las envía por Gmail).
 * Cada una describe su contenido en bloques; `composeEmail` produce el HTML y el texto.
 */

export type { EmailContent } from "./layout.ts";

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

/* ------------------------------------------------------------------ Piezas -- */

const PLATFORM_BRAND = { name: APP_NAME, caption: "Agenda y reservas online" };
const PLATFORM_SIGNATURE = [`El equipo de ${APP_NAME}`];
const PLATFORM_FOOTER = `${APP_NAME} · Agenda y reservas online para profesionales`;

type MessageContent = Omit<EmailMessage, "brand" | "signature" | "footer">;

/** Email de la plataforma (cuentas, planes): marca y firma de Agenda360. */
const platformEmail = (message: MessageContent): EmailContent =>
  composeEmail({ ...message, brand: PLATFORM_BRAND, signature: PLATFORM_SIGNATURE, footer: PLATFORM_FOOTER });

/** Email a un cliente sobre su cita: con la marca y los datos del negocio. */
const clientEmail = (data: AppointmentEmailData, message: MessageContent): EmailContent =>
  composeEmail({
    ...message,
    brand: { name: data.businessName, caption: data.professionalName !== data.businessName ? data.professionalName : undefined },
    signature: [data.businessName, data.businessAddress, data.businessPhone].filter(Boolean),
    footer: `Reserva gestionada con ${APP_NAME}.`,
  });

const credentials = (email: string, password: string): EmailBlock => ({
  kind: "details",
  title: "Tus datos de acceso",
  rows: [
    { label: "Email", value: email },
    { label: "Contraseña", value: password, mono: true },
  ],
});

/** Datos de la cita: servicio, profesional, fecha, hora, precio y lugar (con enlace al mapa). */
function appointmentDetails(data: AppointmentEmailData, title = "Tu cita"): EmailBlock {
  const place = { address: data.businessAddress, lat: data.businessLat, lng: data.businessLng };
  const rows: Extract<EmailBlock, { kind: "details" }>["rows"] = [
    { label: "Servicio", value: data.serviceName },
    { label: "Profesional", value: data.professionalName },
    { label: "Fecha", value: capitalize(formatLongDate(data.date)) },
    { label: "Hora", value: formatTimeRange(data.startTime, data.endTime) },
  ];
  if (data.showPrice) rows.push({ label: "Precio", value: formatCurrency(data.price, data.currency) });
  if (data.homeVisit) {
    rows.push({ label: "Lugar", value: `A domicilio: ${describeHomeVisit(data.homeVisit)}` });
    rows.push({ label: "Ubicación", value: "Ver en el mapa", href: getPlaceMapsUrl(data.homeVisit) });
  } else {
    if (data.businessAddress) rows.push({ label: "Dirección", value: data.businessAddress });
    if (data.businessAddress || hasMapPoint(place)) {
      rows.push({ label: "Cómo llegar", value: "Abrir en Google Maps", href: getDirectionsUrl(place) });
    }
  }
  return { kind: "details", title, rows };
}

const policy = (data: AppointmentEmailData): EmailBlock[] =>
  data.cancellationPolicy ? [{ kind: "note", text: `Política de cancelación: ${data.cancellationPolicy}` }] : [];

/* --------------------------------------------------------------- Plantillas -- */

export const emailTemplates = {
  welcome: (firstName: string): EmailContent =>
    platformEmail({
      subject: `Bienvenido a ${APP_NAME}`,
      preheader: "Configura tu negocio y comparte tu página de reservas.",
      title: `Bienvenido a ${APP_NAME}`,
      greeting: `Hola ${firstName}:`,
      blocks: [
        {
          kind: "text",
          text: "Ya puedes configurar tu negocio, tus servicios y tus horarios, y compartir tu página de reservas con tus clientes.",
        },
      ],
    }),

  teamInvite: (data: {
    firstName: string;
    businessName: string;
    roleLabel: string;
    email: string;
    password: string;
    loginUrl: string;
  }): EmailContent =>
    platformEmail({
      subject: `Te invitaron a ${data.businessName} en ${APP_NAME}`,
      preheader: `Ya formas parte del equipo de ${data.businessName}.`,
      title: `Te invitaron a ${data.businessName}`,
      greeting: `Hola ${data.firstName}:`,
      blocks: [
        { kind: "text", text: `Te añadieron al equipo de ${data.businessName} con el rol ${data.roleLabel}.` },
        credentials(data.email, data.password),
        { kind: "button", label: "Iniciar sesión", url: data.loginUrl },
        { kind: "note", text: "Guarda este email: si necesitas otra contraseña, pídesela al soporte." },
      ],
    }),

  businessCreated: (data: {
    firstName: string;
    businessName: string;
    email: string;
    password: string;
    loginUrl: string;
    bookingUrl: string;
  }): EmailContent =>
    platformEmail({
      subject: `Tu negocio ${data.businessName} ya está en ${APP_NAME}`,
      preheader: "Tus datos de acceso y tu página de reservas.",
      title: `${data.businessName} ya está en ${APP_NAME}`,
      greeting: `Hola ${data.firstName}:`,
      blocks: [
        { kind: "text", text: `Creamos la cuenta de ${data.businessName}. Ya puedes gestionar tu agenda, tus clientes y tus servicios.` },
        credentials(data.email, data.password),
        { kind: "button", label: "Iniciar sesión", url: data.loginUrl },
        {
          kind: "details",
          title: "Tu página de reservas",
          rows: [{ label: "Compártela con tus clientes", value: data.bookingUrl.replace(/^https?:\/\//, ""), href: data.bookingUrl }],
        },
        { kind: "note", text: "Guarda este email: si necesitas otra contraseña, pídesela al soporte." },
      ],
    }),

  /** `supportContact`: email (y teléfono) de soporte, ver formatSupportContact. */
  businessSuspended: (firstName: string, businessName: string, supportContact: string): EmailContent =>
    platformEmail({
      subject: `${businessName} fue suspendido`,
      preheader: "El panel y la página de reservas no están disponibles por ahora.",
      title: `${businessName} fue suspendido`,
      greeting: `Hola ${firstName}:`,
      blocks: [
        {
          kind: "callout",
          tone: "warning",
          text: `Suspendimos temporalmente la cuenta de ${businessName}. Mientras tanto, el panel y la página de reservas no estarán disponibles.`,
        },
        { kind: "text", text: `Si crees que es un error o quieres reactivarla, escríbenos a ${supportContact}.` },
      ],
    }),

  businessReactivated: (firstName: string, businessName: string, loginUrl: string): EmailContent =>
    platformEmail({
      subject: `${businessName} está activo de nuevo`,
      preheader: "Tu agenda y tu página de reservas vuelven a estar disponibles.",
      title: `${businessName} está activo de nuevo`,
      greeting: `Hola ${firstName}:`,
      blocks: [
        { kind: "text", text: `Reactivamos la cuenta de ${businessName}. Tu agenda y tu página de reservas vuelven a estar disponibles.` },
        { kind: "button", label: "Entrar a mi agenda", url: loginUrl },
      ],
    }),

  passwordChanged: (firstName: string, email: string, password: string, loginUrl: string): EmailContent =>
    platformEmail({
      subject: "Tu nueva contraseña",
      preheader: "El soporte cambió tu contraseña.",
      title: "Tu nueva contraseña",
      greeting: `Hola ${firstName}:`,
      blocks: [
        { kind: "text", text: `El equipo de soporte de ${APP_NAME} cambió tu contraseña.` },
        credentials(email, password),
        { kind: "button", label: "Iniciar sesión", url: loginUrl },
        { kind: "note", text: "Si no pediste este cambio, responde a este email." },
      ],
    }),

  planChangeRequested: (data: {
    businessName: string;
    requestedByName: string;
    requestedByEmail: string;
    currentPlanName: string;
    requestedPlanName: string;
    reviewUrl: string;
  }): EmailContent =>
    platformEmail({
      subject: `${data.businessName} solicita el plan ${data.requestedPlanName}`,
      preheader: `${data.requestedByName} quiere pasar al plan ${data.requestedPlanName}.`,
      title: "Nueva solicitud de cambio de plan",
      blocks: [
        {
          kind: "details",
          rows: [
            { label: "Negocio", value: data.businessName },
            { label: "Solicitado por", value: `${data.requestedByName} (${data.requestedByEmail})` },
            { label: "Plan actual", value: data.currentPlanName },
            { label: "Plan solicitado", value: data.requestedPlanName },
          ],
        },
        { kind: "button", label: "Revisar la solicitud", url: data.reviewUrl },
      ],
    }),

  planChangeApproved: (firstName: string, businessName: string, planName: string, settingsUrl: string): EmailContent =>
    platformEmail({
      subject: `Tu plan ${planName} ya está activo`,
      preheader: `${businessName} ya tiene el plan ${planName}.`,
      title: `Tu plan ${planName} ya está activo`,
      greeting: `Hola ${firstName}:`,
      blocks: [
        { kind: "text", text: `Aprobamos tu solicitud: ${businessName} ya tiene el plan ${planName}.` },
        { kind: "button", label: "Ver mi suscripción", url: settingsUrl },
      ],
    }),

  planChanged: (firstName: string, businessName: string, planName: string, settingsUrl: string): EmailContent =>
    platformEmail({
      subject: `Tu plan ahora es ${planName}`,
      preheader: `${businessName} pasó al plan ${planName}.`,
      title: `Tu plan ahora es ${planName}`,
      greeting: `Hola ${firstName}:`,
      blocks: [
        { kind: "text", text: `El equipo de ${APP_NAME} cambió el plan de ${businessName} a ${planName}.` },
        { kind: "button", label: "Ver mi suscripción", url: settingsUrl },
      ],
    }),

  planChangeRejected: (
    firstName: string,
    businessName: string,
    planName: string,
    reason: string,
    supportContact: string,
  ): EmailContent =>
    platformEmail({
      subject: `Tu solicitud del plan ${planName}`,
      preheader: `No pudimos aprobar el cambio al plan ${planName}.`,
      title: `Tu solicitud del plan ${planName}`,
      greeting: `Hola ${firstName}:`,
      blocks: [
        { kind: "text", text: `No pudimos aprobar el cambio de ${businessName} al plan ${planName}.` },
        ...(reason ? [{ kind: "callout", tone: "warning", text: `Motivo: ${reason}` } satisfies EmailBlock] : []),
        { kind: "text", text: `Si tienes dudas, escríbenos a ${supportContact}.` },
      ],
    }),

  bookingCreated: (data: AppointmentEmailData): EmailContent =>
    clientEmail(data, {
      subject: "Tu cita ha sido reservada",
      preheader: `${capitalize(formatLongDate(data.date))} a las ${data.startTime} en ${data.businessName}.`,
      title: "Tu cita ha sido reservada",
      greeting: `Hola ${data.clientName}:`,
      blocks: [
        { kind: "text", text: `Tu cita en ${data.businessName} ha sido reservada. Te avisaremos cuando quede confirmada.` },
        appointmentDetails(data),
        ...policy(data),
      ],
    }),

  bookingReceived: (data: AppointmentEmailData): EmailContent =>
    platformEmail({
      subject: `Nueva reserva: ${data.clientName} · ${capitalize(formatLongDate(data.date))} ${data.startTime}`,
      preheader: `${data.clientName} reservó ${data.serviceName}.`,
      title: "Recibiste una nueva reserva",
      blocks: [
        { kind: "text", text: `${data.clientName} reservó una cita desde tu página de reservas.` },
        // El negocio siempre ve el precio real, aunque no se muestre a los clientes.
        appointmentDetails({ ...data, showPrice: true }, "La reserva"),
        { kind: "text", text: "Entra a tu agenda para confirmarla." },
      ],
    }),

  appointmentConfirmed: (data: AppointmentEmailData): EmailContent =>
    clientEmail(data, {
      subject: "Tu cita ha sido confirmada",
      preheader: `Te esperamos el ${formatLongDate(data.date)} a las ${data.startTime}.`,
      title: "Tu cita está confirmada",
      greeting: `Hola ${data.clientName}:`,
      blocks: [{ kind: "text", text: `Tu cita en ${data.businessName} está confirmada.` }, appointmentDetails(data), ...policy(data)],
    }),

  appointmentUpdated: (data: AppointmentEmailData): EmailContent =>
    clientEmail(data, {
      subject: "Tu cita ha sido modificada",
      preheader: `Nuevo horario: ${formatLongDate(data.date)} a las ${data.startTime}.`,
      title: "Tu cita ha sido modificada",
      greeting: `Hola ${data.clientName}:`,
      blocks: [
        { kind: "text", text: `Tu cita en ${data.businessName} ha sido modificada. Estos son los nuevos datos:` },
        appointmentDetails(data),
      ],
    }),

  appointmentCancelled: (data: AppointmentEmailData): EmailContent =>
    clientEmail(data, {
      subject: "Tu cita ha sido cancelada",
      preheader: `Tu cita del ${formatLongDate(data.date)} fue cancelada.`,
      title: "Tu cita ha sido cancelada",
      greeting: `Hola ${data.clientName}:`,
      blocks: [
        {
          kind: "callout",
          tone: "warning",
          text: `Tu cita del ${formatLongDate(data.date)} a las ${data.startTime} en ${data.businessName} ha sido cancelada.`,
        },
        { kind: "text", text: "Si quieres, puedes reservar una nueva cita:" },
        { kind: "button", label: "Reservar una nueva cita", url: data.bookingUrl },
      ],
    }),

  appointmentReminder: (data: AppointmentEmailData, when: "hoy" | "mañana" | null): EmailContent =>
    clientEmail(data, {
      subject: when ? `Recuerda que tienes una cita ${when}` : "Recordatorio de tu cita",
      preheader: `${capitalize(formatLongDate(data.date))} a las ${data.startTime} en ${data.businessName}.`,
      title: when ? `Tu cita es ${when}` : "Recordatorio de tu cita",
      greeting: `Hola ${data.clientName}:`,
      blocks: [{ kind: "text", text: "Te recordamos tu próxima cita:" }, appointmentDetails(data), ...policy(data)],
    }),
};
