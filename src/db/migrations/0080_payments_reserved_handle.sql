-- 0080: /payments is a top-level route now (S2 Task 8): a handle must never
-- shadow it. Mirror of RESERVED_HANDLES (features/scheduling/handle.ts);
-- 0076 body plus 'payments'. Same grants: internal to the definer RPCs,
-- nobody calls it.
create or replace function public.reserved_handles() returns text[]
language sql immutable set search_path = '' as $$
  select array[
    'api','auth','availability','billing','book','booking','booking-page','bookings',
    'clients','dev','embed','forgot-password','login','onboarding','overview','payments','portal',
    'pricing','privacy','programs','rentals','reset-password','services','settings','signup',
    'team','templates','terms','utils','waitlist','notifications','integrations',
    'admin','app','www','mail','help','support','docs','blog','about','contact','status',
    'static','assets','public','booklo','new','home','index','sitemap','robots',
    'favicon'
  ]::text[]
$$;
revoke all on function public.reserved_handles() from public, anon, authenticated, service_role;
