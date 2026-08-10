-- Custom SQL migration file, put your code below! --

-- Photo evidence security model (slice 8):
--   * evidence: metadata only — the row is the compliance record. Member
--     SELECT via org; NO client writes on either API role. Rows are written
--     ONLY inside the definer RPCs below; service_role gets select for the
--     token-scoped flow reads (lib/tokens).
--   * Bucket `evidence` is private with ZERO storage policies: every object
--     read/write goes through the server-only service-role client.
--   * record/delete_photo_evidence are anon-callable, token-keyed (the 0013
--     discipline). The path-prefix check pins a caller inside its own
--     org/program/unit folder — without it a valid token could point `path`
--     at another org's object and have its console sign a foreign URL.
--   * unit_stage_responses: type/one-value CHECKs relaxed so type='photo'
--     with all-null values is the (only) valid all-null shape — the wiring
--     0011 explicitly deferred to slice 8.
--   * derive_unit_stage: photo joins the derivation; satisfied := response
--     row exists AND >=1 evidence row via response_id. A new AFTER trigger
--     on evidence re-derives (insert/delete only — evidence is immutable).

-- ---------- Bucket (private; caps enforced at the storage floor too)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 15728640,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do nothing;

-- ---------- CHECKs
alter table public.evidence
  add constraint evidence_provider_check check (provider in ('supabase'));

alter table public.unit_stage_responses
  drop constraint unit_stage_responses_type_check;
alter table public.unit_stage_responses
  add constraint unit_stage_responses_type_check
  check (type in ('text','number','boolean','date','choice','photo'));

alter table public.unit_stage_responses
  drop constraint unit_stage_responses_one_value_check;
alter table public.unit_stage_responses
  add constraint unit_stage_responses_one_value_check
  check (
    (type in ('text','choice') and value_text is not null and value_text <> ''
      and value_number is null and value_bool is null and value_date is null)
    or (type = 'number' and value_number is not null
      and value_text is null and value_bool is null and value_date is null)
    or (type = 'boolean' and value_bool is not null
      and value_text is null and value_number is null and value_date is null)
    or (type = 'date' and value_date is not null
      and value_text is null and value_number is null and value_bool is null)
    -- photo: the response row is the "answered" anchor; the VALUES live in
    -- the evidence table. The only legal all-null shape.
    or (type = 'photo' and value_text is null and value_number is null
      and value_bool is null and value_date is null)
  );

-- ---------- RLS & grants
alter table public.evidence enable row level security;

create policy "evidence_select_member" on public.evidence
  for select to authenticated using (org_id in (select public.user_orgs()));

-- Revoke-then-grant (the 0011 unit_stage_responses idiom): local dev images
-- retain a default ACL handing `authenticated` blanket privileges on every
-- table postgres creates, and CI strips it. Without the revoke, "members
-- cannot delete evidence" is environment-dependent — RLS with no DELETE
-- policy silently filters rows and returns SUCCESS with 0 deleted, rather
-- than refusing. Evidence is written ONLY by the definer RPCs below, so
-- both API roles keep select and nothing else. TRUNCATE is included: it is
-- not RLS-governed at all (the 0013 access_tokens lesson).
revoke insert, update, delete, truncate on table public.evidence from authenticated;
revoke insert, update, delete, truncate on table public.evidence from service_role;
grant select on table public.evidence to authenticated;
-- lib/tokens reads evidence for the participant flow via the admin client.
grant select on table public.evidence to service_role;
-- (0013's default-privileges revoke already keeps anon at zero here.)

-- ---------- derivation learns photo
-- Recreated VERBATIM from 0011 minus the photo exclusion: photo now counts,
-- and is satisfied when its response row has >=1 linked evidence row.
create or replace function public.derive_unit_stage(p_unit_stage_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_required int;
  v_satisfied int;
  v_done boolean;
begin
  select count(*) filter (where r.required),
         count(*) filter (where r.required and resp.id is not null
                            and (r.type <> 'boolean' or resp.value_bool)
                            and (r.type <> 'photo' or exists (
                              select 1 from public.evidence e
                               where e.response_id = resp.id)))
    into v_required, v_satisfied
    from public.unit_stages us
    join public.program_stage_requirements r on r.program_stage_id = us.program_stage_id
    left join public.unit_stage_responses resp
      on resp.program_stage_requirement_id = r.id and resp.unit_stage_id = us.id
   where us.id = p_unit_stage_id;

  if v_required is null or v_required = 0 then
    return; -- no required requirements: manual stage, leave it alone
  end if;

  v_done := v_satisfied = v_required;
  update public.unit_stages
     set status = case when v_done then 'done' else 'pending' end,
         done_source = case when v_done then 'requirements' else null end
   where id = p_unit_stage_id
     and (status is distinct from case when v_done then 'done' else 'pending' end
          or done_source is distinct from case when v_done then 'requirements' else null end);
end;
$$;

-- Same lockdown as 0011: definer + exposed schema would otherwise be a free
-- anon-key write to any unit_stage. Trigger-owner calls are unaffected.
revoke execute on function public.derive_unit_stage(uuid) from public, anon, authenticated, service_role;

-- ---------- evidence re-derives its stage (insert/delete; rows immutable)
create or replace function public.derive_unit_stage_from_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.derive_unit_stage(coalesce(new.unit_stage_id, old.unit_stage_id));
  return coalesce(new, old);
end;
$$;

create trigger evidence_derive
after insert or delete on public.evidence
for each row execute function public.derive_unit_stage_from_evidence();

-- ---------- record: token-keyed evidence write (anon-callable)
create or replace function public.record_photo_evidence(
  p_token text, p_unit_id uuid, p_requirement_id uuid,
  p_path text, p_filename text, p_mime text,
  p_size_bytes bigint, p_checksum_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit_stage_id uuid;
  v_participant_id uuid;
  v_type text;
  v_us record;
  v_prefix text;
  v_response_id uuid;
  v_evidence_id uuid;
begin
  select o_unit_stage_id, o_participant_id, o_type
    into v_unit_stage_id, v_participant_id, v_type
    from public.participant_scope_unit_stage(p_token, p_unit_id, p_requirement_id);
  if v_type <> 'photo' then
    raise exception 'not found';
  end if;

  -- Photos mirror "editable until done": a done stage locks its evidence.
  select us.org_id, us.program_id, us.status into v_us
    from public.unit_stages us where us.id = v_unit_stage_id;
  if v_us.status is distinct from 'pending' then
    raise exception 'not found';
  end if;

  -- Anon-facing metadata caps (the submit_participant_response precedent):
  -- uniform 'not found', no diagnostic detail. The storage bucket enforces
  -- size/mime on the bytes; these caps keep the METADATA row honest too.
  if p_filename is null or char_length(p_filename) < 1 or char_length(p_filename) > 200
     or p_mime not in ('image/jpeg','image/png','image/webp','image/heic','image/heif')
     or p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 15728640
     or p_checksum_sha256 is null or p_checksum_sha256 !~ '^[0-9a-f]{64}$'
     or p_path is null or char_length(p_path) > 300 then
    raise exception 'not found';
  end if;

  -- THE cross-tenant lock: the prefix comes from the RESOLVED scope, never
  -- the caller. A direct PostgREST caller can only write inside its own
  -- unit's folder; worst case it fabricates a row pointing at a nonexistent
  -- object there — its own garbage, nobody else's photo.
  v_prefix := v_us.org_id::text || '/' || v_us.program_id::text || '/' || p_unit_id::text || '/';
  if left(p_path, char_length(v_prefix)) is distinct from v_prefix then
    raise exception 'not found';
  end if;

  -- The all-null photo response is the "answered" anchor (one per
  -- unit_stage × requirement). The 0011 prepare trigger fills type/denorms;
  -- the relaxed one-value CHECK admits the photo shape.
  insert into public.unit_stage_responses
    (unit_stage_id, program_stage_requirement_id, answered_by_participant_id)
  values (v_unit_stage_id, p_requirement_id, v_participant_id)
  on conflict (unit_stage_id, program_stage_requirement_id) do update
    set answered_by_participant_id = excluded.answered_by_participant_id
  returning id into v_response_id;

  insert into public.evidence
    (org_id, unit_id, unit_stage_id, response_id, provider, path, filename,
     mime, size_bytes, checksum_sha256, uploaded_by_participant_id)
  values
    (v_us.org_id, p_unit_id, v_unit_stage_id, v_response_id, 'supabase',
     p_path, p_filename, p_mime, p_size_bytes, p_checksum_sha256, v_participant_id)
  returning id into v_evidence_id;

  return v_evidence_id;
end;
$$;

revoke all on function public.record_photo_evidence(text, uuid, uuid, text, text, text, bigint, text) from public, anon, authenticated, service_role;
grant execute on function public.record_photo_evidence(text, uuid, uuid, text, text, text, bigint, text) to anon;

-- ---------- delete: pending-only, returns the path for object cleanup
create or replace function public.delete_photo_evidence(p_token text, p_evidence_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope record;
  v_ev public.evidence;
begin
  select * into v_scope from public.resolve_participant_token(p_token);
  if v_scope.status is null or v_scope.status <> 'ok' then
    raise exception 'not found';
  end if;
  -- Scope is LIVE (assignment now), stage must still be pending.
  select e.* into v_ev
    from public.evidence e
    join public.units u on u.id = e.unit_id
    join public.unit_stages us on us.id = e.unit_stage_id
   where e.id = p_evidence_id
     and e.org_id = v_scope.org_id
     and u.program_id = v_scope.program_id
     and u.assigned_participant_id = v_scope.participant_id
     and (v_scope.unit_id is null or u.id = v_scope.unit_id)
     and us.status = 'pending';
  if v_ev.id is null then
    raise exception 'not found';
  end if;

  delete from public.evidence where id = v_ev.id;
  -- Last photo out deletes the anchor: the requirement reads "unanswered"
  -- again and no ghost attribution survives.
  if v_ev.response_id is not null and not exists (
      select 1 from public.evidence e2 where e2.response_id = v_ev.response_id) then
    delete from public.unit_stage_responses where id = v_ev.response_id;
  end if;
  return v_ev.path;
end;
$$;

revoke all on function public.delete_photo_evidence(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_photo_evidence(text, uuid) to anon;

-- ---------- photo guards on the slice-7 RPCs
-- Photos have their own lifecycle (the RPCs above); the scalar write/clear
-- paths must not create a value-bearing photo row or delete a response that
-- anchors evidence. Both recreated VERBATIM from 0013 plus the guard.
create or replace function public.submit_participant_response(
  p_token text, p_unit_id uuid, p_requirement_id uuid,
  p_value_text text, p_value_number numeric, p_value_bool boolean, p_value_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit_stage_id uuid;
  v_participant_id uuid;
  v_type text;
begin
  select o_unit_stage_id, o_participant_id, o_type
    into v_unit_stage_id, v_participant_id, v_type
    from public.participant_scope_unit_stage(p_token, p_unit_id, p_requirement_id);

  -- Photo requirements are answered via record_photo_evidence, never here.
  if v_type = 'photo' then
    raise exception 'not found';
  end if;

  -- Anon-facing write: cap text length before it reaches the table (matches
  -- the Zod cap on the authenticated staff path). Uniform 'not found' per
  -- the 404 discipline used throughout this migration — an oversized
  -- payload gets no more diagnostic detail than a bad token or a
  -- stale scope. char_length(null) is null, so this is a no-op for the
  -- non-text requirement types.
  if char_length(p_value_text) > 2000 then
    raise exception 'not found';
  end if;

  -- Type-aware validation for 'choice'. The one-value CHECK (0011) proves a
  -- choice answer is a non-empty string; it cannot know the option list, so
  -- without this an anon caller could store arbitrary prose in a dropdown
  -- field. Mirrors the client-side Zod contract: max 120 chars, and the value
  -- must be one of config->'options'. A null p_value_text fails the
  -- membership test (null ? null is null → no row), so this fails closed.
  if v_type = 'choice' then
    if char_length(p_value_text) > 120 then
      raise exception 'not found';
    end if;
    perform 1
      from public.program_stage_requirements r
     where r.id = p_requirement_id
       and (r.config -> 'options') ? p_value_text;
    if not found then
      raise exception 'not found';
    end if;
  end if;

  insert into public.unit_stage_responses
    (unit_stage_id, program_stage_requirement_id,
     value_text, value_number, value_bool, value_date, answered_by_participant_id)
  values
    (v_unit_stage_id, p_requirement_id,
     p_value_text, p_value_number, p_value_bool, p_value_date, v_participant_id)
  on conflict (unit_stage_id, program_stage_requirement_id) do update
    set value_text = excluded.value_text,
        value_number = excluded.value_number,
        value_bool = excluded.value_bool,
        value_date = excluded.value_date,
        answered_by_participant_id = excluded.answered_by_participant_id;
  -- The prepare trigger derives type/denorms (unit_id/program_id/org_id/
  -- type) from the parent rows; it does not validate the value columns.
  -- unit_stage_responses_one_value_check (0011, relaxed above) is what
  -- actually enforces a single, correctly-typed, non-empty value — a null,
  -- wrong-type, or empty-string submission dies at that CHECK, not here.
  -- The derive trigger then recomputes the stage. All three fire unchanged.
end;
$$;

revoke all on function public.submit_participant_response(text, uuid, uuid, text, numeric, boolean, date) from public, anon, authenticated, service_role;
grant execute on function public.submit_participant_response(text, uuid, uuid, text, numeric, boolean, date) to anon;

create or replace function public.clear_participant_response(
  p_token text, p_unit_id uuid, p_requirement_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit_stage_id uuid;
  v_participant_id uuid;
  v_type text;
begin
  select o_unit_stage_id, o_participant_id, o_type
    into v_unit_stage_id, v_participant_id, v_type
    from public.participant_scope_unit_stage(p_token, p_unit_id, p_requirement_id);
  -- Photo responses anchor evidence rows; they die only via
  -- delete_photo_evidence (last photo out), never via clear.
  if v_type = 'photo' then
    raise exception 'not found';
  end if;
  delete from public.unit_stage_responses
   where unit_stage_id = v_unit_stage_id
     and program_stage_requirement_id = p_requirement_id;
end;
$$;

revoke all on function public.clear_participant_response(text, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.clear_participant_response(text, uuid, uuid) to anon;
