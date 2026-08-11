import { pgTable, uuid, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { programs, units } from "./programs";
import { participants } from "./participants";

// One row = one chase: the automated email cadence for one participant-token
// scope (participant, program, unit?; null unit = every assigned unit).
// Terminal states: completed_at (work done), stopped_at (opted out), or
// sends_done = 4 with next_send_at null (exhausted). RLS, grants, the
// partial-unique "one live chase per scope" index, the org-guard trigger,
// and the three chase RPCs live in the 0020 custom migration (0013 idiom).
export const chases = pgTable(
  "chases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    // null ⇒ every unit currently assigned to the participant
    unitId: uuid("unit_id").references(() => units.id, { onDelete: "cascade" }),
    sendsDone: integer("sends_done").notNull().default(0),
    // null = nothing scheduled (exhausted). Derived from created_at +
    // CHASE_OFFSET_DAYS[sends_done]; materialized only so the due-scan
    // stays indexable.
    nextSendAt: timestamp("next_send_at", { withTimezone: true }),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastError: text("last_error"),
    attemptCount: integer("attempt_count").notNull().default(0),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("chases_org_id_idx").on(t.orgId),
    index("chases_participant_id_idx").on(t.participantId),
    index("chases_program_id_idx").on(t.programId),
    index("chases_unit_id_idx").on(t.unitId),
  ],
);
