-- Custom SQL migration file, put your code below! --

-- Explicit table grants for API roles.
--
-- Why this migration exists: the local Supabase 2.75 dev image auto-grants
-- arwdDxtm (all privileges) on every public table to anon/authenticated/
-- service_role via a pre-seeded pg_default_acl entry, so tables created by
-- Drizzle migrations "just work" locally without any GRANT statements. CI's
-- `supabase/setup-cli` action installs the latest CLI, whose newer image
-- does NOT ship that default ACL. Without it, PostgREST's authenticated
-- role gets "permission denied for table ..." on every query, before RLS
-- policies ever get a chance to evaluate. GRANT and RLS are two separate
-- gates: GRANT decides whether a role may touch the table at all; RLS
-- policies then decide which rows it can see or change. Both are required.
--
-- Going forward, every migration that creates a new public table must add
-- its own explicit grants here (or alongside the CREATE TABLE) rather than
-- relying on any default-privilege behavior from the underlying image.
--
-- `anon` intentionally receives nothing: this app has no unauthenticated
-- public reads, so anon should not be able to touch these tables at all.
grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on table
  public.orgs,
  public.org_members,
  public.templates,
  public.template_stages
to authenticated;

grant select, insert, update, delete on table
  public.orgs,
  public.org_members,
  public.templates,
  public.template_stages
to service_role;