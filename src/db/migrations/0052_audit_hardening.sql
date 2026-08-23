CREATE TABLE "org_handle_history" (
	"handle" text PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_handle_history" ADD CONSTRAINT "org_handle_history_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_handle_history_org_id_idx" ON "org_handle_history" USING btree ("org_id");--> statement-breakpoint
-- ============================================================================
-- 0052 (full-app audit 2026-08-24). The generated part above adds
-- org_handle_history; everything below is hand-written and idempotent (create
-- or replace / revoke-then-grant / drop-if-exists, 0043 doctrine).
--
--  A. org_handle_history: RLS on, admin-client only.
--  B. Handles: a released handle stays with the org that used it (rename no
--     longer frees the old address for a stranger); distinct 'invalid
--     timezone' error; create_org refuses a second org per user.
--  C. The public booking RPCs (create/reschedule/cancel + the rental pair)
--     leave the anon grant surface. Only the RPC's containment check ran at
--     the DB; min notice, buffers, grid alignment, max/day and the plan
--     roster live in the app's slot engine — so with the public anon key a
--     caller could book straight through PostgREST and skip all of them.
--     The server actions (which re-run the engine) are now the only entry:
--     they call via service_role; the token stays the credential.
--     + create_booking takes the engine's free set (p_candidates) so
--       "anyone" can never land on a person the engine excluded;
--     + a per-email hourly cap on create/reschedule and the per-org minute
--       cap on reschedule (it had none — an unbounded mail/row loop).
--  D. org_feature_flags: members no longer read updated_by (the owner's
--     internal address) — same reasoning as 0046 for plan overrides.
--  E. programs: revoke-then-narrow the UPDATE grant like every sibling.
--  F. apply_billing_event: an org_id that no longer exists is recorded as
--     'unresolvable org' instead of raising 23503 for days of retries.
--  G. resolve_booking_token: a manage link stops resolving 30 days after
--     the booking ends (tokens were eternal).
--  H. branding bucket 5 MiB -> 4 MiB (Vercel's 4.5 MB request-body cap).
-- ============================================================================

-- ---------- A. org_handle_history
alter table public.org_handle_history enable row level security;
revoke all on table public.org_handle_history from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.org_handle_history to service_role;

-- ---------- B. handles
create or replace function public.is_handle_available(p_handle text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_handle is not null
     and p_handle ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'
     and not (p_handle = any (public.reserved_handles()))
     and not exists (select 1 from public.orgs o where o.handle = p_handle)
     and not exists (select 1 from public.org_handle_history h where h.handle = p_handle)
$$;
revoke all on function public.is_handle_available(text) from public, anon, authenticated, service_role;
grant execute on function public.is_handle_available(text) to anon, authenticated;

create or replace function public.update_org_scheduling(
  p_org_id uuid,
  p_handle text,
  p_timezone text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then
    raise exception 'not found';
  end if;
  if p_handle is not null and p_handle !~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$' then
    raise exception 'not found';
  end if;
  if p_handle is not null and p_handle = any (public.reserved_handles()) then
    raise exception 'reserved handle';
  end if;
  if p_timezone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'invalid timezone';
  end if;
  select o.handle into v_old from public.orgs o where o.id = p_org_id for update;
  -- A handle another org once used is theirs for good. Surfaced as 23505 so
  -- the callers' "just taken" mapping covers it.
  if p_handle is not null and exists (
    select 1 from public.org_handle_history h where h.handle = p_handle and h.org_id <> p_org_id
  ) then
    raise exception 'handle taken' using errcode = 'unique_violation';
  end if;
  update public.orgs
    set handle = p_handle, timezone = p_timezone
    where id = p_org_id;
  if v_old is not null and v_old is distinct from p_handle then
    insert into public.org_handle_history (handle, org_id) values (v_old, p_org_id)
    on conflict (handle) do update set org_id = excluded.org_id, released_at = now();
  end if;
  -- Taking one of its own old handles back retires the history row.
  if p_handle is not null then
    delete from public.org_handle_history h where h.handle = p_handle and h.org_id = p_org_id;
  end if;
end;
$$;
revoke all on function public.update_org_scheduling(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.update_org_scheduling(uuid, text, text) to authenticated;

-- create_org (0041 body) + the one-org-per-account guard. Every dashboard
-- tenant resolver reads the caller's FIRST org with no ORDER BY; a second
-- membership would make every write land on a nondeterministic org.
create or replace function public.create_org(p_name text)
returns public.orgs language plpgsql security definer set search_path = '' as $$
declare
  v_org public.orgs;
  v_slug text;
  v_staff_slug text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from public.org_members m where m.user_id = auth.uid()) then
    raise exception 'already onboarded';
  end if;
  v_slug := regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug);
  if v_slug = '' then v_slug := 'org'; end if;
  v_staff_slug := trim(both '-' from left(v_slug, 40));
  if length(v_staff_slug) < 2 then v_staff_slug := v_staff_slug || '-1'; end if;
  v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  insert into public.orgs (name, slug) values (trim(p_name), v_slug) returning * into v_org;
  insert into public.org_members (org_id, user_id, role) values (v_org.id, auth.uid(), 'owner');
  -- staff.name is capped at 80; orgs.name is not, so clamp rather than fail.
  insert into public.staff (org_id, name, slug, color, sort_order)
    values (v_org.id, left(trim(p_name), 80), v_staff_slug, '#4f46e5', 0);
  return v_org;
end; $$;
revoke all on function public.create_org(text) from public, anon, authenticated, service_role;
grant execute on function public.create_org(text) to authenticated;

create or replace function public.create_org_with_page(p_name text, p_handle text, p_timezone text)
returns public.orgs language plpgsql security definer set search_path = '' as $$
declare
  v_org public.orgs;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_handle is not null and p_handle !~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$' then
    raise exception 'not found';
  end if;
  if p_handle is not null and p_handle = any (public.reserved_handles()) then
    raise exception 'reserved handle';
  end if;
  if p_timezone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'invalid timezone';
  end if;
  if p_handle is not null and exists (select 1 from public.org_handle_history h where h.handle = p_handle) then
    raise exception 'handle taken' using errcode = 'unique_violation';
  end if;
  v_org := public.create_org(p_name);
  update public.orgs
    set handle = p_handle, timezone = p_timezone
    where id = v_org.id
    returning * into v_org;
  return v_org;
end;
$$;
revoke all on function public.create_org_with_page(text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_org_with_page(text, text, text) to authenticated;

-- ---------- C. booking RPCs
-- Serves the per-email caps below (create + reschedule).
create index if not exists bookings_org_email_created_idx
  on public.bookings (org_id, lower(client_email), created_at desc);

-- pick_staff_for_slot v2: + p_candidates (null = every eligible member, the
-- 0041 behaviour). The engine already knows who is genuinely free at the
-- instant once buffers and max/day are applied; the DB ranking (least loaded
-- that org-local day) now runs inside that set instead of over the raw roster.
drop function if exists public.pick_staff_for_slot(uuid, text, timestamptz, timestamptz, uuid[]);
create function public.pick_staff_for_slot(
  p_service_id uuid, p_timezone text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_exclude uuid[], p_candidates uuid[] default null
) returns uuid language sql stable set search_path = '' as $$
  select st.id
  from public.service_staff ss
  join public.staff st on st.id = ss.staff_id
  where ss.service_id = p_service_id and st.active
    and st.id <> all(coalesce(p_exclude, '{}'::uuid[]))
    and (p_candidates is null or st.id = any(p_candidates))
    and public.slot_within_availability(st.id, p_timezone, p_starts_at, p_ends_at)
    and public.staff_is_free(st.id, p_starts_at, p_ends_at, null)
  order by (
      select count(*) from public.bookings b
      where b.staff_id = st.id and b.status = 'confirmed'
        and (b.starts_at at time zone p_timezone)::date = (p_starts_at at time zone p_timezone)::date
    ) asc, st.sort_order asc, st.created_at asc
  limit 1;
$$;
revoke all on function public.pick_staff_for_slot(uuid, text, timestamptz, timestamptz, uuid[], uuid[])
  from public, anon, authenticated, service_role;

-- create_booking v4: 0041 body + p_candidates + per-email cap; service_role only.
drop function if exists public.create_booking(text, uuid, timestamptz, text, text, text, text, uuid);
create function public.create_booking(
  p_handle text, p_service_id uuid, p_starts_at timestamptz, p_name text, p_email text,
  p_note text, p_token_hash text, p_staff_id uuid default null, p_candidates uuid[] default null
) returns table (booking_id uuid, staff_id uuid, staff_name text)
language plpgsql security definer set search_path = '' as $$
declare
  v_org record;
  v_service record;
  v_recent int;
  v_ends_at timestamptz;
  v_client_id uuid;
  v_booking_id uuid;
  v_staff uuid;
  v_tried uuid[] := '{}';
  v_attempts int := 0;
begin
  select o.id, o.timezone into v_org from public.orgs o where o.handle = p_handle;
  if v_org.id is null then raise exception 'not found'; end if;
  select s.id, s.duration_min, s.booking_window_days into v_service
    from public.services s where s.id = p_service_id and s.org_id = v_org.id and s.active;
  if v_service.id is null then raise exception 'not found'; end if;
  if p_starts_at is null or p_starts_at <= now() then raise exception 'not found'; end if;
  if p_starts_at > now() + make_interval(days => v_service.booking_window_days + 1) then raise exception 'not found'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 200 then raise exception 'not found'; end if;
  if p_email is null or length(p_email) > 320 or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'not found'; end if;
  if p_note is not null and length(p_note) > 2000 then raise exception 'not found'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'not found'; end if;
  select count(*) into v_recent from public.bookings b where b.org_id = v_org.id and b.created_at > now() - interval '1 minute';
  if v_recent >= 30 then raise exception 'not found'; end if;
  -- One address, one org, five rows an hour (any status — reschedules
  -- create rows too). Bounds the confirmation-mail and calendar-fill loops
  -- a single address could otherwise drive; a distinct sentinel so the
  -- action can say so instead of "try again".
  select count(*) into v_recent from public.bookings b
    where b.org_id = v_org.id and lower(b.client_email) = lower(p_email)
      and b.created_at > now() - interval '1 hour';
  if v_recent >= 5 then raise exception 'too_many'; end if;
  v_ends_at := p_starts_at + make_interval(mins => v_service.duration_min);

  if p_staff_id is not null then
    -- Named staff: must be active, in the org, offering the service, inside hours.
    if not exists (
      select 1 from public.staff st join public.service_staff ss on ss.staff_id = st.id
      where st.id = p_staff_id and st.org_id = v_org.id and st.active and ss.service_id = p_service_id
    ) then raise exception 'staff_unavailable'; end if;
    if not public.slot_within_availability(p_staff_id, v_org.timezone, p_starts_at, v_ends_at) then
      raise exception 'not found';
    end if;
    v_staff := p_staff_id;
  else
    -- Auto-assign. If no eligible staff is even open at this time -> not found
    -- (uniform); if all open ones are busy -> taken.
    if not exists (
      select 1 from public.service_staff ss join public.staff st on st.id = ss.staff_id
      where ss.service_id = p_service_id and st.active
        and (p_candidates is null or st.id = any(p_candidates))
        and public.slot_within_availability(st.id, v_org.timezone, p_starts_at, v_ends_at)
    ) then raise exception 'not found'; end if;
  end if;

  insert into public.clients (org_id, name, email)
  values (v_org.id, btrim(p_name), lower(p_email))
  on conflict (org_id, lower(email)) where email is not null
  do update set name = clients.name
  returning id into v_client_id;

  loop
    if p_staff_id is null then
      v_staff := public.pick_staff_for_slot(p_service_id, v_org.timezone, p_starts_at, v_ends_at, v_tried, p_candidates);
      if v_staff is null then raise exception 'taken'; end if;
    end if;
    begin
      insert into public.bookings
        (org_id, service_id, staff_id, client_id, client_name, client_email,
         starts_at, ends_at, status, cancel_token_hash, note)
      values
        (v_org.id, p_service_id, v_staff, v_client_id, btrim(p_name), lower(p_email),
         p_starts_at, v_ends_at, 'confirmed', p_token_hash, p_note)
      returning id into v_booking_id;
      exit;
    exception when exclusion_violation then
      -- Named staff: surface as the classic 23P01 so callers keep their
      -- "slot taken" mapping. Auto: try the next eligible staff (race lost).
      if p_staff_id is not null then raise; end if;
      v_tried := v_tried || v_staff;
      v_attempts := v_attempts + 1;
      if v_attempts > 20 then raise exception 'taken'; end if;
    end;
  end loop;

  return query select v_booking_id, v_staff, st.name from public.staff st where st.id = v_staff;
end; $$;
revoke all on function public.create_booking(text, uuid, timestamptz, text, text, text, text, uuid, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.create_booking(text, uuid, timestamptz, text, text, text, text, uuid, uuid[]) to service_role;

-- reschedule_booking v3: 0041 body + the per-org minute cap create has + the
-- per-email hourly cap; service_role only.
create or replace function public.reschedule_booking(p_token text, p_starts_at timestamptz, p_new_token_hash text)
returns table (
  new_booking_id uuid, org_id uuid, org_name text, org_timezone text, service_name text,
  client_name text, client_email text, old_starts_at timestamptz, new_starts_at timestamptz,
  staff_id uuid, staff_name text
) language plpgsql security definer set search_path = '' as $$
declare
  v_hash text; v_old record; v_service record; v_tz text; v_ends_at timestamptz; v_new_id uuid; v_recent int;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then return; end if;
  if p_new_token_hash is null or p_new_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'not found'; end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  select b.id, b.org_id, b.service_id, b.staff_id, b.client_id, b.client_name, b.client_email, b.note, b.starts_at
    into v_old from public.bookings b
    where b.cancel_token_hash = v_hash and b.status = 'confirmed' and b.starts_at > now()
    for update;
  if v_old.id is null then return; end if;
  if v_old.service_id is null then raise exception 'not found'; end if;
  select count(*) into v_recent from public.bookings b where b.org_id = v_old.org_id and b.created_at > now() - interval '1 minute';
  if v_recent >= 30 then raise exception 'not found'; end if;
  select count(*) into v_recent from public.bookings b
    where b.org_id = v_old.org_id and lower(b.client_email) = lower(v_old.client_email)
      and b.created_at > now() - interval '1 hour';
  if v_recent >= 5 then raise exception 'too_many'; end if;
  select s.id, s.duration_min, s.booking_window_days into v_service from public.services s where s.id = v_old.service_id and s.active;
  if v_service.id is null then raise exception 'not found'; end if;
  select o.timezone into v_tz from public.orgs o where o.id = v_old.org_id;
  if p_starts_at is null or p_starts_at <= now() then raise exception 'not found'; end if;
  if p_starts_at > now() + make_interval(days => v_service.booking_window_days + 1) then raise exception 'not found'; end if;
  v_ends_at := p_starts_at + make_interval(mins => v_service.duration_min);
  if not public.slot_within_availability(v_old.staff_id, v_tz, p_starts_at, v_ends_at) then raise exception 'not found'; end if;
  update public.bookings b set status = 'rescheduled' where b.id = v_old.id;
  insert into public.bookings
    (org_id, service_id, staff_id, client_id, client_name, client_email, starts_at, ends_at, status, cancel_token_hash, note, rescheduled_from_id)
  values
    (v_old.org_id, v_old.service_id, v_old.staff_id, v_old.client_id, v_old.client_name, v_old.client_email, p_starts_at, v_ends_at, 'confirmed', p_new_token_hash, v_old.note, v_old.id)
  returning id into v_new_id;
  return query
    select v_new_id, v_old.org_id, o.name, o.timezone, s.name, v_old.client_name, v_old.client_email,
           v_old.starts_at, p_starts_at, v_old.staff_id, st.name
    from public.orgs o, public.services s, public.staff st
    where o.id = v_old.org_id and s.id = v_old.service_id and st.id = v_old.staff_id;
end; $$;
revoke all on function public.reschedule_booking(text, timestamptz, text) from public, anon, authenticated, service_role;
grant execute on function public.reschedule_booking(text, timestamptz, text) to service_role;

revoke all on function public.cancel_booking(text) from public, anon, authenticated, service_role;
grant execute on function public.cancel_booking(text) to service_role;

-- The rental pair leaves the anon surface for the same reason (the range
-- engine's rules — min stay, turnover, notice — live in the app too).
revoke all on function public.create_rental_booking(text, uuid, uuid, date, date, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_rental_booking(text, uuid, uuid, date, date, text, text, text, text) to service_role;
revoke all on function public.reschedule_rental_booking(text, uuid, date, date, text)
  from public, anon, authenticated, service_role;
grant execute on function public.reschedule_rental_booking(text, uuid, date, date, text) to service_role;

-- ---------- G. resolve_booking_token v5: 0041 body + a 30-day tail
create or replace function public.resolve_booking_token(p_token text)
returns table (
  booking_id uuid, booking_status text, starts_at timestamptz, ends_at timestamptz, service_name text,
  org_name text, org_timezone text, org_id uuid, service_id uuid, rental_unit_id uuid, range_mode text,
  staff_id uuid, staff_name text
) language plpgsql security definer set search_path = '' as $$
declare v_hash text;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then return; end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  return query
    select b.id, b.status, b.starts_at, b.ends_at, coalesce(s.name, ro.name || ' · ' || u.name),
           o.name, o.timezone, b.org_id, b.service_id, b.rental_unit_id, ro.range_mode, b.staff_id, st.name
    from public.bookings b
    join public.orgs o on o.id = b.org_id
    left join public.services s on s.id = b.service_id
    left join public.staff st on st.id = b.staff_id
    left join public.rental_offerings ro on ro.id = b.rental_offering_id
    left join public.rental_units u on u.id = b.rental_unit_id
    where b.cancel_token_hash = v_hash
      and b.ends_at > now() - interval '30 days';
end; $$;
revoke all on function public.resolve_booking_token(text) from public, anon, authenticated, service_role;
grant execute on function public.resolve_booking_token(text) to anon, service_role;

-- ---------- D. org_feature_flags: members read (org_id, flag, enabled) only
revoke select on table public.org_feature_flags from authenticated;
grant select (org_id, flag, enabled) on table public.org_feature_flags to authenticated;

-- ---------- E. programs: revoke-then-narrow (0006 granted without revoking first)
revoke update on table public.programs from authenticated;
grant update (name, updated_at) on table public.programs to authenticated;

-- ---------- F. apply_billing_event: 0043 body + unresolvable-org nulling
create or replace function public.apply_billing_event(
  p_provider text, p_event_id text, p_occurred_at timestamptz, p_org_id uuid,
  p_type text, p_payload jsonb, p_sub jsonb
) returns text
language plpgsql security definer set search_path = '' as $$
begin
  -- An org that no longer exists (deleted after the subscription was sold —
  -- spec §7.12's "cancel in Stripe FIRST" warning) is unresolvable, not an
  -- FK violation: record it and answer 200 so the provider stops retrying.
  if p_org_id is not null and not exists (select 1 from public.orgs o where o.id = p_org_id) then
    p_org_id := null;
  end if;
  begin
    insert into public.billing_events (provider, provider_event_id, org_id, type, payload, error)
    values (p_provider, p_event_id, p_org_id, p_type, coalesce(p_payload, '{}'::jsonb),
            case when p_org_id is null then 'unresolvable org'
                 when p_sub is null and p_type <> 'subscription_expired' then 'no subscription payload'
                 else null end);
  exception when unique_violation then
    return 'replayed';
  end;
  if p_org_id is not null and p_sub is null and p_type = 'subscription_expired' then
    update public.org_subscriptions s
       set status = 'expired', provider_updated_at = p_occurred_at, updated_at = now()
     where s.org_id = p_org_id and s.provider_updated_at <= p_occurred_at;
    if found then return 'processed'; else return 'stale'; end if;
  end if;
  if p_org_id is null or p_sub is null then
    return 'skipped';
  end if;
  insert into public.org_subscriptions as s (
    org_id, plan, status, billing_interval, seats, provider, provider_customer_id, provider_subscription_id,
    current_period_end, cancel_at_period_end, provider_updated_at, updated_at)
  values (
    p_org_id, p_sub->>'plan', p_sub->>'status', p_sub->>'interval', coalesce((p_sub->>'seats')::int, 1),
    p_provider, p_sub->>'providerCustomerId', p_sub->>'providerSubscriptionId',
    nullif(p_sub->>'currentPeriodEnd','')::timestamptz, coalesce((p_sub->>'cancelAtPeriodEnd')::boolean, false),
    p_occurred_at, now())
  on conflict (org_id) do update set
    plan = excluded.plan, status = excluded.status, billing_interval = excluded.billing_interval,
    seats = excluded.seats, provider = excluded.provider, provider_customer_id = excluded.provider_customer_id,
    provider_subscription_id = excluded.provider_subscription_id, current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end, provider_updated_at = excluded.provider_updated_at,
    updated_at = now()
  where s.provider_updated_at <= excluded.provider_updated_at;
  if found then return 'processed'; else return 'stale'; end if;
end $$;
revoke all on function public.apply_billing_event(text, text, timestamptz, uuid, text, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.apply_billing_event(text, text, timestamptz, uuid, text, jsonb, jsonb) to service_role;

-- ---------- H. branding bucket: 4 MiB (features/booking-page/images.ts PAGE_IMAGE_MAX_BYTES)
update storage.buckets set file_size_limit = 4194304 where id = 'branding';

-- Signatures and grants changed; PostgREST must re-read its cache.
notify pgrst, 'reload schema';
