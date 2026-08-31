import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  date,
  index,
} from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// Rentals R1. CHECKs, RLS, grants, guards, triggers and RPCs live in the
// custom migrations 0037/0038 (0026 idiom: security surface in reviewable
// SQL). Table names are prefixed `rental_` because the legacy fire-safety
// schema already owns `units`.

export const rentalOfferings = pgTable(
  "rental_offerings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    // H3 money + policy (CHECKs in 0058). NULL price = unpriced offering —
    // every money surface collapses to the pre-H3 rendering.
    priceCents: integer("price_cents"),
    // 'per_unit' | 'flat' — per_unit reads hour/night/day from range_mode.
    pricingMode: text("pricing_mode").default("per_unit").notNull(),
    // 'none' | 'fixed' | 'percent' | 'full'.
    depositType: text("deposit_type").default("none").notNull(),
    // Cents (fixed) or whole percent 1–100 (percent); NULL otherwise.
    depositValue: integer("deposit_value"),
    // 0 = self-cancel until start. Stored minutes (min_notice_min idiom).
    cancelWindowMin: integer("cancel_window_min").default(0).notNull(),
    // House rules; public flows require a checkbox iff set.
    termsText: text("terms_text"),
    // 'nights' | 'days' — CHECK in 0037.
    rangeMode: text("range_mode").notNull(),
    // Org-local "HH:MM": check-in/check-out (nights) or pickup/return (days).
    // NULL in hours mode (H2) — CHECK in 0056 pins NOT NULL to nights/days.
    startTime: text("start_time"),
    endTime: text("end_time"),
    // Counted in nights or days per range_mode.
    minStay: integer("min_stay").default(1).notNull(),
    maxStay: integer("max_stay"),
    // Days blocked after each stay ends (cleaning). Engine/RPC concern.
    turnoverDays: integer("turnover_days").default(0).notNull(),
    minNoticeDays: integer("min_notice_days").default(0).notNull(),
    bookingWindowDays: integer("booking_window_days").default(180).notNull(),
    // Hours mode (H2). NULL for nights/days; the trio NOT NULL iff
    // range_mode='hours' (CHECK in 0056).
    slotIncrementMin: integer("slot_increment_min"),
    minDurationMin: integer("min_duration_min"),
    maxDurationMin: integer("max_duration_min"),
    // Minutes-granularity siblings of turnover_days/min_notice_days, used
    // only in hours mode (min_notice_min mirrors services.min_notice_min).
    turnoverMin: integer("turnover_min").default(0).notNull(),
    minNoticeMin: integer("min_notice_min").default(0).notNull(),
    // 'auto' | 'client_picks' — CHECK in 0037.
    unitSelection: text("unit_selection").default("auto").notNull(),
    active: boolean("active").default(true).notNull(),
    // Approval feature (0062): public creates insert status='pending'.
    requiresApproval: boolean("requires_approval").default(false).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("rental_offerings_org_id_idx").on(t.orgId)],
);

export const rentalUnits = pgTable(
  "rental_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    offeringId: uuid("offering_id")
      .notNull()
      .references(() => rentalOfferings.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    active: boolean("active").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("rental_units_offering_id_idx").on(t.offeringId),
    index("rental_units_org_id_idx").on(t.orgId),
  ],
);

export const rentalUnitBlackouts = pgTable(
  "rental_unit_blackouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    rentalUnitId: uuid("rental_unit_id")
      .notNull()
      .references(() => rentalUnits.id, { onDelete: "cascade" }),
    // Org-local calendar dates, both inclusive. CHECK end >= start in 0037.
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("rental_unit_blackouts_unit_start_idx").on(t.rentalUnitId, t.startDate)],
);
