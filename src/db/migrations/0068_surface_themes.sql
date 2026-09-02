-- 0068 (One appearance per surface, spec 2026-09-02 §9): the hosted booking
-- page gets its own theme column, backfilled from the embed's; one RPC writes
-- either surface with the 0067 validation, and update_org_widget_theme stays
-- as the embed's name. Note: the widget-template defaults (calendar + times,
-- one month) apply to every org whose theme names no layout — existing orgs
-- move from the week list / two-month picker to the new defaults; the
-- product has no customers yet (PRODUCT.md), so this is a deliberate reset,
-- not a preserved look.
ALTER TABLE "orgs" ADD COLUMN IF NOT EXISTS "page_theme" jsonb;
update public.orgs set page_theme = widget_theme where page_theme is null and widget_theme is not null;

create or replace function public.update_org_surface_theme(
  p_org_id uuid,
  p_surface text,
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
  if p_surface is null or p_surface not in ('page', 'embed') then
    raise exception 'not found';
  end if;

  if p_theme is not null then
    if jsonb_typeof(p_theme) <> 'object' then raise exception 'not found'; end if;
    for v_key in select jsonb_object_keys(p_theme) loop
      if v_key not in ('theme','radius','font','layout','stayLayout','background','text','hidePoweredBy') then
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
      ('system','geist','inter','dm-sans','lora','space-grotesk','ibm-plex-mono') then
      raise exception 'not found';
    end if;
    if p_theme ? 'layout' and p_theme->>'layout' not in
      ('calendar','week-list','week-columns','next-available') then
      raise exception 'not found';
    end if;
    if p_theme ? 'stayLayout' and p_theme->>'stayLayout' not in
      ('one-month','two-months','fields','next-free') then
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

  if p_surface = 'page' then
    update public.orgs set page_theme = p_theme where id = p_org_id;
  else
    update public.orgs set widget_theme = p_theme where id = p_org_id;
  end if;
end;
$$;

revoke all on function public.update_org_surface_theme(uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.update_org_surface_theme(uuid, text, jsonb) to authenticated;

-- The embed's old name: same validation, one place.
create or replace function public.update_org_widget_theme(
  p_org_id uuid,
  p_theme jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.update_org_surface_theme(p_org_id, 'embed', p_theme);
end;
$$;

revoke all on function public.update_org_widget_theme(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.update_org_widget_theme(uuid, jsonb) to authenticated;
