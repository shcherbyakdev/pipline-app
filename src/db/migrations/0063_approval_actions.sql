-- Approval actions (booking approval, follow-up to 0062). 0028's provider
-- seam pins authenticated status updates to confirmed -> cancelled_by_provider
-- and grants no decline_note column — so accept/decline are definer RPCs
-- (rotate_booking_token idiom, 0033): org membership via user_orgs(), live
-- pending rows only.

create function public.accept_booking(p_booking_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_booking_id is null then raise exception 'not found'; end if;

  -- pending -> confirmed cannot violate the overlap guards: the row already
  -- holds its slot under the widened EXCLUDE (0062).
  update public.bookings b
    set status = 'confirmed'
    where b.id = p_booking_id
      and b.org_id in (select public.user_orgs())
      and b.status = 'pending'
      and b.starts_at > now()
    returning b.id into v_id;
  if v_id is null then raise exception 'not found'; end if;

  return v_id;
end;
$$;

revoke all on function public.accept_booking(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.accept_booking(uuid) to authenticated;

create function public.decline_booking(p_booking_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_booking_id is null then raise exception 'not found'; end if;
  if p_note is not null and length(p_note) > 500 then raise exception 'not found'; end if;

  update public.bookings b
    set status = 'declined', decline_note = nullif(btrim(p_note), '')
    where b.id = p_booking_id
      and b.org_id in (select public.user_orgs())
      and b.status = 'pending'
      and b.starts_at > now()
    returning b.id into v_id;
  if v_id is null then raise exception 'not found'; end if;

  return v_id;
end;
$$;

revoke all on function public.decline_booking(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.decline_booking(uuid, text) to authenticated;
