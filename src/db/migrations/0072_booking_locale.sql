-- 0072 (i18n, spec 2026-09-02 §4 amended 2026-09-03): the language the
-- CLIENT booked in. Until now every mail an org sends followed orgs.locale
-- (D4) — right while the visitor had no say, wrong the moment they do: a
-- client who switches a Ukrainian page to English still got Ukrainian mail.
--
-- NULL means "the org's language", so every existing row, every walk-in and
-- every admin-made booking keeps behaving exactly as it does today. No
-- backfill, no default: an absent locale is not a wrong one.
--
-- Written by the public create actions right after their RPC returns, as
-- service_role (already granted UPDATE on bookings in 0026). Deliberately
-- NOT an argument to create_booking / create_rental_booking(_hours): those
-- three bodies run to ~600 lines between them and a pass-through column is
-- not worth re-issuing them, with the staleness hazard that copying carries.
-- The column is not in bookings_org_guard's UPDATE OF list (0041), so a
-- locale-only write does not fire it.
--
-- Format-only CHECK, matching orgs_locale_format (0069): adding a third
-- language stays an app-side change to LOCALES, never a migration.
alter table public.bookings add column locale text;
alter table public.bookings
  add constraint bookings_locale_format check (locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$');

-- A reschedule writes a NEW row (rescheduled_from_id → the old one) with an
-- explicit column list, in six functions across 0058/0062/0070. Rather than
-- re-issue all six to add one pass-through, the rule lives once, here: an
-- insert that descends from another booking and names no language of its own
-- inherits the parent's. Covers appointments and stays, hourly and nightly,
-- client-initiated and admin-initiated, and any reschedule path added later.
-- Invoker rights, like every other guard on this table (check_booking_org
-- idiom, 0041) — the callers are all SECURITY DEFINER already.
create or replace function public.carry_booking_locale()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.locale is null and new.rescheduled_from_id is not null then
    select b.locale into new.locale from public.bookings b where b.id = new.rescheduled_from_id;
  end if;
  return new;
end; $$;
drop trigger if exists bookings_locale_carry on public.bookings;
create trigger bookings_locale_carry
  before insert on public.bookings
  for each row execute function public.carry_booking_locale();
