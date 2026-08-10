import { pgTable, uuid, text, timestamp, bigint, index } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { units, unitStages, unitStageResponses } from "./programs";
import { participants } from "./participants";

// Metadata only — the row is the compliance record; bytes live in the
// private `evidence` storage bucket at `path`. Rows are written ONLY by the
// definer RPCs in 0015 (no client insert/update/delete on either API role),
// so unlike access_tokens no org-guard trigger is needed: the RPC derives
// org/unit/stage from the resolved token scope, never from the caller.
export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    unitStageId: uuid("unit_stage_id")
      .notNull()
      .references(() => unitStages.id, { onDelete: "cascade" }),
    // Nullable by design: evidence survives its response (the audit trail);
    // photo satisfaction requires BOTH the response row and the link.
    responseId: uuid("response_id").references(() => unitStageResponses.id, {
      onDelete: "set null",
    }),
    // 'supabase' in v1; BYO providers post-v1. CHECK lives in 0015.
    provider: text("provider").notNull().default("supabase"),
    path: text("path").notNull(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    uploadedByParticipantId: uuid("uploaded_by_participant_id").references(
      () => participants.id,
      { onDelete: "set null" },
    ),
    // Staff upload path is post-v1; the column exists from day one (spec).
    uploadedByUserId: uuid("uploaded_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("evidence_org_id_idx").on(t.orgId),
    index("evidence_unit_id_idx").on(t.unitId),
    index("evidence_unit_stage_id_idx").on(t.unitStageId),
    index("evidence_response_id_idx").on(t.responseId),
  ],
);
