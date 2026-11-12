import { businessColumns } from "../db/columns.ts";
import { many, one, type Db } from "../db/pool.ts";
import { getAvailableSlots, offersService, scopeToProfessional } from "../shared/lib/availability.ts";
import { dayPartOf, WAITLIST_MAX_OFFERS_PER_DAY, WAITLIST_TIMES_PER_OFFER } from "../shared/lib/constants/business.ts";
import { emailTemplates } from "../shared/lib/email/templates.ts";
import { addMinutesToTime, getDayOfWeek, getZonedNow } from "../shared/lib/time.ts";
import type { Business, DayOfWeek, ISODate, WaitlistDayPart } from "../shared/types/index.ts";
import { listSchedules } from "./business-data-service.ts";
import { queueEmail, waitlistBookUrl, waitlistUrl } from "./notifications.ts";
import { addAppointmentNotice } from "./panel-notices.ts";
import { listProfessionals } from "./professional-service.ts";
import { blockedTimesFrom, busySlots } from "./public-booking-service.ts";
import { waitlistEnabled } from "./waitlist-service.ts";

/**
 * El aviso de la lista de espera (spec 047), negocio por negocio desde el cron (`queueWaitlistOffers`):
 * 1. cierra las esperas vencidas y las de un servicio o un profesional desactivados;
 * 2. por cada hora liberada (la anota el disparador de la migración 056), busca quién la espera: su servicio, su
 *    profesional o «Cualquiera» (si ese profesional ofrece el servicio), el día de la semana, la parte del día y
 *    la fecha hasta la que espera;
 * 3. con quien tiene email, calcula las horas que se pueden reservar dentro del hueco igual que la página de
 *    reservas (horario, bloqueos, otras citas, anticipación mínima y días hacia adelante) y le envía «Se liberó
 *    una hora» con las que le sirven (como mucho WAITLIST_TIMES_PER_OFFER), sin copia al profesional y como mucho
 *    WAITLIST_MAX_OFFERS_PER_DAY emails al día. Se avisa a todos a la vez: la toma el primero que reserva;
 * 4. si alguien espera esa hora, aunque no tenga email o ya no se pueda reservar online, la campana avisa al
 *    equipo con la cifra (nunca nombres).
 * `at`: el momento (las pruebas lo mueven). Devuelve cuántos emails quedaron en cola.
 */
export async function runWaitlistJob(db: Db, businessId: string, at: Date = new Date()): Promise<number> {
  const business = await one<Business>(db, `select ${businessColumns()} from businesses where id = $1 and status = 'active'`, [businessId]);
  if (!business || !waitlistEnabled(business)) return 0;
  const now = getZonedNow(business.timezone, at);

  await db.query(
    `update waitlist_entries set closed_at = now(), closed_reason = 'expired', updated_at = now()
      where business_id = $1 and closed_at is null and until < $2`,
    [businessId, now.date],
  );
  await db.query(
    `update waitlist_entries w set closed_at = now(), closed_reason = 'inactive', updated_at = now()
      where w.business_id = $1 and w.closed_at is null
        and (not exists (select 1 from services s where s.id = w.service_id and s.is_active)
             or (w.professional_id is not null
                 and not exists (select 1 from professionals p where p.id = w.professional_id and p.is_active)))`,
    [businessId],
  );

  const slots = await many<{ id: string; professionalId: string; date: ISODate; startTime: string; endTime: string }>(
    db,
    `select id, professional_id as "professionalId", to_char(date, 'YYYY-MM-DD') as date, start_time as "startTime", end_time as "endTime"
       from waitlist_freed_slots
      where business_id = $1 and processed_at is null
      order by date, start_time
      for update skip locked`,
    [businessId],
  );
  if (slots.length === 0) return 0;

  const entries = await many<{
    id: string;
    token: string;
    serviceId: string;
    serviceName: string;
    durationMinutes: number;
    professionalId: string | null;
    name: string;
    email: string | null;
    days: DayOfWeek[];
    dayParts: WaitlistDayPart[];
    until: ISODate;
    offersOn: ISODate | null;
    offersToday: number;
  }>(
    db,
    `select w.id, w.token, w.service_id as "serviceId", s.name as "serviceName", s.duration_minutes as "durationMinutes",
            w.professional_id as "professionalId", w.name, w.email, w.days, w.day_parts as "dayParts",
            to_char(w.until, 'YYYY-MM-DD') as until, to_char(w.offers_on, 'YYYY-MM-DD') as "offersOn", w.offers_today as "offersToday"
       from waitlist_entries w join services s on s.id = w.service_id
      where w.business_id = $1 and w.closed_at is null
      order by w.created_at, w.id
      for update of w`,
    [businessId],
  );

  const future = slots.filter((slot) => slot.date >= now.date);
  const offers = new Map<string, { date: ISODate; time: string; professionalId: string }[]>();
  if (entries.length > 0 && future.length > 0) {
    const professionals = await listProfessionals(db, businessId, { activeOnly: true });
    const from = future[0].date;
    const to = future[future.length - 1].date;
    const context = {
      schedules: await listSchedules(db, businessId),
      busySlots: await busySlots(db, businessId, from, to),
      blockedTimes: await blockedTimesFrom(db, businessId, from, to),
      settings: business.bookingSettings,
      now,
    };
    for (const slot of future) {
      const professional = professionals.find((option) => option.id === slot.professionalId);
      if (!professional) continue;
      const day = getDayOfWeek(slot.date);
      // Las partes del día que toca el hueco (de su inicio a su último minuto).
      const parts = new Set([dayPartOf(slot.startTime), dayPartOf(addMinutesToTime(slot.endTime, -1))]);
      const agenda = scopeToProfessional(context, professional.id);
      let waiting = 0;
      for (const entry of entries) {
        if (entry.professionalId && entry.professionalId !== professional.id) continue;
        if (!offersService(professional, entry.serviceId)) continue;
        if (!entry.days.includes(day) || slot.date > entry.until) continue;
        if (!entry.dayParts.some((part) => parts.has(part))) continue;
        waiting++;
        if (!entry.email) continue;
        const times = getAvailableSlots(slot.date, entry.durationMinutes, agenda).filter(
          (time) => time >= slot.startTime && time < slot.endTime && entry.dayParts.includes(dayPartOf(time)),
        );
        if (times.length === 0) continue;
        const list = offers.get(entry.id) ?? [];
        list.push({ date: slot.date, time: times[0], professionalId: professional.id });
        offers.set(entry.id, list);
      }
      if (waiting > 0) {
        await addAppointmentNotice(db, {
          kind: "waitlist_slot",
          businessId,
          appointmentId: null,
          professionalId: professional.id,
          data: { date: slot.date, time: slot.startTime, count: waiting, professionalName: professional.displayName },
          dedupeKey: `waitlist-slot:${slot.id}`,
        });
      }
    }
  }
  await db.query("update waitlist_freed_slots set processed_at = now() where id = any($1::uuid[])", [slots.map((slot) => slot.id)]);

  let queued = 0;
  const professionalNames = new Map((await listProfessionals(db, businessId)).map((professional) => [professional.id, professional.displayName]));
  for (const entry of entries) {
    const found = offers.get(entry.id);
    if (!found || !entry.email) continue;
    const sentToday = entry.offersOn === now.date ? entry.offersToday : 0;
    if (sentToday >= WAITLIST_MAX_OFFERS_PER_DAY) continue;
    const seen = new Set<string>();
    const unique = found
      .filter((offer) => {
        const key = `${offer.date} ${offer.time} ${offer.professionalId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
      .slice(0, WAITLIST_TIMES_PER_OFFER);
    const sent = await queueEmail(db, {
      businessId,
      type: "waitlist_offer",
      to: entry.email,
      dedupeKey: `waitlist-offer:${entry.id}:${now.date}:${sentToday + 1}`,
      ...emailTemplates.waitlistOffer({
        name: entry.name.trim().split(/\s+/)[0] ?? entry.name,
        businessName: business.name,
        businessAddress: business.address,
        businessPhone: business.phone,
        serviceName: entry.serviceName,
        leaveUrl: waitlistUrl(entry.token),
        slots: unique.map((offer) => ({
          date: offer.date,
          time: offer.time,
          professionalName: professionalNames.get(offer.professionalId) ?? "",
          bookUrl: waitlistBookUrl(business.slug, {
            serviceId: entry.serviceId,
            professionalId: offer.professionalId,
            date: offer.date,
            time: offer.time,
            token: entry.token,
          }),
        })),
      }),
    });
    if (!sent) continue;
    await db.query("update waitlist_entries set offers_on = $2, offers_today = $3 where id = $1", [entry.id, now.date, sentToday + 1]);
    queued++;
  }
  return queued;
}
