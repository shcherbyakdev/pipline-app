import { pgTable, uuid, jsonb, text, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// One booking page per CHANNEL an org sells (spec 2026-08-28 §2; one per org
// before 0059). `channel` is 'appointments' | 'spaces' (CHECK in 0060). `draft`
// is what the studio edits, `published` what /[handle] and /[handle]/spaces
// render (null = never published → the default composition). Both are
// validated documents (features/booking-page/schema.ts); the renderer still
// safeParses them. Written ONLY via the save/publish/discard definer RPCs
// (0060) — members may select their own rows, nothing more. The column
// default is harmless (only the RPCs write, and they always name the
// channel); it exists so 0059 could add the column to filled tables.
export const bookingPages = pgTable(
  "booking_pages",
  {
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    channel: text("channel").notNull().default("appointments"),
    draft: jsonb("draft").notNull(),
    published: jsonb("published"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.channel] })],
);
