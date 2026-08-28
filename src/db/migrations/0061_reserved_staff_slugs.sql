-- 0061 (channel pages, spec 2026-08-28 §3.3 + amendments): `spaces` and
-- `appointments` are reserved booking-link names — Next matches the static
-- /<handle>/spaces segment before /<handle>/[staffSlug], so a person slugged
-- either would be unreachable (or, worse, silently served the org's spaces
-- page). The app refuses new ones (staff-slug.ts, schema.ts); this renames
-- any that already exist, the way slugifyStaffName would have: `<slug>-1`.
-- Idempotent: nothing matches on a second run. Guarded against the (absurdly
-- unlikely) case where `<slug>-1` is already taken in the same org — staff
-- (org_id, slug) is unique (0040, staff_org_slug_uq) — so the migration can
-- never fail; such a row is left for a human, and the app's own guard stops
-- new ones.

update public.staff s
   set slug = s.slug || '-1'
 where s.slug in ('spaces', 'appointments')
   and not exists (
     select 1 from public.staff t
      where t.org_id = s.org_id and t.slug = s.slug || '-1'
   );
