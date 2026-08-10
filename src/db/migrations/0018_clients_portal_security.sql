-- Custom SQL migration file, put your code below! --

-- Clients + portal security model (slice 9):
--   * clients: ordinary member-CRUD rows (participants pattern, 0013).
--   * Portal tokens are CLIENT-scoped only; the CHECK below makes narrower
--     portal scopes unrepresentable. Participant CHECK tightened
--     symmetrically (client_id must be null there).
--   * resolve_portal_token is a SECOND dedicated resolver — deliberately
--     not a generalised one. Each resolver filters its own kind, so
--     cross-kind confusion is structurally impossible.
--   * NO write RPCs exist for portal tokens: read-only is not a UI
--     property; there is no SQL a portal token can reach that writes.
--   * orgs branding is written ONLY via update_org_branding (orgs keeps its
--     select-only grant from 0004).
--   * Deleting a client cascades its tokens (FK-level, past grants/RLS —
--     the participants precedent; 0013's "no delete policy" guards direct
--     member deletes, not lifecycle cascades) and nulls its units.

-- ---------- Branding bucket (PUBLIC read: logos are not secrets, and
-- public read means no signing on every portal load. Zero storage
-- policies — writes only via the server-only admin client, the slice-8
-- bucket-authority precedent. Caps enforced at the storage floor too.)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 1048576,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------- CHECKs
alter table public.orgs
  add constraint orgs_accent_color_check
  check (accent_color is null or accent_color ~ '^#[0-9a-f]{6}$');

alter table public.access_tokens
  add constraint access_tokens_portal_scope_check
  check (kind <> 'portal' or (client_id is not null
    and participant_id is null and program_id is null and unit_id is null));

-- Tightened: a participant token must not carry a client_id. Safe drop +
-- re-add — client_id is brand new, every existing row has it null.
alter table public.access_tokens
  drop constraint access_tokens_participant_scope_check;
alter table public.access_tokens
  add constraint access_tokens_participant_scope_check
  check (kind <> 'participant'
    or (participant_id is not null and program_id is not null and client_id is null));

-- ---------- RLS + grants: clients (participants pattern, 0013)
alter table public.clients enable row level security;

create policy "clients_select_member" on public.clients
  for select to authenticated using (org_id in (select public.user_orgs()));
create policy "clients_insert_member" on public.clients
  for insert to authenticated with check (org_id in (select public.user_orgs()));
create policy "clients_update_member" on public.clients
  for update to authenticated
  using (org_id in (select public.user_orgs()))
  with check (org_id in (select public.user_orgs()));
create policy "clients_delete_member" on public.clients
  for delete to authenticated using (org_id in (select public.user_orgs()));

-- 0004 convention; blanket-ACL revoke first (0011 lesson). truncate is
-- included: it is not RLS-governed at all (the 0013 access_tokens lesson,
-- restated by 0015 for evidence) — without it, authenticated could wipe
-- every org's clients in one call despite RLS scoping every other
-- operation to its own org. service_role is untouched here (unlike 0015's
-- evidence, where service_role is deliberately locked to select-only):
-- clients follows the 0013 participants precedent, where service_role
-- holds full CRUD by design, and an RLS-bypassing DELETE already lets it
-- clear the whole table, so a truncate revoke would add no real boundary.
revoke insert, update, delete, truncate on table public.clients from authenticated;
grant select, insert, update, delete on table public.clients to authenticated;
grant select, insert, update, delete on table public.clients to service_role;
-- (0013's default-privileges revoke already keeps anon at zero here.)

-- units: additive column grant for client assignment (0008 scoped the
-- update grant per-column; 0013 added assigned_participant_id the same way).
grant update (client_id) on table public.units to authenticated;

-- ---------- Guard: a unit's client must belong to the unit's org.
-- SECURITY INVOKER (check_template_stage_org precedent): foreign clients
-- are RLS-invisible and read as 'not found' rather than leaking existence.
-- Fires on UPDATE OF client_id, so ON DELETE SET NULL passes through
-- (null skips the check).
create or replace function public.check_unit_client()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if new.client_id is not null then
    select org_id into v_org from public.clients where id = new.client_id;
    if v_org is null then raise exception 'client not found'; end if;
    if v_org <> new.org_id then raise exception 'org mismatch'; end if;
  end if;
  return new;
end;
$$;

create trigger units_check_client
before insert or update of client_id, org_id on public.units
for each row execute function public.check_unit_client();

-- ---------- Guard: token scope org-consistency, portal branch added.
-- Recreated VERBATIM from 0013 plus the kind='portal' block.
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

  if new.kind = 'portal' then
    select org_id into v_org from public.clients where id = new.client_id;
    if v_org is null then raise exception 'client not found'; end if;
    if v_org <> new.org_id then raise exception 'org mismatch'; end if;
  end if;

  return new;
end;
$$;

-- ---------- The portal validity authority (0013 resolver skeleton:
-- length guard, sha256 via extensions.digest, kind filter, throttled
-- last_used_at for revocation hygiene, uniform empty result).
create or replace function public.resolve_portal_token(p_token text)
returns table(
  status text, org_id uuid, org_name text,
  client_id uuid, client_name text
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
   where t.token_hash = v_hash and t.kind = 'portal';
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
           v_tok.org_id, o.name, v_tok.client_id, c.name
      from public.orgs o, public.clients c
     where o.id = v_tok.org_id and c.id = v_tok.client_id;
end;
$$;

revoke all on function public.resolve_portal_token(text) from public, anon, authenticated, service_role;
grant execute on function public.resolve_portal_token(text) to anon;

-- ---------- Branding writes. orgs stays select-only for authenticated;
-- this RPC is the only write path. FULL-STATE semantics: callers pass the
-- complete desired branding every call (the settings form always holds
-- both values). logo_path is capped at 300 chars, rejected on `..`, and
-- pinned inside the caller's own org folder (record_photo_evidence
-- precedent, 0015: `left()`/`LIKE` is a literal compare, so a path like
-- `<org_id>/../../../elsewhere.png` would satisfy the prefix while
-- actually resolving outside it once storage normalizes the key) —
-- defence in depth even though the server action derives the path itself.
create or replace function public.update_org_branding(
  p_org_id uuid, p_accent_color text, p_logo_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then
    raise exception 'not found';
  end if;
  if p_logo_path is not null and (
       char_length(p_logo_path) > 300
       or p_logo_path ~ '\.\.'
       or p_logo_path not like p_org_id::text || '/%'
     ) then
    raise exception 'not found';
  end if;
  -- lower(): defence in depth ahead of the column CHECK (Zod already
  -- normalises); a malformed value still dies at the CHECK.
  update public.orgs
     set accent_color = lower(p_accent_color),
         logo_path = p_logo_path
   where id = p_org_id;
end;
$$;

revoke all on function public.update_org_branding(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.update_org_branding(uuid, text, text) to authenticated;
