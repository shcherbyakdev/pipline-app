-- 0069 (i18n Wave 1, spec 2026-09-02 §8): the org locale — the language the
-- org's clients see on the hosted page, the embed, the manage page and in
-- every email the org sends. Format-only CHECK so a third language is an
-- app-side change (LOCALES), never a migration. Written ONLY via
-- update_org_scheduling (now five arguments); create_org_with_page seeds it
-- from the creator's interface locale. orgs stays select-only (0004).
ALTER TABLE "orgs" ADD COLUMN "locale" text DEFAULT 'en' NOT NULL;
alter table public.orgs
  add constraint orgs_locale_format check (locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$');

-- ---------- update_org_scheduling (0058 body) + p_locale. Defaulted to null
-- = "keep the current value", so the four-argument callers (the integration
-- fixtures) keep working; the signature still changes, hence drop + create.
drop function public.update_org_scheduling(uuid, text, text, text);
create function public.update_org_scheduling(
  p_org_id uuid,
  p_handle text,
  p_timezone text,
  p_currency text,
  p_locale text default null
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
  if p_currency is null or p_currency not in ('PLN','EUR','USD','GBP','CZK') then
    raise exception 'invalid currency';
  end if;
  if p_locale is not null and p_locale !~ '^[a-z]{2,3}(-[A-Z]{2})?$' then
    raise exception 'invalid locale';
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
    set handle = p_handle, timezone = p_timezone, currency = p_currency,
        locale = coalesce(p_locale, locale)
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
revoke all on function public.update_org_scheduling(uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.update_org_scheduling(uuid, text, text, text, text) to authenticated;

-- ---------- create_org_with_page (0054 body) + p_locale, validated the same
-- way and written in the same update as handle and timezone.
drop function if exists public.create_org_with_page(text, text, text, boolean, boolean);
create or replace function public.create_org_with_page(
  p_name text,
  p_handle text,
  p_timezone text,
  p_offers_appointments boolean default true,
  p_offers_rentals boolean default true,
  p_locale text default 'en'
)
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
  if p_locale is null or p_locale !~ '^[a-z]{2,3}(-[A-Z]{2})?$' then
    raise exception 'invalid locale';
  end if;
  if p_handle is not null and exists (select 1 from public.org_handle_history h where h.handle = p_handle) then
    raise exception 'handle taken' using errcode = 'unique_violation';
  end if;
  v_org := public.create_org(p_name, p_offers_appointments, p_offers_rentals);
  update public.orgs
    set handle = p_handle, timezone = p_timezone, locale = p_locale
    where id = v_org.id
    returning * into v_org;
  return v_org;
end;
$$;
revoke all on function public.create_org_with_page(text, text, text, boolean, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_org_with_page(text, text, text, boolean, boolean, text) to authenticated;

-- Two signatures changed; PostgREST must re-read its schema cache.
notify pgrst, 'reload schema';
