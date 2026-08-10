-- Custom SQL migration file, put your code below! --

-- Photo response guard (fix wave on the photo-evidence branch):
--   clear_participant_response (0015) already refuses to delete a
--   photo-type response row — "a scalar path must not delete a response
--   that anchors evidence." The authenticated staff equivalent never got
--   that guard: clearResponse (features/programs/actions.ts) DELETEs
--   unit_stage_responses directly, clearResponseInput carries no type
--   discriminant, and 0011 leaves `authenticated` holding table-level
--   DELETE there (unit_stage_responses is member-writable VALUES ONLY,
--   but delete is table-level, not column-scoped). Worse, a raw PostgREST
--   DELETE with a staff session reaches the exact same undefended path,
--   bypassing any TS-level check entirely — this codebase's stated
--   posture is that SQL is the authority, so the guard belongs here.
--
--   Failure this closes: deleting a photo anchor sets evidence.response_id
--   to NULL (the FK is ON DELETE SET NULL, by design — evidence outlives
--   its response as the audit trail), permanently detaching every photo
--   from both read models. There is no re-link path, so this is
--   irreversible even for a stage that was already 'done'.
--
--   Gate: auth.uid() is not null. Every legitimate deleter of a photo
--   anchor is delete_photo_evidence (0015) — the only place a photo
--   anchor is ever meant to die, on the last photo out — which runs
--   SECURITY DEFINER but is reached ONLY via the anon-callable RPC path,
--   where auth.uid() is null. This is the exact distinction 0013's
--   attribution-symmetry trigger (prepare_unit_stage_response) already
--   relies on: "staff writes (auth.uid() present) claim user attribution
--   ... token-path writes (auth.uid() null under anon, via the SECURITY
--   DEFINER RPCs above) keep the RPC-supplied participant id" — and the
--   same test 0011's create_program uses to detect a live staff session
--   ("if auth.uid() is null then raise exception 'not authenticated'").
--   auth.uid() reads the caller's JWT claims, not the executing role, so
--   SECURITY DEFINER does not change it: a staff session (via the
--   exported clearResponse action, or a raw PostgREST DELETE reusing the
--   same session cookie) always carries a non-null auth.uid(), and the
--   anon token flow never does.
create or replace function public.check_photo_response_not_staff_deletable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.type = 'photo' and auth.uid() is not null then
    raise exception 'not found';
  end if;
  return old;
end;
$$;

create trigger unit_stage_responses_guard_photo_delete
before delete on public.unit_stage_responses
for each row execute function public.check_photo_response_not_staff_deletable();