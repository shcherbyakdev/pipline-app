-- H3 prices & terms (part A): CHECKs, money helpers, org currency RPC.
-- Part B (booking RPC money snapshot + cancel window) is appended below in
-- a later task of the same slice.

-- ---------- CHECKs (columns added by 0057)
alter table public.rental_offerings
  add constraint rental_offerings_price_cents_ck
    check (price_cents is null or price_cents >= 0),
  add constraint rental_offerings_pricing_mode_ck
    check (pricing_mode in ('per_unit','flat')),
  add constraint rental_offerings_deposit_type_ck
    check (deposit_type in ('none','fixed','percent','full')),
  add constraint rental_offerings_deposit_value_ck check (
    case deposit_type
      when 'fixed'   then deposit_value is not null and deposit_value >= 0
      when 'percent' then deposit_value between 1 and 100
      else deposit_value is null
    end),
  -- percent/full are fractions of a price; fixed may stand alone
  -- ("free to book, damage deposit at the venue").
  add constraint rental_offerings_deposit_needs_price_ck
    check (deposit_type not in ('percent','full') or price_cents is not null),
  add constraint rental_offerings_cancel_window_ck
    check (cancel_window_min >= 0);

alter table public.orgs
  add constraint orgs_currency_ck
    check (currency in ('PLN','EUR','USD','GBP','CZK'));

alter table public.bookings
  add constraint bookings_money_ck
    check ((price_cents is null or price_cents >= 0)
       and (deposit_cents is null or deposit_cents >= 0));

-- ---------- Money helpers (mirrored by src/features/rentals/pricing.ts —
-- keep the two in lockstep). p_units: nights/days count, or duration/60.
create function public.rental_total_cents(p_mode text, p_price int, p_units numeric)
returns int language sql immutable as $$
  select case when p_price is null then null
              when p_mode = 'flat' then p_price
              else round(p_price * p_units)::int end;
$$;
revoke all on function public.rental_total_cents(text, int, numeric)
  from public, anon, authenticated;

create function public.rental_deposit_cents(p_type text, p_value int, p_total int)
returns int language sql immutable as $$
  select case p_type
           when 'full'    then p_total
           when 'percent' then case when p_total is null then null
                                    else round(p_total * p_value / 100.0)::int end
           when 'fixed'   then case when p_total is null then p_value
                                    else least(p_value, p_total) end
           else null end;
$$;
revoke all on function public.rental_deposit_cents(text, int, int)
  from public, anon, authenticated;

-- ---------- update_org_scheduling: + currency (signature change → drop).
drop function public.update_org_scheduling(uuid, text, text);
create function public.update_org_scheduling(
  p_org_id uuid,
  p_handle text,
  p_timezone text,
  p_currency text
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
  select o.handle into v_old from public.orgs o where o.id = p_org_id for update;
  -- A handle another org once used is theirs for good. Surfaced as 23505 so
  -- the callers' "just taken" mapping covers it.
  if p_handle is not null and exists (
    select 1 from public.org_handle_history h where h.handle = p_handle and h.org_id <> p_org_id
  ) then
    raise exception 'handle taken' using errcode = 'unique_violation';
  end if;
  update public.orgs
    set handle = p_handle, timezone = p_timezone, currency = p_currency
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
revoke all on function public.update_org_scheduling(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.update_org_scheduling(uuid, text, text, text) to authenticated;
