-- Custom SQL migration file, put your code below! --

-- Photo response guard (fix wave, cascade-safe revision):
--   The original 0016 closed the staff-delete hole on the photo anchor row
--   (0015's evidence.response_id, ON DELETE SET NULL) with a BEFORE DELETE
--   trigger gated on `auth.uid() is not null`. That trigger fires on every
--   row delete of unit_stage_responses — INCLUDING rows Postgres deletes
--   itself via an ON DELETE CASCADE (deleteUnit -> units cascades to
--   unit_stages -> unit_stage_responses). RI cascades switch current_user
--   to the table owner, but auth.uid() reads the request.jwt.claims session
--   GUC, not current_user, so it stayed non-null for the whole staff
--   request, cascade included — the trigger could not tell a direct staff
--   DELETE from an RI cascade and blocked BOTH. That broke
--   deleteUnit()/deleteProgram() outright for any unit/program holding
--   photo evidence (empirically probed against a local DB: staff-session
--   cascades on unit/program/program_stage/requirement/org all raised
--   P0001; only the auth.uid()-null anon path succeeded).
--
--   This revision drops the trigger for table privileges plus a SECURITY
--   DEFINER RPC: table privileges do NOT gate RI cascade actions (those run
--   as the table owner, who always retains privilege on what it owns), so
--   cascades keep working, while a direct staff DELETE — via the exported
--   clearResponse action, or a raw PostgREST DELETE reusing the same
--   session cookie — has nothing left to call: `authenticated` no longer
--   holds DELETE on unit_stage_responses at all, and the one sanctioned
--   clear path (clear_unit_stage_response, below) explicitly refuses
--   photo-type rows.

-- ---------- 1. Close the direct-DELETE path entirely.
-- Table-level privilege revokes do NOT gate RI cascade deletes (see above):
-- deleteUnit()/deleteProgram() keep cascading unit_stage_responses rows
-- away exactly as before this revoke. Only a direct staff-session DELETE —
-- the thing that actually orphaned photo evidence — dies here.
revoke delete on public.unit_stage_responses from authenticated;

-- ---------- 2. The sole sanctioned clear path for staff.
-- SECURITY DEFINER so it can locate the row without a client-visible SELECT
-- grant change; the definer body bypasses RLS entirely, so it re-implements
-- the org check RLS would otherwise have provided.
create or replace function public.clear_unit_stage_response(
  p_unit_stage_id uuid, p_requirement_id uuid
)
returns table(program_id uuid, unit_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resp public.unit_stage_responses;
begin
  if auth.uid() is null then
    raise exception 'not found';
  end if;

  select r.* into v_resp
    from public.unit_stage_responses r
   where r.unit_stage_id = p_unit_stage_id
     and r.program_stage_requirement_id = p_requirement_id;

  -- No matching response: idempotent no-op success, same as the direct
  -- DELETE this replaces (0 rows affected, no error) — matches
  -- clearResponse's documented "clearing an absent response is a no-op".
  if v_resp.id is null then
    return;
  end if;

  -- The ONLY thing standing between a member and any OTHER org's response:
  -- this function runs as the table owner and bypasses RLS entirely, so
  -- without this check any authenticated caller could clear any org's
  -- answer by guessing/enumerating a (unit_stage_id, requirement_id) pair.
  if v_resp.org_id not in (select public.user_orgs()) then
    raise exception 'not found';
  end if;

  -- Photo responses anchor evidence rows; they die only via
  -- delete_photo_evidence (0015, last photo out), never via clear — the
  -- same rule clear_participant_response (0015) already enforces on the
  -- anon/participant path.
  if v_resp.type = 'photo' then
    raise exception 'not found';
  end if;

  delete from public.unit_stage_responses where id = v_resp.id;
  return query select v_resp.program_id, v_resp.unit_id;
end;
$$;

-- House lockdown idiom: revoke from every role, then grant back only to the
-- one legitimate caller. Staff-only — the participant/anon path has its own
-- RPC (clear_participant_response, 0015).
revoke all on function public.clear_unit_stage_response(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.clear_unit_stage_response(uuid, uuid) to authenticated;
