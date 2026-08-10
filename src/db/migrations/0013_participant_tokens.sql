-- Custom SQL migration file, put your code below! --

-- Participant links security model (slice 7):
--   * participants: ordinary member-writable rows (templates pattern).
--   * access_tokens: member select/insert; the ONLY member mutation is
--     revoke (column-scoped update on revoked_at). token_hash is sha256 —
--     a leaked database leaks no usable links. Guard trigger closes the
--     cross-org mint hole (RLS only proves the MINTER's membership; the
--     FKs point anywhere).
--   * The security boundary for /p is 256-bit token ENTROPY. The RPCs are
--     deliberately anon-callable: the DB trusts the token, not the caller.
--   * resolve_participant_token is the ONLY validity logic in the system.

-- ---------- FKs deferred from 0012 (module-cycle constraint in schema TS)
alter table public.units
  add constraint units_assigned_participant_id_participants_id_fk
  foreign key (assigned_participant_id) references public.participants(id)
  on delete set null;
alter table public.unit_stage_responses
  add constraint unit_stage_responses_answered_by_participant_id_fk
  foreign key (answered_by_participant_id) references public.participants(id)
  on delete set null;
-- Index-every-FK convention (0012 review carry-forward): the FK above had
-- no covering index, unlike its sibling answered_by_user_id.
create index unit_stage_responses_answered_by_participant_id_idx
  on public.unit_stage_responses (answered_by_participant_id);

-- ---------- CHECKs
alter table public.access_tokens
  add constraint access_tokens_kind_check check (kind in ('participant','portal'));
alter table public.access_tokens
  add constraint access_tokens_participant_scope_check
  check (kind <> 'participant' or (participant_id is not null and program_id is not null));

-- ---------- RLS
alter table public.participants enable row level security;
alter table public.access_tokens enable row level security;

create policy "participants_select_member" on public.participants
  for select to authenticated using (org_id in (select public.user_orgs()));
create policy "participants_insert_member" on public.participants
  for insert to authenticated with check (org_id in (select public.user_orgs()));
create policy "participants_update_member" on public.participants
  for update to authenticated
  using (org_id in (select public.user_orgs()))
  with check (org_id in (select public.user_orgs()));
create policy "participants_delete_member" on public.participants
  for delete to authenticated using (org_id in (select public.user_orgs()));

create policy "access_tokens_select_member" on public.access_tokens
  for select to authenticated using (org_id in (select public.user_orgs()));
create policy "access_tokens_insert_member" on public.access_tokens
  for insert to authenticated with check (org_id in (select public.user_orgs()));
create policy "access_tokens_update_member" on public.access_tokens
  for update to authenticated
  using (org_id in (select public.user_orgs()))
  with check (org_id in (select public.user_orgs()));
-- no delete policy: token history is the audit trail.

-- ---------- Grants (0004 convention; blanket-ACL revokes per the 0011 lesson)
revoke insert, update, delete on table public.participants from authenticated;
grant select, insert, update, delete on table public.participants to authenticated;
grant select, insert, update, delete on table public.participants to service_role;

revoke insert, update, delete on table public.access_tokens from authenticated;
grant select, insert on table public.access_tokens to authenticated;
grant update (revoked_at) on table public.access_tokens to authenticated;
grant select on table public.access_tokens to service_role;

-- units: additive column grant for assignment (0008 scoped it to name/external_ref)
grant update (assigned_participant_id) on table public.units to authenticated;

-- ---------- Hardening: anon has zero table access (security review I1).
-- Local dev images retain a default ACL (ALTER DEFAULT PRIVILEGES for role
-- postgres, schema public — the same one called out in 0011) that hands
-- PUBLIC/anon a blanket arwdDxtm on every table postgres creates: SELECT,
-- INSERT, UPDATE, DELETE, TRUNCATE (TRUNCATE is not RLS-governed at all).
-- Slice 7 is the first time anon becomes a live PostgREST caller, so this
-- was always latent but never live until now. anon's only legitimate
-- access is EXECUTE on the three SECURITY DEFINER RPCs below; it needs
-- (and after this line, has) no direct table privilege whatsoever. This
-- revoke is table-privilege-only — schema USAGE and the function EXECUTE
-- grants elsewhere in this file are untouched.
revoke all on all tables in schema public from anon;

-- ---------- Guard: token scope must be internally consistent with its org.
-- SECURITY INVOKER: foreign rows are RLS-invisible, so they read as
-- 'not found' rather than leaking existence (check_template_stage_org
-- precedent).
create or replace function public.check_access_token_org()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
  v_unit record;
begin
  if new.kind = 'participant' then
    select org_id into v_org from public.participants where id = new.participant_id;
    if v_org is null then raise exception 'participant not found'; end if;
    if v_org <> new.org_id then raise exception 'org mismatch'; end if;

    select org_id into v_org from public.programs where id = new.program_id;
    if v_org is null then raise exception 'program not found'; end if;
    if v_org <> new.org_id then raise exception 'org mismatch'; end if;

    if new.unit_id is not null then
      select org_id, program_id into v_unit from public.units where id = new.unit_id;
      if v_unit.org_id is null then raise exception 'unit not found'; end if;
      if v_unit.org_id <> new.org_id or v_unit.program_id <> new.program_id then
        raise exception 'org mismatch';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger access_tokens_check_org
before insert or update on public.access_tokens
for each row execute function public.check_access_token_org();

-- ---------- Guard: an assigned participant must belong to the unit's org.
create or replace function public.check_unit_assigned_participant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if new.assigned_participant_id is not null then
    select org_id into v_org from public.participants where id = new.assigned_participant_id;
    if v_org is null then raise exception 'participant not found'; end if;
    if v_org <> new.org_id then raise exception 'org mismatch'; end if;
  end if;
  return new;
end;
$$;

create trigger units_check_assigned_participant
before insert or update of assigned_participant_id, org_id on public.units
for each row execute function public.check_unit_assigned_participant();

-- ---------- The sole validity authority.
create or replace function public.resolve_participant_token(p_token text)
returns table(
  status text, org_name text, org_id uuid,
  participant_id uuid, participant_name text,
  program_id uuid, program_name text, unit_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_tok public.access_tokens;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then
    return;
  end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  select * into v_tok
    from public.access_tokens t
   where t.token_hash = v_hash and t.kind = 'participant';
  if v_tok.id is null then
    return;
  end if;
  if v_tok.last_used_at is null or v_tok.last_used_at < now() - interval '60 seconds' then
    update public.access_tokens set last_used_at = now() where id = v_tok.id;
  end if;
  return query
    select case
             when v_tok.revoked_at is not null then 'revoked'
             when v_tok.expires_at < now() then 'expired'
             else 'ok'
           end,
           o.name, v_tok.org_id, v_tok.participant_id, p.name,
           v_tok.program_id, pr.name, v_tok.unit_id
      from public.orgs o, public.participants p, public.programs pr
     where o.id = v_tok.org_id and p.id = v_tok.participant_id
       and pr.id = v_tok.program_id;
end;
$$;

revoke all on function public.resolve_participant_token(text) from public, anon, authenticated, service_role;
grant execute on function public.resolve_participant_token(text) to anon;

-- ---------- Locate a unit_stage inside a token's LIVE scope, or raise.
-- Not exposed: internal helper for the two write RPCs.
create or replace function public.participant_scope_unit_stage(
  p_token text, p_unit_id uuid, p_requirement_id uuid,
  out o_unit_stage_id uuid, out o_participant_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope record;
  v_req public.program_stage_requirements;
begin
  select * into v_scope from public.resolve_participant_token(p_token);
  if v_scope.status is null or v_scope.status <> 'ok' then
    raise exception 'not found';
  end if;
  select * into v_req
    from public.program_stage_requirements r
   where r.id = p_requirement_id and r.program_id = v_scope.program_id;
  if v_req.id is null then
    raise exception 'not found';
  end if;
  -- Scope is LIVE: assignment is checked now, not at mint time.
  perform 1 from public.units u
    where u.id = p_unit_id
      and u.program_id = v_scope.program_id
      and u.assigned_participant_id = v_scope.participant_id
      and (v_scope.unit_id is null or u.id = v_scope.unit_id);
  if not found then
    raise exception 'not found';
  end if;
  select us.id into o_unit_stage_id
    from public.unit_stages us
   where us.unit_id = p_unit_id and us.program_stage_id = v_req.program_stage_id;
  if o_unit_stage_id is null then
    raise exception 'not found';
  end if;
  o_participant_id := v_scope.participant_id;
end;
$$;

revoke all on function public.participant_scope_unit_stage(text, uuid, uuid) from public, anon, authenticated, service_role;

-- ---------- Participant writes. The DB trusts the token, not the caller.
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
begin
  select o_unit_stage_id, o_participant_id
    into v_unit_stage_id, v_participant_id
    from public.participant_scope_unit_stage(p_token, p_unit_id, p_requirement_id);

  -- Anon-facing write: cap text length before it reaches the table (matches
  -- the Zod cap on the authenticated staff path). Uniform 'not found' per
  -- the 404 discipline used throughout this migration — an oversized
  -- payload gets no more diagnostic detail than a bad token or a
  -- stale scope. char_length(null) is null, so this is a no-op for the
  -- non-text requirement types.
  if char_length(p_value_text) > 2000 then
    raise exception 'not found';
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
  -- unit_stage_responses_one_value_check (0011) is what actually enforces
  -- a single, correctly-typed, non-empty value — a null, wrong-type, or
  -- empty-string submission dies at that CHECK, not here. The derive
  -- trigger then recomputes the stage. All three fire unchanged.
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
begin
  select o_unit_stage_id, o_participant_id
    into v_unit_stage_id, v_participant_id
    from public.participant_scope_unit_stage(p_token, p_unit_id, p_requirement_id);
  delete from public.unit_stage_responses
   where unit_stage_id = v_unit_stage_id
     and program_stage_requirement_id = p_requirement_id;
end;
$$;

revoke all on function public.clear_participant_response(text, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.clear_participant_response(text, uuid, uuid) to anon;

-- ---------- Attribution symmetry (amends the slice-6 prepare trigger).
-- Recreated VERBATIM from 0011 plus the attribution block: staff writes
-- (auth.uid() present) claim user attribution and null the participant;
-- token-path writes (auth.uid() null under anon, via the SECURITY DEFINER
-- RPCs above) keep the RPC-supplied participant id and a null user id.
create or replace function public.prepare_unit_stage_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_us record;
  v_req record;
begin
  select unit_id, program_stage_id, program_id, org_id into v_us
    from public.unit_stages where id = new.unit_stage_id;
  if v_us.unit_id is null then
    raise exception 'unit stage not found';
  end if;
  select program_stage_id, type into v_req
    from public.program_stage_requirements
   where id = new.program_stage_requirement_id;
  if v_req.program_stage_id is null or v_req.program_stage_id <> v_us.program_stage_id then
    raise exception 'requirement not found';
  end if;
  new.unit_id := v_us.unit_id;
  new.program_id := v_us.program_id;
  new.org_id := v_us.org_id;
  new.type := v_req.type;
  new.answered_by_user_id := auth.uid();
  if auth.uid() is not null then
    new.answered_by_participant_id := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
