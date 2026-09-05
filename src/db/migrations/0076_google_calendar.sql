-- 0076 (Google Calendar, spec 2026-09-05): a connected Google account per
-- org, the mirror state per booking, and the trigger that queues a booking
-- for sync whenever a column Google should see changes.
--
-- Both tables are service_role-only. No RLS policy, no grant to
-- authenticated or anon: a refresh token IS the account, and the page reads
-- the columns it renders through requireOrg() + the admin client. RLS is
-- still enabled (defence in depth: a stray grant later would expose
-- nothing until a policy is written too).

-- ---------- calendar_connections: one row per (org, Google account). A
-- reconnect upserts onto the same row (0066 idiom for "the same thing again
-- is not a second thing"). staff_id null = shared: its Busy events block
-- every person and every unit, and bookings with no person (spaces) go
-- here; a person's row blocks only their slots and receives their bookings.
create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'google' check (provider = 'google'),
  account_email text not null,
  refresh_token_enc text not null,
  access_token_enc text,
  access_expires_at timestamptz,
  push_calendar_id text,
  busy_calendar_ids text[] not null default '{}',
  calendars jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active', 'needs_reconnect')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_connections_org_account_uq unique (org_id, account_email)
);
create index calendar_connections_org_id_idx on public.calendar_connections(org_id);
create index calendar_connections_staff_id_idx on public.calendar_connections(staff_id);
alter table public.calendar_connections enable row level security;
revoke all on table public.calendar_connections from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.calendar_connections to service_role;

-- ---------- booking_calendar_events: what exists in Google for a booking
-- (connection + calendar + event id; all null = nothing) and whether the
-- sync still owes it work. The trigger below upserts pending = true; the
-- sync (features/calendar-sync/sync.ts) clears it, or deletes the row when
-- nothing exists and nothing should.
create table public.booking_calendar_events (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  connection_id uuid references public.calendar_connections(id) on delete set null,
  calendar_id text,
  event_id text,
  pending boolean not null default true,
  attempts integer not null default 0,
  last_error text,
  updated_at timestamptz not null default now()
);
-- The drain reads "pending rows of this org, oldest first"; a partial
-- index keeps the settled majority out of it.
create index booking_calendar_events_org_pending_idx
  on public.booking_calendar_events(org_id, updated_at) where pending;
create index booking_calendar_events_connection_id_idx on public.booking_calendar_events(connection_id);
alter table public.booking_calendar_events enable row level security;
revoke all on table public.booking_calendar_events from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.booking_calendar_events to service_role;

-- ---------- The one hook. Bookings are written by a dozen definer RPCs
-- and two app-side updates (cancelBookingAdmin, stampBookingLocale); a
-- reschedule is insert-new + mark-old. Rather than sixteen call sites that
-- can drift, every insert and every change to a column Google should see
-- lands here. Only orgs with a connection pay for it — everyone else gets
-- the EXISTS and nothing more. SECURITY DEFINER because the app-side
-- cancel runs as `authenticated`, which owns nothing on these tables.
-- Attempts reset so a fresh change is always tried again, whatever the
-- previous change's fate.
create or replace function public.queue_calendar_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.calendar_connections c where c.org_id = new.org_id) then
    return null;
  end if;
  insert into public.booking_calendar_events (booking_id, org_id)
  values (new.id, new.org_id)
  on conflict (booking_id) do update
    set pending = true, attempts = 0, last_error = null, updated_at = now();
  return null;
end; $$;
revoke all on function public.queue_calendar_sync() from public, anon, authenticated, service_role;

drop trigger if exists bookings_calendar_queue on public.bookings;
create trigger bookings_calendar_queue
  after insert or update of status, starts_at, ends_at, staff_id, rental_unit_id, client_name, client_email, note
  on public.bookings
  for each row execute function public.queue_calendar_sync();

-- ---------- /integrations is a top-level route now: a handle must never
-- shadow it. Mirror of RESERVED_HANDLES (features/scheduling/handle.ts);
-- 0075 body plus 'integrations'. Same grants: internal to the definer
-- RPCs, nobody calls it.
create or replace function public.reserved_handles() returns text[]
language sql immutable set search_path = '' as $$
  select array[
    'api','auth','availability','billing','book','booking','booking-page','bookings',
    'clients','dev','embed','forgot-password','login','onboarding','overview','portal',
    'pricing','privacy','programs','rentals','reset-password','services','settings','signup',
    'team','templates','terms','utils','waitlist','notifications','integrations',
    'admin','app','www','mail','help','support','docs','blog','about','contact','status',
    'static','assets','public','booklo','new','home','index','sitemap','robots',
    'favicon'
  ]::text[]
$$;
revoke all on function public.reserved_handles() from public, anon, authenticated, service_role;
