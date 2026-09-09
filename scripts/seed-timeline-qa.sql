-- Timeline v3 browser-QA seed for the LOCAL demo org (demo-studio, Europe/Warsaw).
-- Idempotent (tag TLQA). Run: docker exec -i supabase_db_pipline-app psql -U postgres -v ON_ERROR_STOP=1 < scripts/seed-timeline-qa.sql
-- Retires the S6QA leftovers so the board is readable; dev database only.
\set ON_ERROR_STOP on
DO $$
DECLARE
  org uuid := '0ccd24a1-33f6-478d-b26a-02a62d1cfa6d';
  apt uuid; kit uuid;
  a101 uuid; a102 uuid; a103 uuid; kA uuid; kB uuid;
  tz text := 'Europe/Warsaw';
BEGIN
  -- wipe an earlier run
  DELETE FROM bookings WHERE org_id = org AND client_name LIKE 'TLQA %';
  DELETE FROM rental_unit_blackouts WHERE org_id = org AND reason LIKE 'TLQA %';
  DELETE FROM rental_units WHERE org_id = org AND offering_id IN (SELECT id FROM rental_offerings WHERE org_id = org AND name IN ('Apartment', 'Camera kit'));
  DELETE FROM rental_offerings WHERE org_id = org AND name IN ('Apartment', 'Camera kit');
  -- retire the S6QA leftovers so the board is readable
  UPDATE rental_units SET active = false WHERE org_id = org AND offering_id IN (SELECT id FROM rental_offerings WHERE org_id = org AND name LIKE 'S6QA %');
  UPDATE rental_offerings SET active = false WHERE org_id = org AND name LIKE 'S6QA %';
  UPDATE bookings SET status = 'cancelled_by_provider' WHERE org_id = org AND rental_offering_id IN (SELECT id FROM rental_offerings WHERE org_id = org AND name LIKE 'S6QA %') AND status IN ('confirmed','pending','pending_payment');

  INSERT INTO rental_offerings (org_id, name, range_mode, start_time, end_time, turnover_days, unit_selection, active, sort_order, price_cents, pricing_mode, kind, min_stay)
  VALUES (org, 'Apartment', 'nights', '15:00', '11:00', 1, 'client_picks', true, 10, 32000, 'per_unit', 'space', 1) RETURNING id INTO apt;
  INSERT INTO rental_offerings (org_id, name, range_mode, start_time, end_time, turnover_days, unit_selection, active, sort_order, price_cents, pricing_mode, kind, min_stay)
  VALUES (org, 'Camera kit', 'days', '09:00', '18:00', 0, 'auto', true, 11, 15000, 'per_unit', 'space', 1) RETURNING id INTO kit;
  INSERT INTO rental_units (org_id, offering_id, name, sort_order) VALUES (org, apt, '101', 0) RETURNING id INTO a101;
  INSERT INTO rental_units (org_id, offering_id, name, sort_order) VALUES (org, apt, '102', 1) RETURNING id INTO a102;
  INSERT INTO rental_units (org_id, offering_id, name, sort_order) VALUES (org, apt, '103', 2) RETURNING id INTO a103;
  INSERT INTO rental_units (org_id, offering_id, name, sort_order) VALUES (org, kit, 'Kit A', 0) RETURNING id INTO kA;
  INSERT INTO rental_units (org_id, offering_id, name, sort_order) VALUES (org, kit, 'Kit B', 1) RETURNING id INTO kB;

  -- nights: check-in 15:00, check-out 11:00 local
  INSERT INTO bookings (org_id, rental_offering_id, rental_unit_id, client_name, client_email, starts_at, ends_at, status, cancel_token_hash, note, price_cents, currency, hold_expires_at) VALUES
   (org, apt, a101, 'TLQA Anna Kowalska', 'anna@example.com', ('2026-09-01 15:00'::timestamp AT TIME ZONE tz), ('2026-09-04 11:00'::timestamp AT TIME ZONE tz), 'confirmed', md5(random()::text), NULL, 96000, 'PLN', NULL),
   (org, apt, a101, 'TLQA Marek Nowak', 'marek@example.com', ('2026-09-07 15:00'::timestamp AT TIME ZONE tz), ('2026-09-11 11:00'::timestamp AT TIME ZONE tz), 'confirmed', md5(random()::text), 'Late arrival, around 22:00', 128000, 'PLN', NULL),
   (org, apt, a101, 'TLQA Jan Wiśniewski', 'jan@example.com', ('2026-09-12 15:00'::timestamp AT TIME ZONE tz), ('2026-09-15 11:00'::timestamp AT TIME ZONE tz), 'confirmed', md5(random()::text), NULL, 96000, 'PLN', NULL),
   (org, apt, a101, 'TLQA Ola Zielińska', 'ola@example.com', ('2026-09-15 15:00'::timestamp AT TIME ZONE tz), ('2026-09-18 11:00'::timestamp AT TIME ZONE tz), 'confirmed', md5(random()::text), NULL, 96000, 'PLN', NULL),
   (org, apt, a102, 'TLQA Ewa Lis', 'ewa@example.com', ('2026-09-12 15:00'::timestamp AT TIME ZONE tz), ('2026-10-10 11:00'::timestamp AT TIME ZONE tz), 'pending', md5(random()::text), 'Long stay request', 1120000, 'PLN', NULL),
   (org, apt, a103, 'TLQA Nina Bąk', 'nina@example.com', ('2026-08-28 15:00'::timestamp AT TIME ZONE tz), ('2026-09-03 11:00'::timestamp AT TIME ZONE tz), 'confirmed', md5(random()::text), NULL, 192000, 'PLN', NULL),
   (org, apt, a103, 'TLQA Tomasz Kot', 'tomasz@example.com', ('2026-09-18 15:00'::timestamp AT TIME ZONE tz), ('2026-09-20 11:00'::timestamp AT TIME ZONE tz), 'pending_payment', md5(random()::text), NULL, 64000, 'PLN', now() + interval '6 hours'),
   (org, apt, a103, 'TLQA Kasia Mazur', 'kasia@example.com', ('2026-09-24 15:00'::timestamp AT TIME ZONE tz), ('2026-09-27 11:00'::timestamp AT TIME ZONE tz), 'confirmed', md5(random()::text), NULL, 96000, 'PLN', NULL),
   (org, apt, a103, 'TLQA Bartek Sowa', NULL, ('2026-10-02 15:00'::timestamp AT TIME ZONE tz), ('2026-10-05 11:00'::timestamp AT TIME ZONE tz), 'confirmed', md5(random()::text), NULL, 96000, 'PLN', NULL),
  -- days: pickup 09:00, return 18:00 (return day inclusive)
   (org, kit, kA, 'TLQA Studio Lumen', 'lumen@example.com', ('2026-09-10 09:00'::timestamp AT TIME ZONE tz), ('2026-09-12 18:00'::timestamp AT TIME ZONE tz), 'confirmed', md5(random()::text), NULL, 45000, 'PLN', NULL),
   (org, kit, kA, 'TLQA Piotr Bal', 'piotr@example.com', ('2026-09-16 09:00'::timestamp AT TIME ZONE tz), ('2026-09-16 18:00'::timestamp AT TIME ZONE tz), 'confirmed', md5(random()::text), NULL, 15000, 'PLN', NULL),
   (org, kit, kA, 'TLQA Agencja Fokus', 'fokus@example.com', ('2026-09-21 09:00'::timestamp AT TIME ZONE tz), ('2026-09-25 18:00'::timestamp AT TIME ZONE tz), 'confirmed', md5(random()::text), NULL, 75000, 'PLN', NULL);

  INSERT INTO rental_unit_blackouts (org_id, rental_unit_id, start_date, end_date, reason) VALUES
   (org, a102, '2026-09-20', '2026-09-22', 'TLQA Painting'),
   (org, kB,   '2026-09-08', '2026-09-30', 'TLQA Repair');
END $$;
