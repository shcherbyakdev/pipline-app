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
    // Free text, no payments at MVP (services.price_label idiom).
    priceLabel: text("price_label"),
    // 'nights' | 'days' — CHECK in 0037.
    rangeMode: text("range_mode").notNull(),
    // Org-local "HH:MM": check-in/check-out (nights) or pickup/return (days).
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    // Counted in nights or days per range_mode.
    minStay: integer("min_stay").default(1).notNull(),
    maxStay: integer("max_stay"),
    // Days blocked after each stay ends (cleaning). Engine/RPC concern.
    turnoverDays: integer("turnover_days").default(0).notNull(),
    minNoticeDays: integer("min_notice_days").default(0).notNull(),
    bookingWindowDays: integer("booking_window_days").default(180).notNull(),
    // 'auto' | 'client_picks' — CHECK in 0037.
    unitSelection: text("unit_selection").default("auto").notNull(),
    active: boolean("active").default(true).notNull(),
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
