import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { programs, units } from "./programs";
import { clients } from "./clients";

// External people — installers, engineers, site contacts. NEVER auth users:
// the product must never force accounts on external collaborators.
export const participants = pgTable(
  "participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("participants_org_id_idx").on(t.orgId)],
);

// Scoped signed links. The raw token is NEVER stored — only its sha256 hex.
// kind CHECK, the participant-scope CHECK, RLS, grants, and the org-guard
// trigger all live in 0013 (custom SQL keeps them in one reviewable place).
export const accessTokens = pgTable(
  "access_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    // 'participant' | 'portal' (portal arrives in slice 9)
    kind: text("kind").notNull(),
    participantId: uuid("participant_id").references(() => participants.id, {
      onDelete: "cascade",
    }),
    // Portal tokens only (kind='portal'); CHECK in 0018 keeps the two kinds'
    // scope columns mutually exclusive. Cascade: when the client goes, its
    // link history goes with it (the participants precedent).
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    programId: uuid("program_id").references(() => programs.id, { onDelete: "cascade" }),
    // null ⇒ every unit currently assigned to the participant
    unitId: uuid("unit_id").references(() => units.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("access_tokens_token_hash_uq").on(t.tokenHash),
    index("access_tokens_org_id_idx").on(t.orgId),
    index("access_tokens_participant_id_idx").on(t.participantId),
    index("access_tokens_client_id_idx").on(t.clientId),
    index("access_tokens_program_id_idx").on(t.programId),
    index("access_tokens_unit_id_idx").on(t.unitId),
  ],
);
