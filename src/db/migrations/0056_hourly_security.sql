-- 0056: hourly mode security surface (H2). Idiom: 0037/0038/0041.
-- Appended across plan Tasks 2 and 3 (0041 precedent).

-- ---------- rental_offerings: mode + per-mode field CHECKs
alter table public.rental_offerings drop constraint rental_offerings_range_mode;
alter table public.rental_offerings
  add constraint rental_offerings_range_mode check (range_mode in ('nights', 'days', 'hours'));

-- Duration trio present iff hours; multiples of the increment; max >= min.
alter table public.rental_offerings add constraint rental_offerings_hours_fields check (
  case when range_mode = 'hours' then
    slot_increment_min is not null and min_duration_min is not null and max_duration_min is not null
    and slot_increment_min between 5 and 240
    and min_duration_min between 5 and 1440
    and max_duration_min between min_duration_min and 1440
    and min_duration_min % slot_increment_min = 0
    and max_duration_min % slot_increment_min = 0
    and turnover_min between 0 and 1440
    and min_notice_min between 0 and 43200
  else
    slot_increment_min is null and min_duration_min is null and max_duration_min is null
  end
);

-- Check-in/out times belong to nights/days only; hours reads opening hours
-- from availability_rules. (0037's *_fmt CHECKs allow NULL already — verify:
-- they are `check (start_time ~ ...)`, which is NULL-passing in SQL.)
-- nights/days keep the pre-0055 column-level NOT NULL as a same-shape CHECK:
-- both times must be set (not just "not both null" — an equality on the two
-- booleans would accept exactly-one-set, which is not a valid window).
alter table public.rental_offerings add constraint rental_offerings_times_by_mode check (
  case when range_mode = 'hours'
       then start_time is null and end_time is null
       else start_time is not null and end_time is not null
  end
);

-- ---------- availability owner: staff XOR rental offering (bookings_kind idiom)
alter table public.availability_rules alter column staff_id drop not null;
alter table public.availability_exceptions alter column staff_id drop not null;
alter table public.availability_rules add constraint availability_rules_owner
  check ((staff_id is not null) <> (rental_offering_id is not null));
alter table public.availability_exceptions add constraint availability_exceptions_owner
  check ((staff_id is not null) <> (rental_offering_id is not null));

-- ---------- EXCLUDE twins: the 0041 staff-keyed guards never fire when
-- staff_id is NULL, so offering rows need their own (same hm_to_min shape).
alter table public.availability_rules add constraint availability_rules_offering_no_overlap
  exclude using gist (rental_offering_id with =, weekday with =,
    int4range(public.hm_to_min(start_time), public.hm_to_min(end_time)) with &&)
  where (rental_offering_id is not null);
alter table public.availability_exceptions add constraint availability_exceptions_offering_no_overlap
  exclude using gist (rental_offering_id with =, date with =,
    int4range(public.hm_to_min(start_time), public.hm_to_min(end_time)) with &&)
  where (not closed and rental_offering_id is not null);

-- ---------- org-consistency trigger (check_staff_owner_org idiom)
create or replace function public.check_offering_owner_org()
returns trigger language plpgsql set search_path = '' as $$
declare v_org uuid;
begin
  if new.rental_offering_id is null then return new; end if;
  select org_id into v_org from public.rental_offerings where id = new.rental_offering_id;
  if v_org is null then raise exception 'offering not found'; end if;
  if v_org <> new.org_id then raise exception 'org mismatch'; end if;
  return new;
end; $$;
create trigger availability_rules_offering_guard
  before insert or update of org_id, rental_offering_id on public.availability_rules
  for each row execute function public.check_offering_owner_org();
create trigger availability_exceptions_offering_guard
  before insert or update of org_id, rental_offering_id on public.availability_exceptions
  for each row execute function public.check_offering_owner_org();
