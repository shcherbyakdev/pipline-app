-- Approval follow-ups (0062/0063 v1 gaps). Three functions learn that a
-- pending request is a live booking too; nothing else moves.

-- ---------- rotate_booking_token (base: 0033): re-sending a pending
-- request's link rotates its token exactly like a confirmed booking's — the
-- client's only handle on the request is that link.
create or replace function public.rotate_booking_token(
  p_booking_id uuid,
  p_token_hash text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_booking_id is null then raise exception 'not found'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'not found';
  end if;

  update public.bookings b
    set cancel_token_hash = p_token_hash
    where b.id = p_booking_id
      and b.org_id in (select public.user_orgs())
      and b.status in ('confirmed','pending')
      and b.starts_at > now()
    returning b.id into v_id;
  if v_id is null then raise exception 'not found'; end if;

  return v_id;
end;
$$;

revoke all on function public.rotate_booking_token(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.rotate_booking_token(uuid, text) to authenticated;

-- ---------- resolve_booking_token (base: 0058): return type changes
-- (+ decline_note appended after cancel_window_min — PostgREST/TS callers
-- select columns by name, so appending is safe; order stays stable for
-- sanity). A declined request's manage page shows the provider's reason.
drop function public.resolve_booking_token(text);
create function public.resolve_booking_token(p_token text)
returns table (
  booking_id uuid, booking_status text, starts_at timestamptz, ends_at timestamptz, service_name text,
  org_name text, org_timezone text, org_id uuid, service_id uuid, rental_unit_id uuid, range_mode text,
  staff_id uuid, staff_name text,
  price_cents int, currency text, deposit_cents int, cancel_window_min int, decline_note text
) language plpgsql security definer set search_path = '' as $$
declare v_hash text;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then return; end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  return query
    select b.id, b.status, b.starts_at, b.ends_at, coalesce(s.name, ro.name || ' · ' || u.name),
           o.name, o.timezone, b.org_id, b.service_id, b.rental_unit_id, ro.range_mode, b.staff_id, st.name,
           b.price_cents, b.currency, b.deposit_cents, ro.cancel_window_min, b.decline_note
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

-- ---------- staff_guard_update (base: 0041): a member holding live pending
-- requests can't be taken off the roster either — those requests are still
-- theirs to answer. Sentinel stays `has_future_bookings`; the trigger itself
-- is unchanged, so only the function body is replaced.
create or replace function public.staff_guard_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.org_id <> old.org_id then raise exception 'org mismatch'; end if;
  if new.user_id is distinct from old.user_id and old.user_id is not null then
    raise exception 'user_id immutable';
  end if;
  if old.active and not new.active then
    if not exists (select 1 from public.staff s where s.org_id = old.org_id and s.active and s.id <> old.id) then
      raise exception 'last_active_staff';
    end if;
    if exists (select 1 from public.bookings b where b.staff_id = old.id and b.status in ('confirmed','pending') and b.starts_at > now()) then
      raise exception 'has_future_bookings';
    end if;
  end if;
  return new;
end; $$;

-- resolve_booking_token was dropped and recreated with a new return type;
-- PostgREST must re-read its schema cache.
notify pgrst, 'reload schema';
