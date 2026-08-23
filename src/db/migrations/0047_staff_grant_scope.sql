-- 0047 (security hardening): column-scope the authenticated grants on
-- public.staff. 0041 granted table-wide INSERT + UPDATE to authenticated,
-- unlike every sibling tenant table (units, chases, availability_rules,
-- bookings, unit_stages, access_tokens, …), which grant write access only on
-- the columns a member legitimately edits.
--
-- The gap: staff.user_id (the future auth-login link) was writable by any org
-- member. staff_guard_update only blocks CHANGING an already-set user_id
-- (old.user_id is not null), and there is no INSERT trigger — so a member
-- could set user_id NULL -> any uuid via UPDATE, or plant an arbitrary user_id
-- on a fresh row via INSERT. No code reads staff.user_id for authorization
-- today, so this is a latent privilege-linking primitive rather than a live
-- exploit; scope it out now, before any login/claim feature consumes user_id.
--
-- Who writes what to staff, post-change:
--   authenticated  -> SELECT + UPDATE(name, slug, email, color, active) only.
--                     updateStaff writes name/slug/email/color; setStaffActive
--                     writes active. No app path INSERTs staff directly.
--   service_role   -> unchanged (trusted server role; only reached via gated
--                     admin paths — drains, webhooks, /utils).
-- Row creation (create_org, create_staff) and any user_id linking run in
-- SECURITY DEFINER RPCs as the table owner, unaffected by these grants.
--
-- Idempotent (0026 doctrine): revoke-all, then re-grant.
revoke all on table public.staff from public, anon, authenticated, service_role;
grant select on table public.staff to authenticated;
grant update (name, slug, email, color, active) on table public.staff to authenticated;
grant select, insert, update on table public.staff to service_role;
