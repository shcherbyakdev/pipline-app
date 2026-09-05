-- 0075 (Notifications, spec 2026-09-05): what a member hears about, what an
-- org's clients receive, and the devices a member enabled for Web Push.
--
-- Two nullable jsonb columns, NULL = defaults (features/notifications/prefs.ts
-- parseMemberPrefs / parseOrgPrefs), so every row written before this
-- migration keeps today's behaviour: every provider mail goes out, a 24-hour
-- reminder goes to every client. Written ONLY through the two definer RPCs
-- below — orgs / org_members stay select-only for authenticated (0004).
alter table public.orgs add column notification_prefs jsonb;
alter table public.org_members add column notification_prefs jsonb;

-- ---------- push_subscriptions: one row per browser a member enabled push
-- in. Keyed by the USER (a member may belong to several orgs one day; the
-- device is theirs, not the org's) and carrying org_id so the seam can list
-- an org's devices without a join. endpoint is the push service's unique
-- URL for that browser — the natural key; re-subscribing the same browser
-- upserts on it.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
-- Both policy columns indexed (RLS perf rule); the seam reads by user_id.
create index push_subscriptions_user_id_idx on public.push_subscriptions(user_id);
create index push_subscriptions_org_id_idx on public.push_subscriptions(org_id);

-- Own rows only: a member enables and removes their own devices; nobody
-- reads another member's endpoints (an endpoint + keys IS the ability to
-- notify that phone). service_role (the seam) bypasses RLS but still needs
-- the grant. (select auth.uid()) so the planner caches it per statement.
alter table public.push_subscriptions enable row level security;
drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own" on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
create policy "push_subscriptions_insert_own" on public.push_subscriptions
  for insert to authenticated
  with check (user_id = (select auth.uid()) and org_id in (select public.user_orgs()));
drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;
create policy "push_subscriptions_delete_own" on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));
-- No UPDATE for members: a changed endpoint is a new subscription (the
-- browser hands out a fresh one), so the app deletes + inserts.

revoke all on table public.push_subscriptions from public, anon, authenticated, service_role;
grant select, insert, delete on table public.push_subscriptions to authenticated;
grant select, insert, update, delete on table public.push_subscriptions to service_role;

-- ---------- The member's own preferences. Full-state semantics (the app
-- merges and sends the whole object, update_org_branding idiom); NULL
-- resets to defaults. Shape mirrors memberPrefsSchema: exactly the four
-- events, each {email: bool, push: bool}.
create or replace function public.update_member_notification_prefs(p_org_id uuid, p_prefs jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_val jsonb;
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then
    raise exception 'not found';
  end if;
  if p_prefs is not null then
    if jsonb_typeof(p_prefs) <> 'object' then raise exception 'not found'; end if;
    for v_key, v_val in select * from jsonb_each(p_prefs) loop
      if v_key not in ('newBooking', 'newRequest', 'cancelled', 'rescheduled') then
        raise exception 'not found';
      end if;
      if jsonb_typeof(v_val) <> 'object'
         or jsonb_typeof(v_val -> 'email') is distinct from 'boolean'
         or jsonb_typeof(v_val -> 'push') is distinct from 'boolean' then
        raise exception 'not found';
      end if;
    end loop;
  end if;
  update public.org_members
     set notification_prefs = p_prefs
   where org_id = p_org_id and user_id = (select auth.uid());
end;
$$;
revoke all on function public.update_member_notification_prefs(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.update_member_notification_prefs(uuid, jsonb) to authenticated;

-- ---------- What the org's clients receive. Any member may set it (the
-- same trust as update_org_scheduling). The lead set mirrors
-- REMINDER_LEAD_HOURS; adding an option is a migration AND a code change,
-- on purpose — the drain's query bound depends on the largest one.
create or replace function public.update_org_notification_prefs(p_org_id uuid, p_prefs jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then
    raise exception 'not found';
  end if;
  if p_prefs is not null then
    if jsonb_typeof(p_prefs) <> 'object'
       or jsonb_typeof(p_prefs -> 'reminder') is distinct from 'object'
       or jsonb_typeof(p_prefs -> 'reminder' -> 'enabled') is distinct from 'boolean'
       or jsonb_typeof(p_prefs -> 'reminder' -> 'leadHours') is distinct from 'number'
       or (p_prefs -> 'reminder' ->> 'leadHours')::numeric not in (1, 2, 3, 6, 12, 24, 48) then
      raise exception 'not found';
    end if;
  end if;
  update public.orgs set notification_prefs = p_prefs where id = p_org_id;
end;
$$;
revoke all on function public.update_org_notification_prefs(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.update_org_notification_prefs(uuid, jsonb) to authenticated;

-- ---------- /notifications is a top-level route now: a handle must never
-- shadow it. Mirror of RESERVED_HANDLES (features/scheduling/handle.ts);
-- 0066 body plus 'notifications'. Same grants: internal to the definer
-- RPCs, nobody calls it.
create or replace function public.reserved_handles() returns text[]
language sql immutable set search_path = '' as $$
  select array[
    'api','auth','availability','billing','book','booking','booking-page','bookings',
    'clients','dev','embed','forgot-password','login','onboarding','overview','portal',
    'pricing','privacy','programs','rentals','reset-password','services','settings','signup',
    'team','templates','terms','utils','waitlist','notifications',
    'admin','app','www','mail','help','support','docs','blog','about','contact','status',
    'static','assets','public','booklo','new','home','index','sitemap','robots',
    'favicon'
  ]::text[]
$$;
revoke all on function public.reserved_handles() from public, anon, authenticated, service_role;
