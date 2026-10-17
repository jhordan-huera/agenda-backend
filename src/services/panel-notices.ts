import { isUuid, many, one, pool, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { DEFAULT_TIMEZONE } from "../shared/lib/constants/app.ts";
import {
  BUSINESS_NOTICE_KINDS,
  NOTICE_AUDIENCE,
  NOTICE_DAYS,
  PLATFORM_NOTICE_KINDS,
  type BusinessNoticeKind,
  type NoticeAudience,
  type PlatformNoticeKind,
} from "../shared/lib/constants/notices.ts";
import { describeNotice, type NoticeAppointment, type NoticeText } from "../shared/lib/notices.ts";
import { noticeListQuerySchema } from "../shared/lib/validations/notices.ts";
import type { ISODate, NoticeKind, PanelNotice, PanelNoticePage, TimeString } from "../shared/types/index.ts";
import { authorize, authorizeSuperAdmin, parseInput, type RequestContext } from "./context.ts";

/**
 * Centro de avisos del panel (spec 014): la campana del panel del negocio y la de /admin.
 *
 * - **Un aviso por suceso** (`panel_notices`, migración 041), no uno por persona. Quién lo ve se decide
 *   AL LEER (R2), con lo que la persona es hoy: su rol, si es el propietario, su agenda y la agenda de
 *   hoy de la cita. Es la tabla NOTICE_AUDIENCE (src/shared/lib/constants/notices.ts) pasada a SQL
 *   (AUDIENCE_SQL), más tres reglas: quien lo provocó no lo ve, sólo desde que entró al equipo y sólo
 *   los últimos 30 días. Así quien cambia de rol o deja el equipo ve lo de hoy, sin tocar nada.
 * - **El texto se arma al leer** (R3) con describeNotice, los mismos constructores del celular, con el
 *   nombre completo del paciente (decisión 4 del dueño). Los del super admin guardan su texto.
 * - **Leer y «Marcar todo como leído» no van a la actividad** (decisión 5): son consultas de la propia
 *   persona. Crear los avisos tampoco: lo que los provoca ya queda registrado.
 * - **Nunca rompen lo que los provoca** (RF-011): cada aviso se guarda en su propio punto de guardado
 *   (`aviso_panel`); si falla (p. ej. sin la migración 041), se anota en el registro sin datos y la
 *   reserva, la cita, los emails y el aviso al celular siguen igual.
 */

const SUPPORT_FORBIDDEN = "La campana es del equipo del negocio.";
const NOT_FOUND = "Aviso no encontrado.";

/* ---------------------------------------------------------------- Crear -- */

/** Qué falló, sin datos: el código de PostgreSQL y el mensaje (sin emails). */
function describeError(error: unknown): string {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  const text = typeof message === "string" ? message.replace(/[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+/g, "[email]").slice(0, 200) : "error";
  return typeof code === "string" ? `${code} ${text}` : text;
}

/**
 * Ejecuta `work` (guardar un aviso) sin que un fallo afecte a quien lo provoca: dentro de una transacción
 * trabaja en el punto de guardado `aviso_panel`; si falla, vuelve a él, lo anota en el registro (el tipo
 * y el código) y la transacción sigue. `inTransaction: false` para el cron, que trabaja contra el pool.
 * Devuelve cuántos avisos se guardaron (0 también si falló o ya existía).
 */
export async function guardedPanelNotice(
  db: Db,
  label: string,
  work: () => Promise<number>,
  options: { inTransaction?: boolean } = {},
): Promise<number> {
  const inTransaction = options.inTransaction ?? true;
  let savepoint = false;
  try {
    if (inTransaction) {
      await db.query("savepoint aviso_panel");
      savepoint = true;
    }
    const saved = await work();
    if (savepoint) await db.query("release savepoint aviso_panel");
    return saved;
  } catch (error) {
    if (savepoint) await db.query("rollback to savepoint aviso_panel").catch(() => undefined);
    console.error(`[avisos] No se pudo guardar el aviso del panel (${label}): ${describeError(error)}`);
    return 0;
  }
}

/** Un aviso del negocio. */
export interface BusinessNoticeInput {
  kind: BusinessNoticeKind;
  businessId: string;
  /** La cita del aviso (la primera, en una serie); null sólo en los resúmenes (el de las 8 y el de la mañana). */
  appointmentId: string | null;
  /** Quien pulsó «Confirmo que voy». */
  clientId?: string | null;
  /** El resumen (de las 8 o de la mañana) de una agenda; null en el del negocio entero. */
  professionalId?: string | null;
  /** Quien lo provocó, que no lo ve. */
  actorUserId?: string | null;
  data?: Record<string, unknown>;
  /** Los del cron y la serie: no se repiten si se reintenta la pasada. */
  dedupeKey?: string | null;
}

/**
 * Guarda un aviso del negocio (en su punto de guardado, ver guardedPanelNotice). Un negocio suspendido no
 * genera avisos. «Cita nueva en tu agenda» sólo se guarda si la agenda de la cita tiene usuario, no la
 * agendó esa persona y la cita está Pendiente o Confirmada (R4): a cualquier agenda, no sólo a la del
 * propietario como en el celular.
 */
export function addAppointmentNotice(db: Db, notice: BusinessNoticeInput, options: { inTransaction?: boolean } = {}): Promise<number> {
  return guardedPanelNotice(
    db,
    notice.kind,
    async () => {
      const rows = await many(
        db,
        `insert into panel_notices (business_id, kind, appointment_id, client_id, professional_id, actor_user_id, data, dedupe_key)
         select b.id, $2::text, a.id, $4::uuid, $5::uuid, $6::uuid, $7::jsonb, $8::text
           from businesses b
           left join appointments a on a.id = $3::uuid and a.business_id = b.id
           left join professionals p on p.id = a.professional_id
          where b.id = $1::uuid and b.status = 'active'
            and ($3::uuid is null or a.id is not null)
            and ($2::text <> 'new_appointment'
                 or (p.user_id is not null and p.user_id is distinct from $6::uuid and a.status in ('pending', 'confirmed')))
         on conflict (dedupe_key) do nothing
         returning id`,
        [
          notice.businessId,
          notice.kind,
          notice.appointmentId,
          notice.clientId ?? null,
          notice.professionalId ?? null,
          notice.actorUserId ?? null,
          JSON.stringify(notice.data ?? {}),
          notice.dedupeKey ?? null,
        ],
      );
      return rows.length;
    },
    options,
  );
}

/** Un aviso del super admin: su texto ya armado (o cómo armarlo, dentro del punto de guardado). */
export interface PlatformNoticeInput {
  kind: PlatformNoticeKind;
  text: NoticeText | (() => Promise<NoticeText>);
  dedupeKey?: string | null;
}

/** Guarda un aviso de la plataforma (lo ve cada super admin en /admin), en su punto de guardado. */
export function addPlatformNotice(db: Db, notice: PlatformNoticeInput, options: { inTransaction?: boolean } = {}): Promise<number> {
  return guardedPanelNotice(
    db,
    notice.kind,
    async () => {
      const text = typeof notice.text === "function" ? await notice.text() : notice.text;
      const rows = await many(
        db,
        `insert into panel_notices (kind, title, body, url, dedupe_key) values ($1, $2, $3, $4, $5)
         on conflict (dedupe_key) do nothing
         returning id`,
        [notice.kind, text.title, text.body, text.url, notice.dedupeKey ?? null],
      );
      return rows.length;
    },
    options,
  );
}

/* ------------------------------------------------------- Quién lo ve (R2) -- */

const quoted = (kinds: readonly string[]) => kinds.map((kind) => `'${kind}'`).join(", ");
/** `n.kind in (…)` con los tipos del negocio cuya regla cumple `test` (o `false` si ninguno). */
const kindsWhere = (test: (audience: NoticeAudience) => boolean) => {
  const kinds = BUSINESS_NOTICE_KINDS.filter((kind) => test(NOTICE_AUDIENCE[kind]));
  return kinds.length ? `n.kind in (${quoted(kinds)})` : "false";
};

/**
 * NOTICE_AUDIENCE en SQL (lo mismo que noticeVisibleTo en src/shared/lib/notices.ts): `me` es quien lee
 * y `a`, la cita del aviso tal como está hoy (si se movió a otra agenda, cuenta la nueva).
 */
export const AUDIENCE_SQL = `(
  (me.is_owner and ${kindsWhere((audience) => audience.owner === "all")})
  or (me.is_owner and ${kindsWhere((audience) => audience.owner === "business")} and n.professional_id is null)
  or (not me.is_owner and me.role in ('admin', 'staff') and ${kindsWhere((audience) => audience.team === "all")})
  or (me.agenda is not null and coalesce(a.professional_id, n.professional_id) = me.agenda
      and ((not me.is_owner and ${kindsWhere((audience) => audience.agenda)})
           or (me.is_owner and ${kindsWhere((audience) => audience.agenda && audience.owner === null)}))))`;

/** Quién lee: una persona del equipo de un negocio, o un super admin (businessId null) en /admin. */
export interface NoticeReader {
  userId: string;
  businessId: string | null;
}

/** Leído: antes de su «Marcar todo como leído» o con su fila en panel_notice_reads. */
const READ_SQL = `(n.created_at <= coalesce(me.read_all_at, '-infinity'::timestamptz)
          or exists (select 1 from panel_notice_reads r where r.user_id = $1 and r.notice_id = n.id))`;

/**
 * El principio de cada consulta: `me` (quien lee, hoy) y `visible` (sus avisos, con `read`). Parámetros:
 * $1 la persona y $2 el negocio (null: /admin). Los demás, desde $3.
 */
function visibleCte(reader: NoticeReader): string {
  if (reader.businessId === null) {
    return `with me as (
        select u.created_at as since, null::text as timezone, 0 as agendas,
               (select s.read_all_at from panel_notice_state s where s.user_id = u.id) as read_all_at
          from users u
         where u.id = $1 and u.platform_role = 'super_admin' and u.is_active and $2::uuid is null),
      visible as (
        select n.*, ${READ_SQL} as read
          from panel_notices n cross join me
         where n.business_id is null
           and n.created_at > now() - make_interval(days => ${NOTICE_DAYS})
           and n.created_at >= me.since)`;
  }
  return `with me as (
      select bu.role, bu.created_at as since, b.owner_id is not distinct from bu.user_id as is_owner, b.timezone,
             (select p.id from professionals p
               where p.business_id = bu.business_id and p.user_id = bu.user_id and p.is_active
               order by p.created_at limit 1) as agenda,
             (select count(*)::int from professionals p where p.business_id = bu.business_id and p.is_active) as agendas,
             (select s.read_all_at from panel_notice_state s where s.user_id = bu.user_id) as read_all_at
        from business_users bu join businesses b on b.id = bu.business_id
       where bu.business_id = $2 and bu.user_id = $1),
    visible as (
      select n.*, ${READ_SQL} as read
        from panel_notices n
        cross join me
        left join appointments a on a.id = n.appointment_id
       where n.business_id = $2
         and n.created_at > now() - make_interval(days => ${NOTICE_DAYS})
         and n.created_at >= me.since
         and n.actor_user_id is distinct from $1
         and ${AUDIENCE_SQL})`;
}

const readerParams = (reader: NoticeReader) => [reader.userId, reader.businessId];

/* ---------------------------------------------------------- Leer y marcar -- */

/** Cuántos avisos sin leer tiene esta persona: una consulta con índices, sin armar textos (R6). */
export async function countUnread(db: Db, reader: NoticeReader): Promise<number> {
  const row = await one<{ unread: number }>(db, `${visibleCte(reader)} select count(*)::int as unread from visible where not read`, readerParams(reader));
  return row?.unread ?? 0;
}

/** El principal primero y después los demás de la sesión, en su orden (`alias`: la cita). */
export const noticePatientsSql = (alias: string) => `coalesce((
  select json_agg(json_build_object('name', x.name, 'toVerify', x.to_verify) order by x.position, x.added_at)
    from (select c.name, c.claimed_client_id is not null as to_verify, 0 as position, null::timestamptz as added_at
            from clients c where c.id = ${alias}.client_id
          union all
          select c.name, c.claimed_client_id is not null, 1, ac.created_at
            from appointment_clients ac join clients c on c.id = ac.client_id
           where ac.appointment_id = ${alias}.id) x), '[]'::json)`;

interface NoticeRow {
  id: string;
  kind: NoticeKind;
  createdAt: string;
  cursorAt: string;
  read: boolean;
  data: Record<string, unknown>;
  title: string | null;
  body: string | null;
  url: string | null;
  timezone: string | null;
  agendas: number;
  /** La agenda del resumen; null en el del negocio entero (y en los que hablan de una cita). */
  noticeAgendaId: string | null;
  appointmentId: string | null;
  date: ISODate | null;
  startTime: TimeString | null;
  serviceName: string | null;
  professionalName: string | null;
  patients: { name: string; toVerify: boolean }[];
  confirmedBy: string | null;
}

/** En la campana, el paciente con su nombre completo (decisión 4 del dueño). */
const FULL_NAME = { name: (fullName: string) => fullName };

/** El aviso armado para quien lo lee, con los datos de hoy de la cita (null si ya no se puede armar). */
function toPanelNotice(row: NoticeRow, now: Date): PanelNotice | null {
  let text: NoticeText | null = null;
  if ((PLATFORM_NOTICE_KINDS as readonly string[]).includes(row.kind)) {
    if (row.title && row.body && row.url) text = { title: row.title, body: row.body, url: row.url };
  } else if (row.kind === "evening_summary") {
    const date = typeof row.data.date === "string" ? row.data.date : null;
    const count = Number(row.data.count);
    if (date && count > 0) text = describeNotice("evening_summary", { date, count }, { ...FULL_NAME, now });
  } else if (row.kind === "morning_summary") {
    // El del negocio entero (el del propietario) no tiene agenda (spec 021).
    const count = Number(row.data.count);
    if (count > 0) text = describeNotice("morning_summary", { count, wholeBusiness: row.noticeAgendaId === null }, { ...FULL_NAME, now });
  } else if (row.appointmentId && row.date && row.startTime) {
    const appointment: NoticeAppointment = {
      id: row.appointmentId,
      date: row.date,
      startTime: row.startTime,
      timezone: row.timezone ?? DEFAULT_TIMEZONE,
      agendas: row.agendas,
      serviceName: row.serviceName,
      professionalName: row.professionalName,
      patients: row.patients,
    };
    const options = { ...FULL_NAME, now };
    switch (row.kind) {
      case "patient_confirm":
        text = describeNotice(
          "patient_confirm",
          { appointment, confirmedBy: row.confirmedBy ?? row.patients[0]?.name ?? "" },
          options,
        );
        break;
      case "new_appointment":
        text = describeNotice("new_appointment", { appointment, count: Number(row.data.count) || undefined }, options);
        break;
      case "booking":
      case "receipt":
      case "patient_cancel":
      case "unclosed":
        text = describeNotice(row.kind, { appointment }, options);
        break;
    }
  }
  return text ? { id: row.id, kind: row.kind, ...text, createdAt: row.createdAt, read: row.read } : null;
}

/** «2026-10-15T09:12:00.123456Z|<id>»: la fecha exacta (con microsegundos) y el id del último. */
function parseCursor(cursor: string | undefined): [string | null, string | null] {
  if (!cursor) return [null, null];
  const [at, id] = cursor.split("|");
  return [at, id];
}

/** Una página de avisos de esta persona, del más nuevo al más viejo (la campana y la página «Avisos»). */
export async function listNotices(db: Db, reader: NoticeReader, query: Record<string, unknown>): Promise<PanelNoticePage> {
  const clean = Object.fromEntries(Object.entries(query).filter(([, value]) => typeof value === "string" && value !== ""));
  const filters = parseInput(noticeListQuerySchema, clean);
  const [cursorAt, cursorId] = parseCursor(filters.cursor);
  const rows = await many<NoticeRow>(
    db,
    `${visibleCte(reader)}
     select v.id, v.kind, v.created_at as "createdAt", v.read, v.data, v.title, v.body, v.url,
            to_char(v.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorAt",
            me.timezone, me.agendas, v.professional_id as "noticeAgendaId",
            a.id as "appointmentId", a.date, a.start_time as "startTime",
            s.name as "serviceName", p.display_name as "professionalName",
            case when a.id is null then '[]'::json else ${noticePatientsSql("a")} end as patients,
            c.name as "confirmedBy"
       from visible v
       cross join me
       left join appointments a on a.id = v.appointment_id
       left join services s on s.id = a.service_id
       left join professionals p on p.id = a.professional_id
       left join clients c on c.id = v.client_id
      where ($3::timestamptz is null or (v.created_at, v.id) < ($3::timestamptz, $4::uuid))
        and (not $5::boolean or not v.read)
      order by v.created_at desc, v.id desc
      limit $6`,
    [...readerParams(reader), cursorAt, cursorId, filters.unread === "1", filters.limit + 1],
  );
  const page = rows.slice(0, filters.limit);
  const now = new Date();
  const last = page[page.length - 1];
  return {
    notices: page.map((row) => toPanelNotice(row, now)).filter((notice) => notice !== null),
    unread: await countUnread(db, reader),
    nextCursor: rows.length > filters.limit && last ? `${last.cursorAt}|${last.id}` : null,
  };
}

/** Marca uno como leído (al tocarlo). 404 si no existe o esa persona no lo ve: la misma respuesta. */
export async function markRead(db: Db, reader: NoticeReader, noticeId: string): Promise<void> {
  if (!isUuid(noticeId)) throw new AppError("not_found", NOT_FOUND);
  const params = [...readerParams(reader), noticeId];
  const saved = await one(
    db,
    `${visibleCte(reader)}
     insert into panel_notice_reads (user_id, notice_id) select $1::uuid, id from visible where id = $3::uuid
     on conflict do nothing
     returning 1`,
    params,
  );
  // Nada guardado: ya estaba leído (repetirlo no cambia nada) o no es suyo.
  if (!saved && !(await one(db, `${visibleCte(reader)} select 1 from visible where id = $3::uuid`, params))) {
    throw new AppError("not_found", NOT_FOUND);
  }
}

/**
 * «Marcar todo como leído»: todo lo creado hasta ahora cuenta como leído (una fila con la hora, R7). Sus
 * lecturas sueltas de antes ya no hacen falta.
 */
export async function markAllRead(db: Db, reader: NoticeReader): Promise<void> {
  await db.query(
    `with saved as (
       insert into panel_notice_state (user_id, read_all_at) values ($1, now())
       on conflict (user_id) do update set read_all_at = excluded.read_all_at
       returning read_all_at)
     delete from panel_notice_reads r using panel_notices n, saved
      where r.user_id = $1 and n.id = r.notice_id and n.created_at <= saved.read_all_at`,
    [reader.userId],
  );
}

/* --------------------------------------------------------------- Borrado -- */

/** Limpieza del cron: los avisos de más de 30 días (con sus lecturas, en cascada). */
export async function cleanupPanelNotices(): Promise<number> {
  const result = await pool.query("delete from panel_notices where created_at < now() - make_interval(days => $1)", [NOTICE_DAYS]);
  return result.rowCount ?? 0;
}

/* ----------------------------------------------------------------- Rutas -- */

/**
 * La campana del negocio: cualquier rol del equipo (cada uno recibe lo suyo). El super admin en modo
 * soporte recibe 403: es del equipo, sus avisos están en /admin.
 */
async function businessReader(ctx: RequestContext, businessId: string): Promise<NoticeReader> {
  const actor = await authorize(pool, ctx, businessId);
  if (actor.support) throw new AppError("forbidden", SUPPORT_FORBIDDEN);
  return { userId: actor.userId, businessId };
}

/** La campana de /admin: cada super admin (con la verificación en dos pasos, como el resto de /admin). */
function platformReader(ctx: RequestContext): NoticeReader {
  return { userId: authorizeSuperAdmin(ctx).userId, businessId: null };
}

/** /api/businesses/:businessId/notices (spec 014). Ninguna ruta escribe en la actividad. */
export const panelNoticeService = {
  async unread(ctx: RequestContext, businessId: string): Promise<{ unread: number }> {
    return { unread: await countUnread(pool, await businessReader(ctx, businessId)) };
  },
  async list(ctx: RequestContext, businessId: string, query: Record<string, unknown>): Promise<PanelNoticePage> {
    return listNotices(pool, await businessReader(ctx, businessId), query);
  },
  async markRead(ctx: RequestContext, businessId: string, noticeId: string): Promise<void> {
    await markRead(pool, await businessReader(ctx, businessId), noticeId);
  },
  async markAllRead(ctx: RequestContext, businessId: string): Promise<void> {
    await markAllRead(pool, await businessReader(ctx, businessId));
  },
};

/** /api/admin/notices (spec 014): los avisos del super admin (cinco desde la spec 021). */
export const platformNoticeService = {
  async unread(ctx: RequestContext): Promise<{ unread: number }> {
    return { unread: await countUnread(pool, platformReader(ctx)) };
  },
  list(ctx: RequestContext, query: Record<string, unknown>): Promise<PanelNoticePage> {
    return listNotices(pool, platformReader(ctx), query);
  },
  async markRead(ctx: RequestContext, noticeId: string): Promise<void> {
    await markRead(pool, platformReader(ctx), noticeId);
  },
  async markAllRead(ctx: RequestContext): Promise<void> {
    await markAllRead(pool, platformReader(ctx));
  },
};
