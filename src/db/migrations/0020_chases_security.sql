-- Custom SQL migration file, put your code below! --

-- Chasing security model (slice 10):
--   * chases: member select/insert; member update is column-scoped to
--     stopped_at (the access_tokens revoked_at idiom). No delete — chases
--     are history. service_role drives the drain (sends_done/next_send_at/
--     last_error/attempt_count) via its blanket grant below.
--   * 0013 revoked access_tokens writes from service_role ON PURPOSE. The
--     drain therefore mutates tokens only through the three definer RPCs
--     here: mint copies its scope FROM the chase row (a leaked service key
--     still cannot mint an arbitrary link), complete revokes the chase's
--     set atomically, stop is anon-callable with the token as credential.

-- ---------- FK deferred from 0019 (module-cycle constraint in schema TS)
alter table public.access_tokens
  add constraint access_tokens_chase_id_chases_id_fk
  foreign key (chase_id) references public.chases(id) on delete set null;

-- ---------- One live chase per scope. coalesce because unique treats
-- nulls as distinct; the zero uuid stands in for "whole program".
-- next_send_at is not null excludes exhausted/stalled chases (cadence ran
-- dry, or the drain's retry cap gave up) from blocking — staff can start a
-- fresh chase for the scope without waiting on a dead one. Accepted: the
-- final send's claim window can in theory admit a redundant duplicate row.
create unique index chases_live_scope_uq
  on public.chases (org_id, participant_id, program_id,
    coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where completed_at is null and stopped_at is null and next_send_at is not null;

-- ---------- Due-scan index: the drain's only query shape.
create index chases_due_idx on public.chases (next_send_at)
  where completed_at is null and stopped_at is null and next_send_at is not null;

-- ---------- RLS
alter table public.chases enable row level security;

create policy "chases_select_member" on public.chases
  for select to authenticated using (org_id in (select public.user_orgs()));
create policy "chases_insert_member" on public.chases
  for insert to authenticated with check (org_id in (select public.user_orgs()));
create policy "chases_update_member" on public.chases
  for update to authenticated
  using (org_id in (select public.user_orgs()))
  with check (org_id in (select public.user_orgs()));
-- no delete policy: chases are the chase history.

-- ---------- Grants (0004 convention). anon gets nothing (0013 default-
-- privileges sweep already guarantees new tables start anon-free).
-- Revoke the blanket default ACL first — otherwise the column-scoped
-- update grant below is inert and authenticated keeps table-wide UPDATE
-- (0011's revoke-then-narrow-grant rule; 0013/0018 precedent).
revoke insert, update, delete, truncate on table public.chases from authenticated;
grant select, insert on table public.chases to authenticated;
grant update (stopped_at) on table public.chases to authenticated;
grant select, insert, update on table public.chases to service_role;
revoke delete, truncate on table public.chases from authenticated, service_role;

-- ---------- Guard: chase scope must be internally consistent with its org.
-- SECURITY INVOKER: foreign rows are RLS-invisible → 'not found', no
-- existence leak (check_access_token_org precedent).
create or replace function public.check_chase_org()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
  v_unit record;
begin
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
  return new;
end;
$$;

create trigger chases_org_guard
  before insert or update of org_id, participant_id, program_id, unit_id
  on public.chases
  for each row execute function public.check_chase_org();

-- ---------- RPC: mint a chase token. SECURITY DEFINER (owner postgres)
-- because 0013 removed access_tokens writes from every service path on
-- purpose. Scope is copied from the chase row — the caller chooses only
-- WHICH chase, never the scope. Live-chase check keeps a leaked service
-- key from minting against finished chases.
create or replace function public.mint_chase_token(
  p_chase_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chase record;
begin
  select id, org_id, participant_id, program_id, unit_id, created_by
    into v_chase
    from public.chases
    where id = p_chase_id
      and completed_at is null
      and stopped_at is null;
  if v_chase.id is null then raise exception 'chase not live'; end if;

  insert into public.access_tokens
    (org_id, token_hash, kind, participant_id, program_id, unit_id,
     chase_id, expires_at, created_by)
  values
    (v_chase.org_id, p_token_hash, 'participant', v_chase.participant_id,
     v_chase.program_id, v_chase.unit_id, v_chase.id, p_expires_at,
     v_chase.created_by);
end;
$$;

revoke execute on function public.mint_chase_token(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.mint_chase_token(uuid, text, timestamptz)
  to service_role;

-- ---------- RPC: complete a chase — the ONE place "submission cancels the
-- chase" lands. Atomic: completed_at + the token-set revoke commit together.
create or replace function public.complete_chase(p_chase_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.chases
    set completed_at = now(), next_send_at = null
    where id = p_chase_id and completed_at is null;
  if not found then return; end if;

  update public.access_tokens
    set revoked_at = now()
    where chase_id = p_chase_id and revoked_at is null;
end;
$$;

revoke execute on function public.complete_chase(uuid)
  from public, anon, authenticated;
grant execute on function public.complete_chase(uuid) to service_role;

-- ---------- RPC: participant opt-out. Anon-callable; the token is the
-- credential (0013 trust model). Hash must agree with lib/tokens/mint.ts.
-- Silent on every failure — no probe can distinguish bad token from
-- no-chase from already-stopped (the 404 discipline).
create or replace function public.stop_chase(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chase_id uuid;
begin
  select t.chase_id into v_chase_id
    from public.access_tokens t
    where t.token_hash =
        encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex')
      and t.kind = 'participant'
      and t.chase_id is not null
      and t.revoked_at is null
      and t.expires_at > now();
  if v_chase_id is null then return; end if;

  update public.chases
    set stopped_at = now()
    where id = v_chase_id and stopped_at is null and completed_at is null;
end;
$$;

revoke execute on function public.stop_chase(text) from public, authenticated;
grant execute on function public.stop_chase(text) to anon;
