-- 0077 (Google Calendar v2 — Calendly parity, spec 2026-09-05 v2): the
-- client is a guest on the event, two opt-in switches let a Google delete
-- cancel and a Google move reschedule, and the push channel + poll cursor
-- that detect those edits.
alter table public.calendar_connections
  add column invite_clients boolean not null default true,
  add column cancel_on_delete boolean not null default false,
  add column reschedule_on_move boolean not null default false,
  add column watch_channel_id text,
  add column watch_resource_id text,
  add column watch_expires_at timestamptz,
  add column inbound_checked_at timestamptz,
  add column inbound_notice text;
-- The webhook resolves a notification by its channel id.
create unique index calendar_connections_watch_channel_uq
  on public.calendar_connections(watch_channel_id) where watch_channel_id is not null;

-- ---------- reschedule_booking_system: the admin reschedule (0041
-- reschedule_booking_admin) minus the membership guard, for the inbound
-- sync that acts on the OWNER's Google edit with no session. Same rules —
-- confirmed appointment only, future, inside the window, inside the
-- person's hours; the EXCLUDE guard is the last line — and the same
-- insert-new + mark-old shape, so every mirror/mail path downstream is the
-- one the admin move already uses. service_role only: the caller
-- (features/calendar-sync/inbound.ts) has already matched the Google event
-- to this booking through the connection's own row.
create or replace function public.reschedule_booking_system(
  p_booking_id uuid, p_starts_at timestamptz, p_token_hash text
) returns table (new_booking_id uuid, staff_name text)
language plpgsql security definer set search_path = '' as $$
declare
  v_old record; v_service record; v_tz text; v_ends_at timestamptz; v_new_id uuid;
begin
  if p_booking_id is null then raise exception 'not found'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'not found'; end if;
  select b.id, b.org_id, b.service_id, b.staff_id, b.client_id, b.client_name, b.client_email, b.note
    into v_old from public.bookings b
    where b.id = p_booking_id and b.status = 'confirmed' and b.service_id is not null
    for update;
  if v_old.id is null then raise exception 'not found'; end if;
  select s.id, s.duration_min, s.booking_window_days into v_service from public.services s where s.id = v_old.service_id;
  if v_service.id is null then raise exception 'not found'; end if;
  if not exists (
    select 1 from public.staff st join public.service_staff ss on ss.staff_id = st.id
    where st.id = v_old.staff_id and st.org_id = v_old.org_id and st.active and ss.service_id = v_old.service_id
  ) then raise exception 'staff_unavailable'; end if;
  select o.timezone into v_tz from public.orgs o where o.id = v_old.org_id;
  if p_starts_at is null or p_starts_at <= now() then raise exception 'not found'; end if;
  if p_starts_at > now() + make_interval(days => v_service.booking_window_days + 1) then raise exception 'not found'; end if;
  v_ends_at := p_starts_at + make_interval(mins => v_service.duration_min);
  if not public.slot_within_availability(v_old.staff_id, v_tz, p_starts_at, v_ends_at) then raise exception 'not found'; end if;
  update public.bookings b set status = 'rescheduled' where b.id = v_old.id;
  insert into public.bookings
    (org_id, service_id, staff_id, client_id, client_name, client_email, starts_at, ends_at, status, cancel_token_hash, note, rescheduled_from_id)
  values
    (v_old.org_id, v_old.service_id, v_old.staff_id, v_old.client_id, v_old.client_name, v_old.client_email, p_starts_at, v_ends_at, 'confirmed', p_token_hash, v_old.note, v_old.id)
  returning id into v_new_id;
  return query select v_new_id, st.name from public.staff st where st.id = v_old.staff_id;
end; $$;
revoke all on function public.reschedule_booking_system(uuid, timestamptz, text) from public, anon, authenticated, service_role;
grant execute on function public.reschedule_booking_system(uuid, timestamptz, text) to service_role;
