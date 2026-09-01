-- 0066 (Premium waitlist): RLS + grants for premium_waitlist, and the
-- org_feature_flags CHECK widened for the `premium_waitlist` flag. Idempotent
-- (drop-if-exists before add), 0043 doctrine.

-- ---------- premium_waitlist: members read and JOIN for their own org (the
-- one member-written row in the billing family); only service_role removes.
-- joined_by must be the caller's own email: the row is what /utils shows
-- the owner, and a member must not be able to sign someone else up.
alter table public.premium_waitlist enable row level security;
drop policy if exists "premium_waitlist_select_member" on public.premium_waitlist;
create policy "premium_waitlist_select_member" on public.premium_waitlist
  for select to authenticated using (org_id in (select public.user_orgs()));
drop policy if exists "premium_waitlist_insert_member" on public.premium_waitlist;
create policy "premium_waitlist_insert_member" on public.premium_waitlist
  for insert to authenticated
  with check (org_id in (select public.user_orgs()) and joined_by = (auth.jwt() ->> 'email'));
-- no update/delete policies on purpose: leaving the list is an owner action (/utils, service_role).

revoke all on table public.premium_waitlist from public, anon, authenticated, service_role;
grant select, insert on table public.premium_waitlist to authenticated;
grant select, insert, update, delete on table public.premium_waitlist to service_role;

-- ---------- Mirrors FLAG_KEYS in src/lib/flags (0045 rule).
alter table public.org_feature_flags drop constraint if exists org_feature_flags_flag_chk;
alter table public.org_feature_flags add constraint org_feature_flags_flag_chk
  check (flag in ('billing','rentals','overview','command_menu','premium_waitlist'));

-- ---------- /waitlist is a top-level route now: a handle must never shadow
-- it. Mirror of RESERVED_HANDLES (features/scheduling/handle.ts); 0051 body
-- plus 'waitlist'. Same grants: internal to the definer RPCs, nobody calls it.
create or replace function public.reserved_handles() returns text[]
language sql immutable set search_path = '' as $$
  select array[
    'api','auth','availability','billing','book','booking','booking-page','bookings',
    'clients','dev','embed','forgot-password','login','onboarding','overview','portal',
    'pricing','privacy','programs','rentals','reset-password','services','settings','signup',
    'team','templates','terms','utils','waitlist',
    'admin','app','www','mail','help','support','docs','blog','about','contact','status',
    'static','assets','public','booklo','new','home','index','sitemap','robots',
    'favicon'
  ]::text[]
$$;
revoke all on function public.reserved_handles() from public, anon, authenticated, service_role;
