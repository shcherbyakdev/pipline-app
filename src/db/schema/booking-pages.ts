import { pgTable, uuid, jsonb, timestamp } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// One booking page per org (spec 2026-08-23-booking-page-builder). `draft`
// is what the studio edits, `published` what /book/[handle] renders (null =
// never published → the page renders the default composition). Both are
// validated documents (features/booking-page/schema.ts); the renderer still
// safeParses them. Written ONLY via the save/publish/discard definer RPCs in
// 0048 — members may select their own row, nothing more.
export const bookingPages = pgTable("booking_pages", {
  orgId: uuid("org_id").primaryKey().references(() => orgs.id, { onDelete: "cascade" }),
  draft: jsonb("draft").notNull(),
  published: jsonb("published"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
