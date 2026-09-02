-- 0067 (Widget templates, spec 2026-09-02): update_org_widget_theme learns
-- the two layout keys (`layout` — how free times show; `stayLayout` — how a
-- stay is picked) and the Geist font. Same shape as 0033: a key whitelist
-- and per-key enums, `not found` on anything else. Values mirror
-- SLOT_LAYOUTS / STAY_LAYOUTS / WIDGET_FONT_IDS in src/lib/widget-theme.ts.
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

  update public.orgs set widget_theme = p_theme where id = p_org_id;
end;
$$;

revoke all on function public.update_org_widget_theme(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.update_org_widget_theme(uuid, jsonb) to authenticated;
