// Copia de agenda-front/src/lib/email/templates.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { APP_NAME } from "../constants/app.ts";
import { BANK_ACCOUNT_TYPE_LABELS, describeTimezone, formatCostAmount, formatUsdAmount } from "../constants/business.ts";
import { capitalize, formatDate, formatLongDate, formatPrice, formatShortDate, formatTimeRange, joinNames } from "../format.ts";
import { describeHomeVisit, getDirectionsUrl, getPlaceMapsUrl, hasMapPoint } from "../maps.ts";
import type { BankAccount, BillingPaidMethod, HomeVisitAddress, ISODate } from "../../types/index.ts";
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
  /** null = en el local del negocio (o virtual). */
  homeVisit: HomeVisitAddress | null;
  /** Por videollamada, con el enlace del profesional (null: aún no lo configuró). */
  isVirtual: boolean;
  meetingUrl: string | null;
  /**
   * Pago por transferencia: las cuentas de la agenda (vale cualquiera; la primera es la principal) y
   * el enlace para subir el comprobante (null: no aplica).
   */
  payment: { bankAccounts: BankAccount[]; url: string } | null;
  /**
   * Zona horaria del negocio (p. ej. America/Guayaquil). En las citas virtuales la hora lleva la
   * zona ("10:00 (hora de Ecuador, GMT-5)"): el paciente puede estar en otro país.
   */
  timezone?: string;
  /**
   * Copia del email al profesional de la cita: el mismo email que recibe el paciente, con el
   * paciente en el asunto y, arriba, una nota y el botón para abrir la cita en la agenda.
   * `byPatient`: la canceló el paciente desde «Tu cita» (spec 010), y la nota lo dice.
   */
  professionalCopy?: { agendaUrl: string; pending: boolean; byPatient?: boolean };
  /**
   * Página «Tu cita» de quien recibe el email (spec 010): su enlace, si podrá cancelar desde ahí
   * cuando salga el email y si ya confirmó que va. Nunca en la copia al profesional.
   */
  appointmentPage?: { url: string; canCancel: boolean; confirmed: boolean } | null;
  /**
   * Sesión en pareja o en familia reservada por la página: quién la reservó, en el email de solicitud
   * de cada una de las demás personas (no reservaron ellas).
   */
  bookedBy?: string;
  /**
   * Reserva «Por verificar» (spec 009): alguna persona escribió la cédula de un paciente del negocio
   * con otro email y otro teléfono. Sólo lo dice el email al negocio, para que la revise.
   */
  toVerify?: boolean;
}

/**
 * Una cita de una serie en los emails (spec 011): su fecha, su franja y el enlace a la página «Tu cita»
 * de quien recibe el email (spec 010). Sin enlace en la copia al profesional: es del paciente.
 */
export interface SeriesEmailDate {
  date: ISODate;
  startTime: string;
  endTime: string;
  url?: string | null;
}

/** Las fechas de una serie (spec 011): `pending`, la serie quedó pendiente de confirmar. */
export type SeriesEmailData = AppointmentEmailData & { dates: SeriesEmailDate[]; pending?: boolean };

/**
 * Una cita como invitación de calendario (spec 027), al profesional. Sólo lo que sale en el evento: los
 * pacientes a medias ("Juan P."), nunca su contacto, su cédula ni nada de la historia clínica, y el lugar
 * sin la dirección del paciente. `kind`: la primera invitación de la cita, su cambio, su cancelación o
 * que pasó a otra agenda (al profesional anterior le llega la cancelación del evento).
 */
export interface CalendarInviteEmailData {
  kind: "new" | "updated" | "cancelled" | "moved";
  /** El título del evento: "Juan P. · Terapia individual", con «Por confirmar · » delante si está pendiente. */
  summary: string;
  /** Los pacientes a medias, el principal primero. */
  clientNames: string[];
  serviceName: string;
  professionalName: string;
  businessName: string;
  date: ISODate;
  startTime: string;
  endTime: string;
  /** La dirección del negocio, «En línea» (con su enlace) o «A domicilio». */
  place: string;
  /** «Ver en Agenda360»: la cita en la agenda del panel. */
  agendaUrl: string;
}

/**
 * Un cobro de la mensualidad en los emails al propietario (spec 029): el negocio, el día de pago (de él
 * sale el mes: «Tu mensualidad de noviembre») y lo que paga, con la mensualidad y el descuento de referidos
 * si lo hay. Son de la plataforma: los ve sólo el propietario, nunca su equipo.
 */
export interface BillingEmailData {
  firstName: string;
  businessName: string;
  dueDate: ISODate;
  /** Lo que se paga: `baseAmount − referralDiscount`. */
  amount: number;
  baseAmount: number;
  referralDiscount: number;
  referralCount: number;
  /** El panel: al entrar, la pantalla de pago se abre sola. */
  panelUrl: string;
}

/* ------------------------------------------------------------------ Piezas -- */

const PLATFORM_BRAND = { name: APP_NAME, caption: "Agenda y reservas online" };
const PLATFORM_SIGNATURE = [`El equipo de ${APP_NAME}`];
const PLATFORM_FOOTER = `${APP_NAME} · Agenda y reservas online para profesionales`;

type MessageContent = Omit<EmailMessage, "brand" | "signature" | "footer">;

/** Email de la plataforma (cuentas, planes): marca y firma de Agenda360. */
const platformEmail = (message: MessageContent): EmailContent =>
  composeEmail({ ...message, brand: PLATFORM_BRAND, signature: PLATFORM_SIGNATURE, footer: PLATFORM_FOOTER });

/** La copia al profesional: "Copia · Paciente: asunto" y, antes del email, la nota y el botón de la agenda. */
function asProfessionalCopy(data: AppointmentEmailData, message: MessageContent): Partial<MessageContent> {
  if (!data.professionalCopy) return {};
  const { agendaUrl, pending, byPatient } = data.professionalCopy;
  return {
    subject: `Copia · ${data.clientName}: ${message.subject}`,
    preheader: `Copia del email que recibió ${data.clientName}.`,
    before: [
      {
        kind: "callout",
        text: `Copia para ti del email que recibió ${data.clientName}.${byPatient ? " La canceló el paciente desde su email." : ""}${pending ? " La cita está pendiente: confírmala en tu agenda." : ""}`,
      },
      { kind: "button", label: "Ver en la agenda", url: agendaUrl },
    ],
  };
}

/** Email a un cliente sobre su cita: con la marca y los datos del negocio. */
const clientEmail = (data: AppointmentEmailData, message: MessageContent): EmailContent =>
  composeEmail({
    ...message,
    ...asProfessionalCopy(data, message),
    brand: { name: data.businessName, caption: data.professionalName !== data.businessName ? data.professionalName : undefined },
    signature: [data.businessName, data.businessAddress, data.businessPhone].filter(Boolean),
    footer: `Reserva gestionada con ${APP_NAME}.`,
  });

/** " (hora de Ecuador, GMT-5)" en las citas virtuales; "" en las demás o sin zona. `date`: el día (otra cita de una serie). */
function zoneSuffix(data: AppointmentEmailData, date: ISODate = data.date): string {
  // El desfase de ese día (horario de verano): a mediodía UTC, nunca en pleno cambio de hora.
  return data.isVirtual && data.timezone ? ` (${describeTimezone(data.timezone, new Date(`${date}T12:00:00Z`))})` : "";
}

/** La hora de inicio, con la zona en las citas virtuales: "10:00 (hora de Ecuador, GMT-5)". */
const startAt = (data: AppointmentEmailData) => `${data.startTime}${zoneSuffix(data)}`;

const credentials = (email: string, password: string): EmailBlock => ({
  kind: "details",
  title: "Tus datos de acceso",
  rows: [
    { label: "Email", value: email },
    { label: "Contraseña", value: password, mono: true },
  ],
});

/**
 * Datos de la cita: servicio, profesional, fecha, hora, precio y lugar (con enlace al mapa). En una serie
 * (spec 011) van una sola vez, sin la fecha ni la hora (`schedule: false`: cada cita tiene la suya).
 */
function appointmentDetails(
  data: AppointmentEmailData,
  title = "Tu cita",
  options: { schedule?: boolean; priceLabel?: string } = {},
): EmailBlock {
  const place = { address: data.businessAddress, lat: data.businessLat, lng: data.businessLng };
  const rows: Extract<EmailBlock, { kind: "details" }>["rows"] = [
    { label: "Servicio", value: data.serviceName },
    { label: "Profesional", value: data.professionalName },
  ];
  if (options.schedule !== false) {
    rows.push(
      { label: "Fecha", value: capitalize(formatLongDate(data.date)) },
      { label: "Hora", value: `${formatTimeRange(data.startTime, data.endTime)}${zoneSuffix(data)}` },
    );
  }
  if (data.showPrice) rows.push({ label: options.priceLabel ?? "Precio", value: formatPrice(data.price, data.currency) });
  if (data.isVirtual) {
    rows.push({ label: "Lugar", value: "Virtual (videollamada)" });
    rows.push(
      data.meetingUrl
        ? { label: "Videollamada", value: "Unirse a la videollamada", href: data.meetingUrl }
        : { label: "Videollamada", value: "Te enviaremos el enlace antes de la cita" },
    );
  } else if (data.homeVisit) {
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

/** Banco, tipo, número, titular y cédula/RUC (si la tiene) de una cuenta. */
function bankAccountRows(account: BankAccount): Extract<EmailBlock, { kind: "details" }>["rows"] {
  const rows: Extract<EmailBlock, { kind: "details" }>["rows"] = [
    { label: "Banco", value: account.bank },
    { label: "Tipo de cuenta", value: BANK_ACCOUNT_TYPE_LABELS[account.accountType] },
    { label: "Número de cuenta", value: account.number, mono: true },
    { label: "Titular", value: account.holder },
  ];
  if (account.holderId) rows.push({ label: "Cédula / RUC", value: account.holderId, mono: true });
  return rows;
}

/**
 * Datos para transferir y el botón para enviar el comprobante. Con una cuenta, un recuadro con sus
 * datos y el monto; con varias, el monto en el texto y un recuadro por cuenta (vale cualquiera).
 */
function payment(data: AppointmentEmailData): EmailBlock[] {
  if (!data.payment || data.payment.bankAccounts.length === 0) return [];
  const { bankAccounts, url } = data.payment;
  const amount = formatPrice(data.price, data.currency);
  const accounts: EmailBlock[] =
    bankAccounts.length === 1
      ? [
          {
            kind: "details",
            title: "Pago por transferencia",
            rows: [...bankAccountRows(bankAccounts[0]), ...(data.showPrice ? [{ label: "Monto", value: amount }] : [])],
          },
        ]
      : [
          {
            kind: "text",
            text: `Pago por transferencia: transfiere${data.showPrice ? ` ${amount}` : ""} a cualquiera de estas ${bankAccounts.length} cuentas.`,
          },
          ...bankAccounts.map(
            (account, index): EmailBlock => ({ kind: "details", title: `Cuenta ${index + 1}`, rows: bankAccountRows(account) }),
          ),
        ];
  return [
    ...accounts,
    { kind: "button", label: "Enviar el comprobante", url },
    { kind: "note", text: "Cuando transfieras, sube ahí la foto o el PDF del comprobante (o envíalo por WhatsApp al negocio)." },
  ];
}

/** «noviembre»: el mes de un cobro de la mensualidad, por su día de pago. */
const billingMonth = (data: Pick<BillingEmailData, "dueDate">) => formatDate(data.dueDate, "MMMM");
/** «14 de noviembre» */
const billingDay = (data: Pick<BillingEmailData, "dueDate">) => formatDate(data.dueDate, "d 'de' MMMM");

/** El monto de un cobro: lo que se paga y, con descuento de referidos, la mensualidad y el descuento. */
function billingAmountBlock(data: BillingEmailData, title?: string): EmailBlock {
  const rows: Extract<EmailBlock, { kind: "details" }>["rows"] =
    data.referralDiscount > 0
      ? [
          { label: "Mensualidad", value: formatUsdAmount(data.baseAmount) },
          {
            label: data.referralCount === 1 ? "Descuento por 1 recomendación" : `Descuento por ${data.referralCount} recomendaciones`,
            value: `− ${formatUsdAmount(data.referralDiscount)}`,
          },
          { label: "Total a pagar", value: formatUsdAmount(data.amount) },
        ]
      : [{ label: "Monto", value: formatUsdAmount(data.amount) }];
  return { kind: "details", title, rows };
}

/** Las cuentas de Agenda360 para transferir la mensualidad (vale cualquiera); sin cuentas, a quién pedirlas. */
function billingAccounts(bankAccounts: BankAccount[], supportContact: string): EmailBlock[] {
  if (bankAccounts.length === 0) {
    return [{ kind: "text", text: `Escríbenos a ${supportContact} y te enviamos los datos para transferir.` }];
  }
  if (bankAccounts.length === 1) return [{ kind: "details", title: "Cuenta para transferir", rows: bankAccountRows(bankAccounts[0]) }];
  return bankAccounts.map((account, index): EmailBlock => ({ kind: "details", title: `Cuenta ${index + 1}`, rows: bankAccountRows(account) }));
}

/**
 * Las citas de una serie (spec 011), una fila por cita: «Cita 1 · Martes 20 de octubre, 10:00 – 11:00»
 * (con la zona en las virtuales y el año si la serie pasa a otro). Cada fila enlaza a «Tu cita» de quien
 * recibe el email, salvo en la copia al profesional.
 */
function seriesDatesBlock(data: SeriesEmailData, title: string): EmailBlock {
  const years = new Set(data.dates.map((item) => item.date.slice(0, 4)));
  const pattern = years.size > 1 ? "EEEE d 'de' MMMM 'de' yyyy" : "EEEE d 'de' MMMM";
  return {
    kind: "details",
    title,
    rows: data.dates.map((item, index) => ({
      label: `Cita ${index + 1}`,
      value: `${capitalize(formatDate(item.date, pattern))}, ${formatTimeRange(item.startTime, item.endTime)}${zoneSuffix(data, item.date)}`,
      href: data.professionalCopy ? undefined : (item.url ?? undefined),
      textWithHref: true,
    })),
  };
}

/** «el martes 20 de octubre»: desde cuándo es la serie. */
const seriesStart = (data: SeriesEmailData) => (data.dates[0] ? `el ${formatDate(data.dates[0].date, "EEEE d 'de' MMMM")}` : "");

/**
 * Pago por transferencia de una serie (spec 011): las cuentas una sola vez y el monto de cada cita. El
 * comprobante se sube desde el enlace de cada fecha (cada cita tiene su pago).
 */
function seriesPayment(data: SeriesEmailData): EmailBlock[] {
  if (!data.payment || data.payment.bankAccounts.length === 0) return [];
  const { bankAccounts } = data.payment;
  const amount = formatPrice(data.price, data.currency);
  const accounts: EmailBlock[] =
    bankAccounts.length === 1
      ? [
          {
            kind: "details",
            title: "Pago por transferencia",
            rows: [...bankAccountRows(bankAccounts[0]), ...(data.showPrice ? [{ label: "Monto de cada cita", value: amount }] : [])],
          },
        ]
      : [
          { kind: "text", text: `Pago por transferencia: a cualquiera de estas ${bankAccounts.length} cuentas.` },
          ...bankAccounts.map(
            (account, index): EmailBlock => ({ kind: "details", title: `Cuenta ${index + 1}`, rows: bankAccountRows(account) }),
          ),
        ];
  return [
    ...accounts,
    {
      kind: "note",
      text: `Transfiere ${data.showPrice ? amount : "el valor de la cita"} por cada cita y sube el comprobante desde el enlace de cada fecha (o envíalo por WhatsApp al negocio).`,
    },
  ];
}

const policy = (data: AppointmentEmailData): EmailBlock[] =>
  data.cancellationPolicy ? [{ kind: "note", text: `Política de cancelación: ${data.cancellationPolicy}` }] : [];

/**
 * Página de quien recibe el email (spec 010): el paciente no la ve en la copia al profesional (dos
 * barreras: la copia se arma sin `appointmentPage` y, además, aquí no se pone). «Ver o cancelar mi
 * cita» sólo si podrá cancelar desde ahí; si no, «Ver mi cita».
 */
const hasAppointmentPage = (data: AppointmentEmailData) => Boolean(data.appointmentPage && !data.professionalCopy);

const appointmentPageLink = (data: AppointmentEmailData): EmailBlock[] =>
  hasAppointmentPage(data)
    ? [{ kind: "link", label: data.appointmentPage!.canCancel ? "Ver o cancelar mi cita" : "Ver mi cita", url: data.appointmentPage!.url }]
    : [];

/** «Confirmo que voy» del recordatorio (abre «Tu cita» y la confirma), o el gracias si ya confirmó. */
const confirmAttendance = (data: AppointmentEmailData): EmailBlock[] => {
  if (!hasAppointmentPage(data)) return [];
  return data.appointmentPage!.confirmed
    ? [{ kind: "callout", text: "Ya nos confirmaste que vienes. ¡Gracias!" }]
    : [{ kind: "button", label: "Confirmo que voy", url: `${data.appointmentPage!.url}?confirmar=1` }];
};

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

  platformAdminAdded: (data: { firstName: string; addedBy: string; email: string; password: string; loginUrl: string }): EmailContent =>
    platformEmail({
      subject: `Ahora eres super admin de ${APP_NAME}`,
      preheader: "Ya puedes entrar al panel de plataforma para dar soporte.",
      title: "Bienvenido al equipo de soporte",
      greeting: `Hola ${data.firstName}:`,
      blocks: [
        {
          kind: "text",
          text: `${data.addedBy} te agregó como super admin de ${APP_NAME}: podrás ver los negocios, gestionarlos en modo soporte y ayudar a sus usuarios. Todo lo que hagas queda registrado con tu nombre.`,
        },
        credentials(data.email, data.password),
        { kind: "button", label: "Entrar al panel", url: data.loginUrl },
        {
          kind: "note",
          text: "Al entrar por primera vez tendrás que activar la verificación en dos pasos (con una app de autenticación en tu celular): es obligatoria para los super admins. Guarda este email: si necesitas otra contraseña, pídesela a quien te agregó.",
        },
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

  /**
   * Cambio de seguridad en una cuenta de super admin (spec 009): a la cuenta y al super admin
   * principal, para que nadie se quede con una cuenta sin que se note.
   */
  accountSecurityChanged: (data: {
    accountName: string;
    accountEmail: string;
    /** «Activó la verificación en dos pasos», «Cambió su contraseña»… */
    change: string;
    /** Fecha y hora ya escritas, en la hora de Ecuador. */
    at: string;
    ip: string;
    browser: string;
    reviewUrl: string;
  }): EmailContent =>
    platformEmail({
      subject: `${APP_NAME}: cambio de seguridad en la cuenta de ${data.accountName}`,
      preheader: `${data.change}.`,
      title: "Cambio de seguridad en una cuenta de super admin",
      blocks: [
        { kind: "text", text: `En la cuenta de ${data.accountName}: ${data.change.charAt(0).toLowerCase()}${data.change.slice(1)}.` },
        {
          kind: "details",
          rows: [
            { label: "Cuenta", value: data.accountEmail },
            { label: "Cambio", value: data.change },
            { label: "Cuándo", value: data.at },
            { label: "IP", value: data.ip, mono: true },
            { label: "Navegador", value: data.browser },
          ],
        },
        { kind: "callout", tone: "warning", text: "Si no fuiste tú, cambia la contraseña y avisa al super admin principal." },
        { kind: "button", label: "Revisar la actividad", url: data.reviewUrl },
      ],
    }),

  /**
   * El aviso de los costos de AWS (spec 031): lo gastado en el mes pasó el monto que puso el super admin en
   * /admin → Costos. Al super admin principal, una vez por mes y por monto (el ntfy dice lo mismo), con lo
   * gastado, el monto, la previsión y lo que cubren los créditos. Todos los montos, en USD.
   */
  awsCostAlert: (data: {
    /** El día 1 del mes de facturación de AWS. */
    month: ISODate;
    usage: number;
    alertAmount: number;
    /** null: el día 1, todavía sin previsión. */
    forecast: number | null;
    credits: number;
    net: number;
    costsUrl: string;
  }): EmailContent => {
    const month = formatDate(data.month, "MMMM 'de' yyyy");
    return platformEmail({
      subject: `${APP_NAME}: los costos de AWS pasaron tu aviso de ${formatUsdAmount(data.alertAmount)}`,
      preheader: `En ${month} llevas ${formatCostAmount(data.usage)} gastados en AWS.`,
      title: "Los costos de AWS pasaron tu aviso",
      blocks: [
        {
          kind: "text",
          text: `Lo gastado en AWS en ${month} (${formatCostAmount(data.usage)}) ya pasó el monto de tu aviso (${formatUsdAmount(data.alertAmount)}).`,
        },
        {
          kind: "details",
          rows: [
            { label: "Gastado este mes", value: formatCostAmount(data.usage) },
            { label: "Monto del aviso", value: formatUsdAmount(data.alertAmount) },
            { label: "Previsión para fin de mes", value: data.forecast === null ? "Todavía sin previsión" : formatCostAmount(data.forecast) },
            { label: "Lo cubren tus créditos", value: formatCostAmount(data.credits) },
            { label: "Pagas de verdad", value: formatCostAmount(data.net) },
          ],
        },
        { kind: "note", text: "Este mes no se repite con este monto. Lo puedes cambiar o quitar en Costos." },
        { kind: "button", label: "Ver costos", url: data.costsUrl },
      ],
    });
  },

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
        { kind: "button", label: "Abrir mi panel", url: settingsUrl },
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
        { kind: "button", label: "Abrir mi panel", url: settingsUrl },
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
      preheader: `${capitalize(formatLongDate(data.date))} a las ${startAt(data)} en ${data.businessName}.`,
      title: "Tu cita ha sido reservada",
      greeting: `Hola ${data.clientName}:`,
      blocks: [
        {
          kind: "text",
          text: data.bookedBy
            ? `${data.bookedBy} reservó para ti una cita en ${data.businessName}. Te avisaremos cuando quede confirmada.`
            : `Tu cita en ${data.businessName} ha sido reservada. Te avisaremos cuando quede confirmada.`,
        },
        appointmentDetails(data),
        ...appointmentPageLink(data),
        ...payment(data),
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
        ...(data.toVerify
          ? [
              {
                kind: "callout",
                tone: "warning",
                text:
                  "Por verificar: la cédula es de un paciente de tu negocio, pero el email y el teléfono no coinciden con su ficha. " +
                  "La reserva quedó aparte: revísala en la agenda y únela a su ficha si es la misma persona.",
              } satisfies EmailBlock,
            ]
          : []),
        { kind: "text", text: "Entra a tu agenda para confirmarla." },
      ],
    }),

  /** Al negocio: el paciente subió el comprobante de la transferencia desde su enlace de pago. */
  paymentReceiptReceived: (data: AppointmentEmailData & { agendaUrl: string }): EmailContent =>
    platformEmail({
      subject: `Comprobante de pago: ${data.clientName} · ${capitalize(formatLongDate(data.date))} ${data.startTime}`,
      preheader: `${data.clientName} envió el comprobante de ${data.serviceName}.`,
      title: "Recibiste un comprobante de pago",
      blocks: [
        { kind: "text", text: `${data.clientName} envió el comprobante de la transferencia de su cita.` },
        appointmentDetails({ ...data, showPrice: true }, "La cita"),
        { kind: "button", label: "Ver el comprobante", url: data.agendaUrl },
        { kind: "note", text: "Comprueba que el dinero llegó a tu cuenta y marca la cita como pagada." },
      ],
    }),

  /**
   * Al negocio (recepción): el paciente canceló su cita desde «Tu cita», el enlace de sus emails
   * (spec 010). Sale si su email es otro que el del profesional, que ya recibe la copia.
   */
  patientCancelled: (data: AppointmentEmailData & { agendaUrl: string }): EmailContent =>
    platformEmail({
      subject: `Cita cancelada por el paciente: ${data.clientName} · ${capitalize(formatLongDate(data.date))} ${data.startTime}`,
      preheader: `${data.clientName} canceló su cita de ${data.serviceName} desde su email.`,
      title: "Un paciente canceló su cita",
      blocks: [
        {
          kind: "text",
          text: `${data.clientName} canceló su cita desde el enlace de sus emails. La hora quedó libre en tu página de reservas.`,
        },
        // El negocio siempre ve el precio real, aunque no se muestre a los clientes.
        appointmentDetails({ ...data, showPrice: true }, "La cita"),
        { kind: "button", label: "Ver en la agenda", url: data.agendaUrl },
      ],
    }),

  /**
   * Al profesional: una cita nueva en su agenda (reservada online, agendada o pasada a él por otra
   * persona). Con `series`, una serie de citas del panel, en un solo email (spec 011).
   */
  professionalNewAppointment: (
    data: AppointmentEmailData & { origin: "booking_page" | "dashboard"; agendaUrl: string; series?: SeriesEmailDate[] },
  ): EmailContent => {
    if (data.series?.length) {
      const series: SeriesEmailData = { ...data, dates: data.series, professionalCopy: undefined };
      const count = data.series.length;
      return platformEmail({
        subject: `Nueva serie: ${data.clientName} · ${count} citas desde ${seriesStart(series)}`,
        preheader: `${data.clientName} · ${data.serviceName} · ${count} citas.`,
        title: "Tienes una nueva serie de citas",
        greeting: `Hola ${data.professionalName}:`,
        blocks: [
          { kind: "text", text: `En ${data.businessName} agendaron una serie de ${count} citas en tu agenda.` },
          // El profesional siempre ve el precio real, aunque no se muestre a los clientes.
          appointmentDetails({ ...data, showPrice: true }, "Las citas", { schedule: false, priceLabel: "Precio de cada cita" }),
          seriesDatesBlock({ ...series, dates: data.series.map((item) => ({ ...item, url: null })) }, "Fechas"),
          { kind: "button", label: "Ver mi agenda", url: data.agendaUrl },
        ],
      });
    }
    return platformEmail({
      subject: `Nueva cita: ${data.clientName} · ${capitalize(formatLongDate(data.date))} ${data.startTime}`,
      preheader: `${data.clientName} · ${data.serviceName}.`,
      title: "Tienes una nueva cita",
      greeting: `Hola ${data.professionalName}:`,
      blocks: [
        {
          kind: "text",
          text:
            data.origin === "booking_page"
              ? `${data.clientName} reservó una cita contigo desde la página de ${data.businessName}.`
              : `En ${data.businessName} agendaron una cita en tu agenda.`,
        },
        // El profesional siempre ve el precio real, aunque no se muestre a los clientes.
        appointmentDetails({ ...data, showPrice: true }, "La cita"),
        { kind: "button", label: "Ver mi agenda", url: data.agendaUrl },
      ],
    });
  },

  /** Al profesional, cada mañana: sus citas del día. */
  professionalDailyAgenda: (data: {
    professionalName: string;
    businessName: string;
    date: ISODate;
    appointments: { time: string; clientName: string; serviceName: string; homeVisit: HomeVisitAddress | null; isVirtual?: boolean }[];
    agendaUrl: string;
  }): EmailContent => {
    const count = data.appointments.length;
    return platformEmail({
      subject: `Tu agenda de hoy: ${count === 1 ? "1 cita" : `${count} citas`} · ${data.businessName}`,
      preheader: count ? `La primera, a las ${data.appointments[0].time.slice(0, 5)}.` : "Hoy no tienes citas.",
      title: "Tu agenda de hoy",
      greeting: `Hola ${data.professionalName}:`,
      blocks: [
        {
          kind: "text",
          text: `${capitalize(formatLongDate(data.date))} en ${data.businessName}: tienes ${count === 1 ? "una cita" : `${count} citas`}.`,
        },
        {
          kind: "details",
          rows: data.appointments.map((appointment) => ({
            label: appointment.time,
            value: [
              appointment.clientName,
              appointment.serviceName,
              appointment.homeVisit ? "a domicilio" : appointment.isVirtual ? "virtual" : "",
            ]
              .filter(Boolean)
              .join(" · "),
          })),
        },
        { kind: "button", label: "Abrir mi agenda", url: data.agendaUrl },
      ],
    });
  },

  /**
   * Al profesional: su cita como invitación de calendario (spec 027). La invitación va adjunta (la añade el
   * envío) y este email sólo la explica. Asunto: «Cita: Juan P. · Terapia individual · mar 20 oct, 15:00»,
   * «Cambió: …», «Cancelada: …» o «Pasó a otra agenda: …».
   */
  calendarInvite: (data: CalendarInviteEmailData): EmailContent => {
    const prefix = { new: "Cita", updated: "Cambió", cancelled: "Cancelada", moved: "Pasó a otra agenda" }[data.kind];
    const lead = {
      new: `Una cita de ${data.businessName} para tu calendario: Google, iPhone y Outlook la reconocen como invitación.`,
      updated: "La cita cambió: tu calendario actualiza el mismo evento, sin duplicarlo.",
      cancelled: "La cita se canceló: tu calendario la quita o la marca como cancelada.",
      moved: "La cita pasó a la agenda de otro profesional: tu calendario la quita de la tuya.",
    }[data.kind];
    return platformEmail({
      subject: `${prefix}: ${data.summary} · ${formatShortDate(data.date)}, ${data.startTime}`,
      preheader: `${data.summary} · ${capitalize(formatLongDate(data.date))}, ${formatTimeRange(data.startTime, data.endTime)}.`,
      title: {
        new: "Una cita para tu calendario",
        updated: "Tu cita cambió",
        cancelled: "Tu cita se canceló",
        moved: "Una cita pasó a otra agenda",
      }[data.kind],
      greeting: `Hola ${data.professionalName}:`,
      blocks: [
        { kind: "text", text: lead },
        {
          kind: "details",
          title: "La cita",
          rows: [
            { label: data.clientNames.length > 1 ? "Pacientes" : "Paciente", value: joinNames(data.clientNames) },
            { label: "Servicio", value: data.serviceName },
            { label: "Fecha", value: capitalize(formatLongDate(data.date)) },
            { label: "Hora", value: formatTimeRange(data.startTime, data.endTime) },
            { label: "Lugar", value: data.place },
          ],
        },
        { kind: "button", label: "Ver en Agenda360", url: data.agendaUrl },
        {
          kind: "note",
          text:
            "Te llega porque activaste «Recibir mis citas en mi calendario» en tu agenda. Si tu calendario no la añadió solo, " +
            "toca «Añadir al calendario» en este email; los cambios siguientes se aplican solos.",
        },
      ],
    });
  },

  appointmentConfirmed: (data: AppointmentEmailData): EmailContent =>
    clientEmail(data, {
      subject: "Tu cita ha sido confirmada",
      preheader: `Te esperamos el ${formatLongDate(data.date)} a las ${startAt(data)}.`,
      title: "Tu cita está confirmada",
      greeting: `Hola ${data.clientName}:`,
      blocks: [
        { kind: "text", text: `Tu cita en ${data.businessName} está confirmada.` },
        appointmentDetails(data),
        ...appointmentPageLink(data),
        ...payment(data),
        ...policy(data),
      ],
    }),

  appointmentUpdated: (data: AppointmentEmailData): EmailContent =>
    clientEmail(data, {
      subject: "Tu cita ha sido modificada",
      preheader: `Nuevo horario: ${formatLongDate(data.date)} a las ${startAt(data)}.`,
      title: "Tu cita ha sido modificada",
      greeting: `Hola ${data.clientName}:`,
      blocks: [
        { kind: "text", text: `Tu cita en ${data.businessName} ha sido modificada. Estos son los nuevos datos:` },
        appointmentDetails(data),
        ...appointmentPageLink(data),
      ],
    }),

  /** Una cita cancelada vuelve a quedar activa: el negocio la restableció. */
  appointmentRestored: (data: AppointmentEmailData): EmailContent =>
    clientEmail(data, {
      subject: "Tu cita ha sido restablecida",
      preheader: `Te esperamos el ${formatLongDate(data.date)} a las ${startAt(data)}.`,
      title: "Tu cita ha sido restablecida",
      greeting: `Hola ${data.clientName}:`,
      blocks: [
        { kind: "text", text: `Tu cita en ${data.businessName}, que había sido cancelada, vuelve a estar en pie. Estos son sus datos:` },
        appointmentDetails(data),
        ...appointmentPageLink(data),
        ...payment(data),
        ...policy(data),
      ],
    }),

  /** Una cita confirmada (o atendida, o no asistió) vuelve a quedar pendiente de confirmar (spec 008). */
  appointmentPending: (data: AppointmentEmailData): EmailContent =>
    clientEmail(data, {
      subject: "Tu cita queda pendiente de confirmar",
      preheader: `${capitalize(formatLongDate(data.date))} a las ${startAt(data)} en ${data.businessName}.`,
      title: "Tu cita queda pendiente de confirmar",
      greeting: `Hola ${data.clientName}:`,
      blocks: [
        {
          kind: "text",
          text: `Tu cita en ${data.businessName} vuelve a estar pendiente de confirmar. Sigue agendada: te escribiremos para confirmarla.`,
        },
        appointmentDetails(data),
        ...appointmentPageLink(data),
      ],
    }),

  /** La cita quedó como atendida: gracias por la visita, con el enlace para volver a reservar (spec 008). */
  appointmentCompleted: (data: AppointmentEmailData): EmailContent =>
    clientEmail(data, {
      subject: `Gracias por tu visita a ${data.businessName}`,
      preheader: "Cuando quieras volver, puedes reservar en línea.",
      title: "Gracias por tu visita",
      greeting: `Hola ${data.clientName}:`,
      blocks: [
        { kind: "text", text: `Gracias por tu visita del ${formatLongDate(data.date)} a ${data.businessName}. Fue un gusto atenderte.` },
        { kind: "text", text: "Cuando quieras volver, puedes reservar tu próxima cita aquí:" },
        { kind: "button", label: "Reservar de nuevo", url: data.bookingUrl },
      ],
    }),

  /** El paciente no asistió: invitación a elegir otra hora (spec 008). */
  appointmentNoShow: (data: AppointmentEmailData): EmailContent =>
    clientEmail(data, {
      subject: "Te esperábamos en tu cita",
      preheader: `Tu cita del ${formatLongDate(data.date)} en ${data.businessName}.`,
      title: "Te esperábamos en tu cita",
      greeting: `Hola ${data.clientName}:`,
      blocks: [
        {
          kind: "callout",
          tone: "warning",
          text: `Te esperábamos el ${formatLongDate(data.date)} a las ${startAt(data)} en ${data.businessName} y no pudimos verte.`,
        },
        { kind: "text", text: "Si quieres, puedes elegir otra hora:" },
        { kind: "button", label: "Elegir otra hora", url: data.bookingUrl },
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
          text: `Tu cita del ${formatLongDate(data.date)} a las ${startAt(data)} en ${data.businessName} ha sido cancelada.`,
        },
        { kind: "text", text: "Si quieres, puedes reservar una nueva cita:" },
        { kind: "button", label: "Reservar una nueva cita", url: data.bookingUrl },
      ],
    }),

  /**
   * Una serie de citas nueva (spec 011): un solo email con todas las fechas, en vez de uno por cita. Cada
   * fecha enlaza a su página «Tu cita» (spec 010), que lleva también a su pago. La copia al profesional,
   * sin esos enlaces.
   */
  appointmentSeries: (data: SeriesEmailData): EmailContent => {
    const count = data.dates.length;
    const what = `${count} citas de ${data.serviceName} con ${data.professionalName}`;
    const linked = !data.professionalCopy && data.dates.some((item) => item.url);
    return clientEmail(data, {
      subject: `Tus próximas ${count} citas en ${data.businessName}`,
      preheader: `${count} citas desde ${seriesStart(data)} en ${data.businessName}.`,
      title: data.pending ? "Tus citas quedaron agendadas" : "Tus citas están confirmadas",
      greeting: `Hola ${data.clientName}:`,
      blocks: [
        {
          kind: "text",
          text: data.pending
            ? `Tus ${what} quedaron agendadas y pendientes de confirmar. Te avisaremos cuando estén confirmadas.`
            : `Tus ${what} están confirmadas.`,
        },
        seriesDatesBlock(data, "Tus citas"),
        ...(linked
          ? [{ kind: "note", text: "Cada fecha lleva a su página: ahí ves esa cita y nos confirmas que vas." } satisfies EmailBlock]
          : []),
        appointmentDetails(data, "Datos de las citas", { schedule: false, priceLabel: "Precio de cada cita" }),
        ...seriesPayment(data),
        ...policy(data),
      ],
    });
  },

  /** «Cancelar ésta y las siguientes» de una serie (spec 011): un solo email con las fechas canceladas. */
  appointmentSeriesCancelled: (data: SeriesEmailData): EmailContent => {
    const count = data.dates.length;
    const one = count === 1;
    return clientEmail(data, {
      subject: one ? `Se canceló 1 cita en ${data.businessName}` : `Se cancelaron ${count} citas en ${data.businessName}`,
      preheader: `${one ? "Tu cita" : "Tus citas"} desde ${seriesStart(data)} en ${data.businessName}.`,
      title: one ? "Se canceló tu cita" : "Se cancelaron tus citas",
      greeting: `Hola ${data.clientName}:`,
      blocks: [
        {
          kind: "callout",
          tone: "warning",
          text: one
            ? `Se canceló tu cita de ${data.serviceName} en ${data.businessName}:`
            : `Se cancelaron tus citas de ${data.serviceName} en ${data.businessName}:`,
        },
        seriesDatesBlock({ ...data, dates: data.dates.map((item) => ({ ...item, url: null })) }, one ? "Cita cancelada" : "Citas canceladas"),
        { kind: "text", text: "Si quieres, puedes reservar una nueva cita:" },
        { kind: "button", label: "Reservar una nueva cita", url: data.bookingUrl },
      ],
    });
  },

  /**
   * La mensualidad vence en tres días (spec 029): el monto y las cuentas para transferir, y que desde el día
   * de pago, al entrar al panel, tendrá que subir el comprobante para seguir usándolo (no hay días de gracia).
   */
  billingReminder: (data: BillingEmailData & { bankAccounts: BankAccount[]; supportContact: string }): EmailContent =>
    platformEmail({
      subject: `Tu mensualidad de ${APP_NAME} vence el ${billingDay(data)}`,
      preheader: `${formatUsdAmount(data.amount)} por transferencia: las cuentas y cómo enviar el comprobante.`,
      title: `Tu mensualidad de ${billingMonth(data)} vence el ${billingDay(data)}`,
      greeting: `Hola ${data.firstName}:`,
      blocks: [
        {
          kind: "text",
          text: `El ${billingDay(data)} vence la mensualidad de ${data.businessName}. Transfiere a ${
            data.bankAccounts.length > 1 ? "cualquiera de estas cuentas" : "esta cuenta"
          } y guarda el comprobante: ese día, al entrar a tu panel, tendrás que subirlo para seguir usándolo.`,
        },
        billingAmountBlock(data),
        ...billingAccounts(data.bankAccounts, data.supportContact),
        { kind: "button", label: "Abrir mi panel", url: data.panelUrl },
        { kind: "note", text: "Tu equipo y tu página de reservas siguen funcionando igual." },
      ],
    }),

  /** El super admin confirmó el pago de la mensualidad (con el comprobante o por otra vía). */
  billingPaid: (data: BillingEmailData & { method: BillingPaidMethod }): EmailContent =>
    platformEmail({
      subject: "Recibimos tu pago, gracias",
      preheader: `Confirmamos el pago de tu mensualidad de ${billingMonth(data)}.`,
      title: "Recibimos tu pago, gracias",
      greeting: `Hola ${data.firstName}:`,
      blocks: [
        {
          kind: "text",
          text: `Confirmamos el pago de la mensualidad de ${billingMonth(data)} de ${data.businessName}${
            data.method === "transfer" ? ": revisamos tu comprobante y la transferencia llegó bien." : "."
          }`,
        },
        billingAmountBlock(data, "Tu pago"),
        { kind: "button", label: "Abrir mi panel", url: data.panelUrl },
      ],
    }),

  /**
   * El super admin rechazó el comprobante, con el motivo: al entrar al panel se vuelve a abrir la pantalla
   * de pago, y no se cierra hasta subir otro.
   */
  billingRejected: (data: BillingEmailData & { reason: string; supportContact: string }): EmailContent =>
    platformEmail({
      subject: `No pudimos confirmar el pago de tu mensualidad de ${billingMonth(data)}`,
      preheader: `Motivo: ${data.reason}`,
      title: `No pudimos confirmar el pago de tu mensualidad de ${billingMonth(data)}`,
      greeting: `Hola ${data.firstName}:`,
      blocks: [
        { kind: "text", text: `Revisamos el comprobante de la mensualidad de ${data.businessName} y no pudimos confirmar el pago.` },
        { kind: "callout", tone: "warning", text: `Motivo: ${data.reason}` },
        {
          kind: "text",
          text: "Revisa la transferencia: al entrar a tu panel, tendrás que volver a subir el comprobante para seguir usándolo. Tu equipo y tu página de reservas siguen funcionando.",
        },
        billingAmountBlock(data),
        { kind: "button", label: "Subir el comprobante", url: data.panelUrl },
        { kind: "note", text: `Si tienes dudas, escríbenos a ${data.supportContact}.` },
      ],
    }),

  /** El super admin anuló el cobro de un mes, con el motivo: ya no hay que pagarlo. */
  billingVoided: (data: BillingEmailData & { reason: string }): EmailContent =>
    platformEmail({
      subject: `Anulamos el cobro de tu mensualidad de ${billingMonth(data)}`,
      preheader: "Ya no tienes que pagarlo.",
      title: `Anulamos el cobro de tu mensualidad de ${billingMonth(data)}`,
      greeting: `Hola ${data.firstName}:`,
      blocks: [
        {
          kind: "text",
          text: `Anulamos el cobro de la mensualidad de ${billingMonth(data)} de ${data.businessName} (${formatUsdAmount(data.amount)}): ya no tienes que pagarlo.`,
        },
        { kind: "callout", tone: "info", text: `Motivo: ${data.reason}` },
        { kind: "button", label: "Abrir mi panel", url: data.panelUrl },
      ],
    }),

  appointmentReminder: (data: AppointmentEmailData, when: "hoy" | "mañana" | null): EmailContent =>
    clientEmail(data, {
      subject: when ? `Recuerda que tienes una cita ${when}` : "Recordatorio de tu cita",
      preheader: `${capitalize(formatLongDate(data.date))} a las ${startAt(data)} en ${data.businessName}.`,
      title: when ? `Tu cita es ${when}` : "Recordatorio de tu cita",
      greeting: `Hola ${data.clientName}:`,
      blocks: [
        { kind: "text", text: "Te recordamos tu próxima cita:" },
        appointmentDetails(data),
        ...confirmAttendance(data),
        ...appointmentPageLink(data),
        ...policy(data),
      ],
    }),
};
