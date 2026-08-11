-- CSV import (slice 5b): one atomic upsert that PostgREST cannot express.
-- PostgREST's ON CONFLICT DO UPDATE sets EVERY payload column; the 0008
-- column-scoped update grant on units (name, external_ref) correctly
-- rejects program_id/org_id in that SET list. This function's DO UPDATE
-- sets only name — a write staff already hold.
--
-- SECURITY INVOKER on purpose: unlike the service-role recurrence RPCs
-- (0022), this runs as the calling member — RLS policies
-- (units_insert_member / units_update_member) and existing grants keep
-- gating every row; the function adds capability, not privilege.
create or replace function public.import_units(p_program_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_total int;
  v_inserted int;
  v_updated int;
begin
  -- RLS-filtered lookup: a foreign program is simply invisible.
  select org_id into v_org_id from public.programs where id = p_program_id;
  if v_org_id is null then
    raise exception 'program not found';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a jsonb array';
  end if;
  v_total := jsonb_array_length(p_rows);
  if v_total < 1 or v_total > 2000 then
    raise exception 'rows must contain between 1 and 2000 items';
  end if;

  with rows as (
    select
      trim(r->>'name') as name,
      trim(r->>'external_ref') as external_ref
    from jsonb_array_elements(p_rows) as r
  ), valid as (
    select name, external_ref
    from rows
    where length(name) between 1 and 120
      and length(external_ref) between 1 and 120
  ), up as (
    insert into public.units (program_id, org_id, name, external_ref)
    select p_program_id, v_org_id, name, external_ref
    from valid
    on conflict (program_id, external_ref) do update
      set name = excluded.name
    returning (xmax = 0) as inserted
  )
  select
    count(*) filter (where inserted),
    count(*) filter (where not inserted)
  into v_inserted, v_updated
  from up;

  -- All-or-nothing: rows filtered out by `valid` mean the file was bad;
  -- raising here rolls back the rows that did land.
  if v_inserted + v_updated <> v_total then
    raise exception 'invalid rows: names and external_refs must be 1-120 characters';
  end if;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
end;
$$;

-- 0022 idiom: strip the world, grant the one intended caller.
revoke execute on function public.import_units(uuid, jsonb) from public, anon;
grant execute on function public.import_units(uuid, jsonb) to authenticated;
