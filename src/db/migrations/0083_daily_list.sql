-- S4 daily action list (spec 2026-09-08-s4-daily-action-list-design.md).
-- Additive: one column, two read RPCs, the member-prefs validator re-created
-- with a fifth event. Normal deploy order.

-- ---------- orgs.digest_sent_on: the org-local date of the last digest
-- claim. Null = never sent, so every existing org is due at its next 08:00.
alter table public.orgs add column digest_sent_on date;
--> statement-breakpoint

-- ---------- list_balances_due: ended, confirmed bookings of ONE org that
-- still owe money, by the 0082 formula (never re-derived in TS for a list).
-- Gate: a member of the org or the service role; anyone else gets no rows.
-- Bounded by p_since (the app passes now − 30 days, spec ruling 6).
create function public.list_balances_due(p_org_id uuid, p_since timestamptz, p_limit int default 50)
returns table (id uuid, balance_cents int)
language sql stable security definer set search_path = '' as $$
  select s.id, s.balance_cents from (
    select b.id, b.ends_at, public.booking_balance_cents(b.id) as balance_cents
    from public.bookings b
    where b.org_id = p_org_id
      and (auth.role() = 'service_role' or p_org_id in (select public.user_orgs()))
      and b.status = 'confirmed'
      and b.ends_at <= now()
      and b.ends_at >= p_since
  ) s
  where s.balance_cents > 0
  order by s.ends_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;
--> statement-breakpoint
revoke all on function public.list_balances_due(uuid, timestamptz, int) from public, anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function public.list_balances_due(uuid, timestamptz, int) to authenticated, service_role;
--> statement-breakpoint

-- ---------- digest_due_orgs: which orgs are past 08:00 local time and not
-- yet stamped for their local date. The hour is mirrored by
-- DIGEST_LOCAL_HOUR in src/features/notifications/digest.ts (ruling 8/11).
create function public.digest_due_orgs()
returns table (id uuid, name text, timezone text, locale text, local_date date)
language sql stable security definer set search_path = '' as $$
  select o.id, o.name, o.timezone, o.locale,
         (now() at time zone o.timezone)::date as local_date
  from public.orgs o
  where extract(hour from now() at time zone o.timezone) >= 8
    and (o.digest_sent_on is null or o.digest_sent_on < (now() at time zone o.timezone)::date)
  order by o.digest_sent_on nulls first, o.id
  limit 25;
$$;
--> statement-breakpoint
revoke all on function public.digest_due_orgs() from public, anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function public.digest_due_orgs() to service_role;
--> statement-breakpoint

-- ---------- update_member_notification_prefs: 0075's body with
-- 'dailyDigest' admitted. Shape mirrors memberPrefsSchema (prefs.ts);
-- prefs.test.ts asserts the two lists agree.
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
      if v_key not in ('newBooking', 'newRequest', 'cancelled', 'rescheduled', 'dailyDigest') then
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
--> statement-breakpoint
revoke all on function public.update_member_notification_prefs(uuid, jsonb) from public, anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function public.update_member_notification_prefs(uuid, jsonb) to authenticated;
