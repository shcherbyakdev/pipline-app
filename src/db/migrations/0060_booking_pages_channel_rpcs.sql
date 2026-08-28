-- 0060 (channel pages, spec 2026-08-28 §2): one booking_pages row per
-- channel. 0059 added `channel` (default 'appointments') and the composite
-- key; this constrains the value, backfills spaces-only orgs (their one page
-- was their spaces page) and gives the three definer RPCs from 0048 a
-- channel. Idempotent.

alter table public.booking_pages drop constraint if exists booking_pages_channel_check;
alter table public.booking_pages add constraint booking_pages_channel_check
  check (channel in ('appointments', 'spaces'));

-- Backfill: an org that does not offer appointments (0054: at least one
-- channel is always on) had exactly one page and it listed spaces. Guarded
-- so a re-run cannot collide with a spaces row written since.
update public.booking_pages p
   set channel = 'spaces'
  from public.orgs o
 where o.id = p.org_id
   and p.channel = 'appointments'
   and not o.offers_appointments
   and not exists (select 1 from public.booking_pages q where q.org_id = p.org_id and q.channel = 'spaces');

-- ---------- The 0048 signatures go away: one path, never two.
drop function if exists public.save_booking_page_draft(uuid, jsonb);
drop function if exists public.publish_booking_page(uuid);
drop function if exists public.discard_booking_page_draft(uuid, jsonb);

-- ---------- Save draft. Cheap structural checks only (0048's, plus the
-- channel): size cap, version, exactly one booking section. Full shape
-- validation is zod in the server action; the renderer safeParses regardless.
create or replace function public.save_booking_page_draft(
  p_org_id uuid,
  p_channel text,
  p_doc jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then
    raise exception 'not found';
  end if;
  if p_channel is null or p_channel not in ('appointments', 'spaces') then raise exception 'not found'; end if;
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' then raise exception 'not found'; end if;
  if pg_column_size(p_doc) > 65536 then raise exception 'too large'; end if;
  if p_doc->>'version' is distinct from '1' then raise exception 'not found'; end if;
  if jsonb_typeof(p_doc->'sections') <> 'array' then raise exception 'not found'; end if;
  if (select count(*) from jsonb_array_elements(p_doc->'sections') s where s->>'type' = 'booking') <> 1 then
    raise exception 'not found';
  end if;

  insert into public.booking_pages (org_id, channel, draft, updated_at)
    values (p_org_id, p_channel, p_doc, now())
    on conflict (org_id, channel) do update set draft = excluded.draft, updated_at = now();
end;
$$;

revoke all on function public.save_booking_page_draft(uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_booking_page_draft(uuid, text, jsonb) to authenticated;

-- ---------- Publish: that channel's draft becomes its live page. The action
-- always saves first, so a missing row here is a genuine error.
create or replace function public.publish_booking_page(
  p_org_id uuid,
  p_channel text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then
    raise exception 'not found';
  end if;
  if p_channel is null or p_channel not in ('appointments', 'spaces') then raise exception 'not found'; end if;
  update public.booking_pages
    set published = draft, published_at = now(), updated_at = now()
    where org_id = p_org_id and channel = p_channel;
  if not found then raise exception 'not found'; end if;
end;
$$;

revoke all on function public.publish_booking_page(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.publish_booking_page(uuid, text) to authenticated;

-- ---------- Discard: that channel's draft goes back to its published page,
-- or to the caller-supplied default composition when never published. No
-- row = nothing to discard (not an error: the studio may never have autosaved).
create or replace function public.discard_booking_page_draft(
  p_org_id uuid,
  p_channel text,
  p_fallback jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then
    raise exception 'not found';
  end if;
  if p_channel is null or p_channel not in ('appointments', 'spaces') then raise exception 'not found'; end if;
  if p_fallback is null or jsonb_typeof(p_fallback) <> 'object' then raise exception 'not found'; end if;
  update public.booking_pages
    set draft = coalesce(published, p_fallback), updated_at = now()
    where org_id = p_org_id and channel = p_channel;
end;
$$;

revoke all on function public.discard_booking_page_draft(uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.discard_booking_page_draft(uuid, text, jsonb) to authenticated;

-- PostgREST caches the schema; the new signatures must be visible immediately.
notify pgrst, 'reload schema';
