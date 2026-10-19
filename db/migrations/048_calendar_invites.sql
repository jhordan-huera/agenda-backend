-- Las citas, como invitaciones de calendario (spec 027): cada cita de los próximos 14 días le llega al
-- profesional por email como una invitación (la de una reunión), y Google, Apple u Outlook la añaden, la
-- mueven si cambia y la quitan si se cancela, siempre el mismo evento (mismo UID y un número de versión mayor).
--
-- - professionals.calendar_invites: el interruptor de cada agenda, apagado al principio. Lo cambian el
--   profesional en la suya y el propietario o un administrador en cualquiera (queda en la actividad).
-- - calendar_invites: lo último que se le envió a cada agenda por cada cita (a qué email, su número de
--   versión, la huella de lo que se ve en el calendario y si fue la cancelación). Si la huella no cambia,
--   no se envía nada. Se borra sola con la cita o con la agenda.
-- - notifications.calendar: el iCalendar de la invitación (text/calendar) que sale junto al email. Como
--   el resto del contenido, el cron lo borra a los 30 días.
alter table professionals add column calendar_invites boolean not null default false;

create table calendar_invites (
  appointment_id  uuid not null references appointments (id) on delete cascade,
  professional_id uuid not null references professionals (id) on delete cascade,
  -- El email al que salió la última (el de avisos de la agenda o el de su usuario).
  email           text not null,
  -- SEQUENCE del evento: 0 la primera vez y uno más en cada cambio o cancelación.
  sequence        integer not null default 0 check (sequence >= 0),
  -- sha256 de lo que se ve en el calendario (horas, título, lugar y estado): sin datos legibles.
  fingerprint     text not null,
  -- Lo último que salió fue la cancelación (METHOD:CANCEL).
  cancelled       boolean not null default false,
  updated_at      timestamptz not null default now(),
  primary key (appointment_id, professional_id)
);
-- Al borrar una agenda (la cascada) y al buscar lo enviado a una agenda.
create index calendar_invites_professional_idx on calendar_invites (professional_id);

-- Como el resto de tablas: sin acceso desde la API pública de Supabase (sólo la API de Agenda360).
alter table calendar_invites enable row level security;

alter table notifications add column calendar text;
