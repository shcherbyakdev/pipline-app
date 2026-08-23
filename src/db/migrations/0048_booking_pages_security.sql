-- 0048 (Booking page builder): RLS, grants and the three definer RPCs for
-- booking_pages (spec 2026-08-23-booking-page-builder). Idempotent.

-- ---------- RLS: members read their own org's row; nobody but service_role writes directly.
alter table public.booking_pages enable row level security;
drop policy if exists "booking_pages_select_member" on public.booking_pages;
create policy "booking_pages_select_member" on public.booking_pages
  for select to authenticated using (org_id in (select public.user_orgs()));
-- no insert/update/delete policies on purpose: writes go through the RPCs below.

-- ---------- Grants (explicit; anon gets nothing — the public page reads via service_role)
revoke all on table public.booking_pages from public, anon, authenticated, service_role;
grant select on table public.booking_pages to authenticated;
grant select, insert, update, delete on table public.booking_pages to service_role;

-- ---------- Save draft. Cheap structural checks only: size cap, version,
-- exactly one booking section. Full shape validation is zod in the server
-- action, and the public renderer safeParses regardless.
create or replace function public.save_booking_page_draft(
  p_org_id uuid,
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
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' then raise exception 'not found'; end if;
  if pg_column_size(p_doc) > 65536 then raise exception 'too large'; end if;
  if p_doc->>'version' is distinct from '1' then raise exception 'not found'; end if;
  if jsonb_typeof(p_doc->'sections') <> 'array' then raise exception 'not found'; end if;
  if (select count(*) from jsonb_array_elements(p_doc->'sections') s where s->>'type' = 'booking') <> 1 then
    raise exception 'not found';
  end if;

  insert into public.booking_pages (org_id, draft, updated_at)
    values (p_org_id, p_doc, now())
    on conflict (org_id) do update set draft = excluded.draft, updated_at = now();
end;
$$;

revoke all on function public.save_booking_page_draft(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_booking_page_draft(uuid, jsonb) to authenticated;

-- ---------- Publish: the draft becomes the live page. The action always
-- saves first, so a missing row here is a genuine error.
create or replace function public.publish_booking_page(
  p_org_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then
    raise exception 'not found';
  end if;
  update public.booking_pages
    set published = draft, published_at = now(), updated_at = now()
    where org_id = p_org_id;
  if not found then raise exception 'not found'; end if;
end;
$$;

revoke all on function public.publish_booking_page(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.publish_booking_page(uuid) to authenticated;

-- ---------- Discard: draft goes back to the published page, or to the
-- caller-supplied default composition when never published. No row = nothing
-- to discard (not an error: the studio may never have autosaved).
create or replace function public.discard_booking_page_draft(
  p_org_id uuid,
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
  if p_fallback is null or jsonb_typeof(p_fallback) <> 'object' then raise exception 'not found'; end if;
  update public.booking_pages
    set draft = coalesce(published, p_fallback), updated_at = now()
    where org_id = p_org_id;
end;
$$;

revoke all on function public.discard_booking_page_draft(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.discard_booking_page_draft(uuid, jsonb) to authenticated;

-- PostgREST caches the schema; the new table/RPCs must be visible immediately.
notify pgrst, 'reload schema';
