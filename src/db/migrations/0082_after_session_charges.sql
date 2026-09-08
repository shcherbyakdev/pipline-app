-- S7 — after-session charges and settlement (spec docs/superpowers/specs/2026-09-08-s7-after-session-charges-design.md).

-- ---------- charges: their own table, their own RLS (ruling 8).
create table public.booking_charges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  kind text not null check (kind in ('overtime','people','cleaning','damage','other')),
  label text not null check (char_length(label) between 1 and 80),
  qty integer not null default 1 check (qty > 0),
  unit_cents integer not null check (unit_cents >= 0),
  cents integer not null check (cents >= 0 and cents = qty * unit_cents),
  note text check (note is null or char_length(note) <= 500),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
--> statement-breakpoint
create index booking_charges_booking_id_idx on public.booking_charges (booking_id);
--> statement-breakpoint
alter table public.booking_charges enable row level security;
--> statement-breakpoint
create policy "booking_charges_select_member" on public.booking_charges
  for select to authenticated using (org_id in (select public.user_orgs()));
--> statement-breakpoint
create policy "booking_charges_insert_member" on public.booking_charges
  for insert to authenticated
  with check (org_id in (select public.user_orgs())
    and exists (select 1 from public.bookings b where b.id = booking_id and b.org_id = booking_charges.org_id));
--> statement-breakpoint
create policy "booking_charges_delete_member" on public.booking_charges
  for delete to authenticated using (org_id in (select public.user_orgs()));
--> statement-breakpoint
-- Grants convention: newer images drop default ACLs.
grant select, insert, delete on table public.booking_charges to authenticated;
--> statement-breakpoint
grant all on table public.booking_charges to service_role;
--> statement-breakpoint

-- ---------- write-off on the booking; written only by write_off_booking.
alter table public.bookings
  add column written_off_cents integer not null default 0,
  add column written_off_note text,
  add constraint bookings_written_off_ck check (written_off_cents >= 0);
--> statement-breakpoint

-- ---------- the ledger learns balance payments.
alter table public.booking_payments drop constraint booking_payments_kind_check;
--> statement-breakpoint
alter table public.booking_payments add constraint booking_payments_kind_check check (kind in ('deposit','balance'));
--> statement-breakpoint

-- ---------- the one balance formula (TS twin: balanceCents in
-- src/features/payments/settlement.ts, lockstep-tested).
create function public.booking_balance_cents(p_booking_id uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(b.price_cents, 0) + b.fee_cents
       + coalesce((select sum(c.cents) from public.booking_charges c where c.booking_id = b.id), 0)::int
       - b.written_off_cents - (b.paid_cents - b.refunded_cents)
  from public.bookings b where b.id = p_booking_id;
$$;
--> statement-breakpoint
revoke all on function public.booking_balance_cents(uuid) from public, anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function public.booking_balance_cents(uuid) to authenticated, service_role;
--> statement-breakpoint

-- ---------- write_off_booking: the balance becomes 0 (ruling 3).
create function public.write_off_booking(p_booking_id uuid, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_due int;
begin
  if p_booking_id is null then raise exception 'not found'; end if;
  select b.id into v_id from public.bookings b
    where b.id = p_booking_id and b.org_id in (select public.user_orgs()) and b.status = 'confirmed'
    for update;
  if v_id is null then raise exception 'not found'; end if;
  v_due := public.booking_balance_cents(v_id);
  if v_due <= 0 then raise exception 'nothing_due'; end if;
  update public.bookings set written_off_cents = written_off_cents + v_due,
    written_off_note = nullif(left(coalesce(p_note, ''), 500), '')
    where id = v_id;
  return v_id;
end; $$;
--> statement-breakpoint
revoke all on function public.write_off_booking(uuid, text) from public, anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function public.write_off_booking(uuid, text) to authenticated;
--> statement-breakpoint

-- ---------- mark_booking_paid (base: 0079): a hold as before; a confirmed
-- booking records its whole balance as a manual `balance` row (decision 4).
create or replace function public.mark_booking_paid(p_booking_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_b record; v_due int;
begin
  if p_booking_id is null then raise exception 'not found'; end if;
  select b.id, b.org_id, b.status, b.deposit_cents, b.currency into v_b
    from public.bookings b
    where b.id = p_booking_id and b.org_id in (select public.user_orgs())
      and b.status in ('pending_payment', 'confirmed') for update;
  if v_b.id is null then raise exception 'not found'; end if;
  if v_b.status = 'pending_payment' then
    insert into public.booking_payments (org_id, booking_id, kind, provider, amount_cents, currency, status, paid_at)
      values (v_b.org_id, v_b.id, 'deposit', 'manual', v_b.deposit_cents, coalesce(v_b.currency, 'PLN'), 'paid', now());
    update public.bookings set status = 'confirmed', paid_cents = paid_cents + v_b.deposit_cents where id = v_b.id;
  else
    v_due := public.booking_balance_cents(v_b.id);
    if v_due <= 0 then raise exception 'not found'; end if;
    insert into public.booking_payments (org_id, booking_id, kind, provider, amount_cents, currency, status, paid_at)
      values (v_b.org_id, v_b.id, 'balance', 'manual', v_due, coalesce(v_b.currency, 'PLN'), 'paid', now());
    update public.bookings set paid_cents = paid_cents + v_due where id = v_b.id;
  end if;
  return v_b.id;
end; $$;
--> statement-breakpoint

-- ---------- apply_booking_payment (base: 0079): a `balance` row credits a
-- confirmed booking and never changes status (ruling 10); on a dead booking
-- it is money for nothing → slot_lost → the caller refunds.
create or replace function public.apply_booking_payment(p_session_id text, p_payment_intent_id text, p_amount_cents int)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_pay record; v_status text;
begin
  select bp.id, bp.booking_id, bp.status, bp.kind into v_pay
    from public.booking_payments bp where bp.checkout_session_id = p_session_id for update;
  if v_pay.id is null then return 'unknown'; end if;
  if v_pay.status in ('paid','refunded','refund_failed') then return 'replayed'; end if;

  update public.booking_payments
    set status = 'paid', payment_intent_id = p_payment_intent_id, amount_cents = p_amount_cents,
        paid_at = now(), updated_at = now()
    where id = v_pay.id;

  select b.status into v_status from public.bookings b where b.id = v_pay.booking_id for update;
  -- S7: the balance of a booking that already happened. It never moves the
  -- status — a confirmed booking simply owes less.
  if v_pay.kind = 'balance' then
    if v_status = 'confirmed' then
      update public.bookings set paid_cents = paid_cents + p_amount_cents where id = v_pay.booking_id;
      return 'balance';
    end if;
    return 'slot_lost';
  end if;
  if v_status = 'pending_payment' then
    update public.bookings set status = 'confirmed', paid_cents = paid_cents + p_amount_cents
      where id = v_pay.booking_id;
    return 'confirmed';
  elsif v_status = 'expired' then
    -- The hold lapsed before the money landed: take the slot back if it is
    -- still free. The EXCLUDE guard is the arbiter.
    begin
      update public.bookings set status = 'confirmed', paid_cents = paid_cents + p_amount_cents
        where id = v_pay.booking_id;
      return 'confirmed';
    exception when exclusion_violation then
      return 'slot_lost';
    end;
  else
    return 'slot_lost';
  end if;
end; $$;
--> statement-breakpoint
revoke all on function public.apply_booking_payment(text, text, int) from public, anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function public.apply_booking_payment(text, text, int) to service_role;
--> statement-breakpoint

-- ---------- rotate_booking_token (base: 0079): a confirmed booking's link
-- can be reissued after the session (ruling 9), inside the 30-day window
-- resolve_booking_token already honours.
create or replace function public.rotate_booking_token(
  p_booking_id uuid,
  p_token_hash text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_booking_id is null then raise exception 'not found'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'not found';
  end if;

  update public.bookings b
    set cancel_token_hash = p_token_hash
    where b.id = p_booking_id
      and b.org_id in (select public.user_orgs())
      and ((b.status in ('pending','pending_payment') and b.starts_at > now())
        or (b.status = 'confirmed' and b.ends_at > now() - interval '30 days'))
    returning b.id into v_id;
  if v_id is null then raise exception 'not found'; end if;

  return v_id;
end;
$$;
--> statement-breakpoint
revoke all on function public.rotate_booking_token(uuid, text)
  from public, anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function public.rotate_booking_token(uuid, text) to authenticated;

-- Rollback: drop function write_off_booking, booking_balance_cents; recreate
-- apply_booking_payment (drop + create), mark_booking_paid and
-- rotate_booking_token from 0079; delete booking_payments rows with kind =
-- 'balance' then restore the kind CHECK to ('deposit'); alter table bookings
-- drop column written_off_cents, drop column written_off_note; drop table
-- booking_charges.
