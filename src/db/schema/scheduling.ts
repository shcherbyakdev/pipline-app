import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  date,
  index,
  uniqueIndex,
  primaryKey,
  jsonb,
} from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { clients } from "./clients";
import { rentalOfferings, rentalUnits } from "./rentals";

// Scheduling pivot (S1). CHECKs, RLS, grants, the EXCLUDE double-book guard,
// triggers, and RPCs all live in 0026 (custom SQL keeps the security surface
// in one reviewable place — the 0013 idiom).

// Team slice (2026-08-17 spec): a bookable person. Every org has ≥1 row (the
// creator's, seeded by create_org / backfilled by 0041). Solo = exactly one
// active row — every UI hides the staff layer at that count. CHECKs, RLS,
// grants, triggers, guard rebuilds and RPCs live in 0041 (0037 idiom).
export const staff = pgTable(
  "staff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Public URL segment: /book/[handle]/[slug]. Format CHECK in 0041.
    slug: text("slug").notNull(),
    // Optional; only for staff notices. Never exposed to anon.
    email: text("email"),
    // Hex "#rrggbb" — CHECK in 0041. Calendar/event accent.
    color: text("color").notNull(),
    active: boolean("active").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    // Reserved for the staff-login slice; unused here. References auth.users.
    userId: uuid("user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("staff_org_id_idx").on(t.orgId),
    index("staff_org_active_sort_idx").on(t.orgId, t.active, t.sortOrder),
    uniqueIndex("staff_org_slug_uq").on(t.orgId, t.slug),
    uniqueIndex("staff_user_id_uq").on(t.userId),
  ],
);

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    durationMin: integer("duration_min").notNull(),
    // Free text ("€80", "80 € / Stunde") — no payments at MVP.
    priceLabel: text("price_label"),
    bufferBeforeMin: integer("buffer_before_min").default(0).notNull(),
    bufferAfterMin: integer("buffer_after_min").default(0).notNull(),
    minNoticeMin: integer("min_notice_min").default(0).notNull(),
    // null = unlimited bookings per day.
    maxPerDay: integer("max_per_day"),
    bookingWindowDays: integer("booking_window_days").default(60).notNull(),
    active: boolean("active").default(true).notNull(),
    // Approval feature: when true, public creates insert status='pending'
    // instead of 'confirmed' (0062). Admin walk-ins ignore it.
    requiresApproval: boolean("requires_approval").default(false).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("services_org_id_idx").on(t.orgId)],
);

// Which staff offer which service. All-assigned by default (actions fan out
// on create in both directions). Org-consistency trigger in 0041.
export const serviceStaff = pgTable(
  "service_staff",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.serviceId, t.staffId] }),
    index("service_staff_staff_id_idx").on(t.staffId),
    index("service_staff_org_id_idx").on(t.orgId),
  ],
);

export const availabilityRules = pgTable(
  "availability_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // Team slice: nullable in 0040, backfilled + NOT NULL in 0041.
    staffId: uuid("staff_id").references(() => staff.id, { onDelete: "cascade" }),
    // H2: owner is staff XOR rental offering (CHECK in 0056; 0041's staff
    // NOT NULL is dropped there).
    rentalOfferingId: uuid("rental_offering_id").references(() => rentalOfferings.id, {
      onDelete: "cascade",
    }),
    // 0 = Sunday … 6 = Saturday (JS getUTCDay convention). CHECK in 0026.
    weekday: integer("weekday").notNull(),
    // Org-local wall-clock "HH:MM". Format CHECK in 0026. The slot engine
    // converts to UTC per concrete date (DST-safe) — a `time` column would
    // not carry more meaning and complicates the pure-function inputs.
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("availability_rules_org_id_idx").on(t.orgId),
    index("availability_rules_staff_weekday_idx").on(t.staffId, t.weekday),
    index("availability_rules_offering_weekday_idx").on(t.rentalOfferingId, t.weekday),
  ],
);

export const availabilityExceptions = pgTable(
  "availability_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // Team slice: nullable in 0040, backfilled + NOT NULL in 0041.
    staffId: uuid("staff_id").references(() => staff.id, { onDelete: "cascade" }),
    // H2: owner is staff XOR rental offering (CHECK in 0056; 0041's staff
    // NOT NULL is dropped there).
    rentalOfferingId: uuid("rental_offering_id").references(() => rentalOfferings.id, {
      onDelete: "cascade",
    }),
    // Org-local calendar date the exception applies to.
    date: date("date").notNull(),
    // closed=true ⇒ whole day off (start/end null). closed=false ⇒ this
    // window REPLACES the weekday rules for that date. CHECK in 0026.
    closed: boolean("closed").default(true).notNull(),
    startTime: text("start_time"),
    endTime: text("end_time"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("availability_exceptions_org_date_idx").on(t.orgId, t.date),
    index("availability_exceptions_staff_date_idx").on(t.staffId, t.date),
    index("availability_exceptions_offering_date_idx").on(t.rentalOfferingId, t.date),
  ],
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // Nullable since R1: exactly one of service_id / rental_offering_id is
    // set (CHECK bookings_kind in 0037).
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "restrict" }),
    // Rentals R1: set together (CHECK bookings_unit_iff_rental in 0037).
    rentalOfferingId: uuid("rental_offering_id").references(() => rentalOfferings.id, {
      onDelete: "restrict",
    }),
    rentalUnitId: uuid("rental_unit_id").references(() => rentalUnits.id, {
      onDelete: "restrict",
    }),
    // Team slice: set iff service_id is set (CHECK bookings_staff_iff_service,
    // 0041). Restrict: a staff row with history can only be deactivated.
    staffId: uuid("staff_id").references(() => staff.id, { onDelete: "restrict" }),
    // set null: a booking is a historical record that survives client
    // deletion — the denormalized name/email below keep it self-contained.
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    clientName: text("client_name").notNull(),
    // nullable since admin walk-ins (calendar slice)
    clientEmail: text("client_email"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    // 'confirmed' | 'pending' | 'pending_payment' | 'declined' | 'expired' |
    // 'cancelled_by_client' | 'cancelled_by_provider' | 'rescheduled' —
    // CHECK in 0079 (was 0062, 0026). The EXCLUDE guards cover 'confirmed',
    // 'pending' AND 'pending_payment' (0079): a request and a payment hold
    // both reserve their slot. 'expired' is a lapsed hold the drain wrote
    // (S2); a pending request past its starts_at is still computed, never
    // stored.
    status: text("status").default("confirmed").notNull(),
    // sha256 hex of the manage token (mint.ts idiom). The raw token is
    // returned once from create_booking's caller and never stored.
    cancelTokenHash: text("cancel_token_hash").notNull(),
    note: text("note"),
    // Provider's optional message stamped at decline time (CHECK <= 500, 0062).
    declineNote: text("decline_note"),
    // H3 money snapshot, computed inside the rental RPCs at (re)booking
    // time. NULL for appointments and pre-H3 rows; historical record —
    // later offering/currency edits never rewrite it.
    priceCents: integer("price_cents"),
    currency: text("currency"),
    depositCents: integer("deposit_cents"),
    // S1: the itemised quote the booking was made at (price_cents = sum)
    // and the people count the client chose; NULL before 0078 / no rules.
    lines: jsonb("lines"),
    people: integer("people"),
    // S2: the hold's deadline (set iff status = 'pending_payment', kept after
    // the flip), and what the client paid / got back — written only by the
    // payment RPCs and the refund path. Never TS-computed for display.
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    paidCents: integer("paid_cents").default(0).notNull(),
    refundedCents: integer("refunded_cents").default(0).notNull(),
    // S3: the policy the client accepted (snapshot, filled by the carry
    // trigger) and the consequence incurred — never TS-computed for display.
    cancelPolicy: jsonb("cancel_policy"),
    feeCents: integer("fee_cents").default(0).notNull(),
    // Stamped by the public create RPCs iff the offering had terms_text;
    // carried forward across reschedules.
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
    // Self-FK deferred to 0026 (drizzle self-reference needs AnyPgColumn
    // gymnastics; the deferred-FK idiom from access_tokens.chase_id is
    // simpler and established).
    rescheduledFromId: uuid("rescheduled_from_id"),
    // Reminder drain state (chasing idiom, S2). reminder_sent_at doubles as
    // the claim marker: set-before-send, rolled back on transport failure.
    // Suppressed reminders (booked <24h ahead) are stamped too — the drain
    // scan (partial index in 0028) only ever sees NULLs.
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    reminderAttempts: integer("reminder_attempts").default(0).notNull(),
    reminderLastError: text("reminder_last_error"),
    // The language the CLIENT booked in (0072). NULL = the org's language,
    // which is every admin-made booking and every row written before this
    // column existed. Read by the client-facing mails and the manage page;
    // provider and staff notices always stay on orgs.locale.
    locale: text("locale"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("bookings_org_id_idx").on(t.orgId),
    index("bookings_org_starts_at_idx").on(t.orgId, t.startsAt),
    index("bookings_service_id_idx").on(t.serviceId),
    index("bookings_client_id_idx").on(t.clientId),
    index("bookings_rental_unit_starts_at_idx").on(t.rentalUnitId, t.startsAt),
    // The space page lists a space's stays (listOfferingBookings) by offering,
    // not by unit — without this the read scans the org's whole history.
    index("bookings_rental_offering_starts_at_idx").on(t.rentalOfferingId, t.startsAt),
    index("bookings_staff_starts_at_idx").on(t.staffId, t.startsAt),
    uniqueIndex("bookings_cancel_token_hash_uq").on(t.cancelTokenHash),
  ],
);
