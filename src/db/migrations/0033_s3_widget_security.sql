-- Custom SQL migration file, put your code below! --

-- S3: widget theme write path + manage-link rotation.

-- ---------- Widget theme: full-replace semantics (like update_org_branding).
-- Every present key is validated; unknown keys rejected; null clears.
create or replace function public.update_org_widget_theme(
  p_org_id uuid,
  p_theme jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then
    raise exception 'not found';
  end if;

  if p_theme is not null then
    if jsonb_typeof(p_theme) <> 'object' then raise exception 'not found'; end if;
    for v_key in select jsonb_object_keys(p_theme) loop
      if v_key not in ('theme','radius','font','background','text','hidePoweredBy') then
        raise exception 'not found';
      end if;
    end loop;
    if p_theme ? 'theme' and p_theme->>'theme' not in ('light','dark','auto') then
      raise exception 'not found';
    end if;
    if p_theme ? 'radius' and p_theme->>'radius' not in ('none','subtle','round') then
      raise exception 'not found';
    end if;
    if p_theme ? 'font' and p_theme->>'font' not in
      ('system','inter','dm-sans','lora','space-grotesk','ibm-plex-mono') then
      raise exception 'not found';
    end if;
    if p_theme ? 'background' and p_theme->>'background' !~ '^#[0-9a-f]{6}$' then
      raise exception 'not found';
    end if;
    if p_theme ? 'text' and p_theme->>'text' !~ '^#[0-9a-f]{6}$' then
      raise exception 'not found';
    end if;
    if p_theme ? 'hidePoweredBy' and jsonb_typeof(p_theme->'hidePoweredBy') <> 'boolean' then
      raise exception 'not found';
    end if;
  end if;

  update public.orgs set widget_theme = p_theme where id = p_org_id;
end;
$$;

revoke all on function public.update_org_widget_theme(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.update_org_widget_theme(uuid, jsonb) to authenticated;

-- ---------- Manage-link rotation: fresh hash, old link dies. Confirmed +
-- future only (a past/cancelled booking has nothing to manage).
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
      and b.status = 'confirmed'
      and b.starts_at > now()
    returning b.id into v_id;
  if v_id is null then raise exception 'not found'; end if;

  return v_id;
end;
$$;

revoke all on function public.rotate_booking_token(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.rotate_booking_token(uuid, text) to authenticated;
