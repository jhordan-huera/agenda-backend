// Copia de agenda-front/src/lib/constants/push.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import type { PushKind } from "../../types/index.ts";

/**
 * Avisos en el celular (spec 013): qué tipos tiene cada quien, cómo se llaman en la tarjeta de
 * Configuración y los tiempos de los que salen del cron. Lo usan el front y la API (copia en
 * agenda-backend/src/shared).
 */

/** Los del propietario del negocio, en el orden de la tarjeta. */
export const OWNER_PUSH_KINDS = [
  "booking",
  "receipt",
  "patient_confirm",
  "patient_cancel",
  "new_appointment",
  "unclosed",
  "evening_summary",
  "morning_summary",
] as const satisfies readonly PushKind[];

/**
 * Los del rol Profesional con una agenda activa (spec 017): el resumen de las 8 de la noche y, desde la
 * spec 021, el de la mañana, con las citas de su agenda. Ya están en los del propietario (que recibe el
 * del negocio entero).
 */
export const AGENDA_PUSH_KINDS = ["evening_summary", "morning_summary"] as const satisfies readonly PushKind[];

/** Los del super admin, en el orden de la tarjeta. */
export const PLATFORM_PUSH_KINDS = [
  "new_business",
  "plan_request",
  "account_security",
  "login_attack",
  "reminders_sent",
] as const satisfies readonly PushKind[];

/** Los que se pueden apagar: todos menos el aviso de prueba. */
export const MUTABLE_PUSH_KINDS = [...OWNER_PUSH_KINDS, ...PLATFORM_PUSH_KINDS] as const;

export type MutablePushKind = (typeof MUTABLE_PUSH_KINDS)[number];

/** Nombre y explicación de cada tipo, para los interruptores de la tarjeta. */
export const PUSH_KIND_LABELS: Record<MutablePushKind, { label: string; description: string }> = {
  booking: { label: "Reservas online", description: "Cada reserva desde tu página, también las «Por verificar»." },
  receipt: { label: "Comprobantes de pago", description: "Cuando un paciente sube el comprobante de su transferencia." },
  patient_confirm: { label: "Confirmaciones del paciente", description: "Cuando un paciente pulsa «Confirmo que voy» en su email." },
  patient_cancel: { label: "Cancelaciones del paciente", description: "Cuando un paciente cancela su cita desde su email." },
  new_appointment: {
    label: "Citas nuevas en tu agenda",
    description: "Las que te agenda otra persona del equipo (Recepción o un administrador).",
  },
  unclosed: {
    label: "Citas por cerrar",
    description: "30 minutos después de cada cita que sigue Pendiente o Confirmada, para marcarla Completada o No asistió.",
  },
  evening_summary: { label: "Resumen de las 8 de la noche", description: "Cuántas citas de hoy quedan sin cerrar, si hay alguna." },
  morning_summary: {
    label: "Resumen al empezar el día",
    description: "A la hora en que abre el negocio, cuántas citas de días anteriores siguen sin cerrar, si hay alguna.",
  },
  new_business: { label: "Negocios nuevos", description: "Cuando alguien termina su registro." },
  plan_request: { label: "Solicitudes de cambio de plan", description: "Cuando un negocio pide otro plan." },
  account_security: {
    label: "Cambios de seguridad",
    description: "Contraseña o verificación en dos pasos de una cuenta de super admin.",
  },
  login_attack: { label: "Intentos fallidos de inicio de sesión", description: "Posibles intentos de adivinar contraseñas." },
  reminders_sent: {
    label: "Recordatorios de citas por cerrar enviados",
    description: "A qué negocios salieron el resumen de la mañana y el de las 8 de la noche, con cuántas citas.",
  },
};

/** En la tarjeta del rol Profesional (spec 017), los resúmenes son sólo de su agenda: la explicación lo dice. */
export const AGENDA_PUSH_KIND_DESCRIPTIONS: Partial<Record<MutablePushKind, string>> = {
  evening_summary: "Cuántas citas de hoy de tu agenda quedan sin cerrar, si hay alguna.",
  morning_summary: "A la hora en que empiezas a atender, cuántas citas de días anteriores de tu agenda siguen sin cerrar, si hay alguna.",
};

/** Minutos después del fin de una cita en que se avisa si sigue sin cerrar. */
export const UNCLOSED_AFTER_MINUTES = 30;
/** Hora (en la del negocio) del resumen de las citas de hoy sin cerrar. */
export const EVENING_SUMMARY_HOUR = 20;
/**
 * El aviso de la mañana (spec 021) sale a la hora en que empieza el horario de ese día o, si el cron no
 * corrió a esa hora, en la primera pasada de las horas siguientes; pasadas éstas, ese día no sale.
 */
export const MORNING_SUMMARY_GRACE_HOURS = 2;
/** Negocios que nombra el aviso al super admin de los recordatorios enviados (spec 021); del resto, la cifra. */
export const REMINDERS_SENT_MAX_BUSINESSES = 10;
/** Días que no se vuelve a ofrecer activar los avisos en un aparato tras «Ahora no». */
export const PUSH_SNOOZE_DAYS = 7;
/** Aparatos por persona: al activar uno más, se quita el más antiguo. */
export const MAX_PUSH_DEVICES = 10;
