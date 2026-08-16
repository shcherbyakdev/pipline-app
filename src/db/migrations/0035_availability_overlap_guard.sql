-- Custom SQL migration file, put your code below! --

-- 0035: availability overlap guards + member update path.
--
-- 1. hm_to_min: immutable "HH:MM"(text) → minutes. Times are stored as
--    text (0025/0026 decision); text::time casts are only STABLE, so an
--    EXCLUDE expression needs this immutable helper + int4range instead
--    of a time-range type.
-- 2. Pre-merge: union any existing overlapping intervals per (org,
--    weekday) / (org, date, open) — addRange semantics — so the
--    constraints can land on live data.
-- 3. EXCLUDE constraints (btree_gist, enabled in 0026): no overlapping
--    windows per org+weekday (rules) / per org+date among open rows
--    (exceptions). int4range is half-open — touching rows coexist.
-- 4. availability_rules gains the member UPDATE path (column-scoped
--    grant per the 0008 idiom + policy) for in-place interval editing;
--    0026 deliberately granted only select/insert/delete.

create or replace function public.hm_to_min(t text) returns integer
language sql immutable strict
set search_path = ''
as $$
  select substr(t, 1, 2)::int * 60 + substr(t, 4, 2)::int
$$;

do $$
declare
  g record;
  r record;
  cs int;
  ce int;
  started boolean;
begin
  create temporary table _merged (org_id uuid, weekday int, s int, e int) on commit drop;

  for g in
    select distinct a.org_id, a.weekday
    from public.availability_rules a
    join public.availability_rules b
      on a.org_id = b.org_id and a.weekday = b.weekday and a.id <> b.id
     and public.hm_to_min(a.start_time) < public.hm_to_min(b.end_time)
     and public.hm_to_min(b.start_time) < public.hm_to_min(a.end_time)
  loop
    started := false;
    for r in
      select public.hm_to_min(start_time) as s, public.hm_to_min(end_time) as e
      from public.availability_rules
      where org_id = g.org_id and weekday = g.weekday
      order by 1, 2
    loop
      if not started then
        cs := r.s; ce := r.e; started := true;
      elsif r.s <= ce then
        ce := greatest(ce, r.e);
      else
        insert into _merged values (g.org_id, g.weekday, cs, ce);
        cs := r.s; ce := r.e;
      end if;
    end loop;
    if started then insert into _merged values (g.org_id, g.weekday, cs, ce); end if;
    delete from public.availability_rules where org_id = g.org_id and weekday = g.weekday;
  end loop;

  insert into public.availability_rules (org_id, weekday, start_time, end_time)
  select org_id, weekday,
         lpad((s / 60)::text, 2, '0') || ':' || lpad((s % 60)::text, 2, '0'),
         lpad((e / 60)::text, 2, '0') || ':' || lpad((e % 60)::text, 2, '0')
  from _merged;
end $$;

do $$
declare
  g record;
  r record;
  cs int;
  ce int;
  started boolean;
begin
  create temporary table _merged_ex (org_id uuid, date date, s int, e int) on commit drop;

  for g in
    select distinct a.org_id, a.date
    from public.availability_exceptions a
    join public.availability_exceptions b
      on a.org_id = b.org_id and a.date = b.date and a.id <> b.id
     and not a.closed and not b.closed
     and public.hm_to_min(a.start_time) < public.hm_to_min(b.end_time)
     and public.hm_to_min(b.start_time) < public.hm_to_min(a.end_time)
  loop
    started := false;
    for r in
      select public.hm_to_min(start_time) as s, public.hm_to_min(end_time) as e
      from public.availability_exceptions
      where org_id = g.org_id and date = g.date and not closed
      order by 1, 2
    loop
      if not started then
        cs := r.s; ce := r.e; started := true;
      elsif r.s <= ce then
        ce := greatest(ce, r.e);
      else
        insert into _merged_ex values (g.org_id, g.date, cs, ce);
        cs := r.s; ce := r.e;
      end if;
    end loop;
    if started then insert into _merged_ex values (g.org_id, g.date, cs, ce); end if;
    delete from public.availability_exceptions
      where org_id = g.org_id and date = g.date and not closed;
  end loop;

  insert into public.availability_exceptions (org_id, date, closed, start_time, end_time)
  select org_id, date, false,
         lpad((s / 60)::text, 2, '0') || ':' || lpad((s % 60)::text, 2, '0'),
         lpad((e / 60)::text, 2, '0') || ':' || lpad((e % 60)::text, 2, '0')
  from _merged_ex;
end $$;

alter table public.availability_rules
  add constraint availability_rules_no_overlap
  exclude using gist (
    org_id with =,
    weekday with =,
    int4range(public.hm_to_min(start_time), public.hm_to_min(end_time)) with &&
  );

alter table public.availability_exceptions
  add constraint availability_exceptions_no_overlap
  exclude using gist (
    org_id with =,
    date with =,
    int4range(public.hm_to_min(start_time), public.hm_to_min(end_time)) with &&
  ) where (not closed);

grant update (start_time, end_time) on table public.availability_rules to authenticated;

create policy "availability_rules_update_member" on public.availability_rules
  for update to authenticated
  using (org_id in (select public.user_orgs()))
  with check (org_id in (select public.user_orgs()));
