-- Booking page: one booking widget, or one per channel (appointments +
-- spaces), so an org can decide what its page books and where. The app-side
-- schema (pageDocumentSchema) carries the full rule — two only as one per
-- channel, at least one visible; SQL keeps the hard cap 0048 had so a bad
-- client can never store a page with no widget or a pile of them.
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
  if (select count(*) from jsonb_array_elements(p_doc->'sections') s where s->>'type' = 'booking') not between 1 and 2 then
    raise exception 'not found';
  end if;

  insert into public.booking_pages (org_id, draft, updated_at)
    values (p_org_id, p_doc, now())
    on conflict (org_id) do update set draft = excluded.draft, updated_at = now();
end;
$$;
