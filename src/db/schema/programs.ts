import { pgTable, uuid, text, integer, timestamp, index, unique, boolean, jsonb, numeric, date } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { templates } from "./templates";
import { clients } from "./clients";

// One execution of a template's workflow across many units. Creating a
// program SNAPSHOTS the template's stages (copy-on-use); the snapshot is
// immutable and the template link is provenance only.
export const programs = pgTable(
  "programs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // Provenance only — the snapshot carries all load-bearing data, so a
    // deleted template leaves the program intact with template_id null.
    templateId: uuid("template_id").references(() => templates.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    // Set app-side by renameProgram; list ordering uses created_at.
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("programs_org_id_idx").on(t.orgId), index("programs_template_id_idx").on(t.templateId)],
);

// The frozen copy. Written only inside the create_program RPC; API roles
// hold select-only grants, so no client write path exists at any layer.
export const programStages = pgTable(
  "program_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(), // contiguous 0..n-1, written once by the RPC
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("program_stages_program_id_idx").on(t.programId),
    index("program_stages_org_id_idx").on(t.orgId),
  ],
);

// The frozen requirement copy. Written only inside create_program (which
// also expands checklist requirements into per-item booleans); API roles
// hold select-only grants — the program_stages precedent.
export const programStageRequirements = pgTable(
  "program_stage_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programStageId: uuid("program_stage_id")
      .notNull()
      .references(() => programStages.id, { onDelete: "cascade" }),
    // Denormalized for PostgREST embeds and per-program reads.
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // 'text'|'number'|'boolean'|'date'|'choice'|'photo' — checklist expanded away
    type: text("type").notNull(),
    label: text("label").notNull(),
    required: boolean("required").notNull(),
    // {options} for choice; {group: <checklist label>} for expanded items
    config: jsonb("config").notNull().default({}),
    // Recurrence driver (slice 11): non-null on a date requirement means
    // "re-arm the stage this many days before value_date". CHECKs (positive;
    // date-only) live in 0022.
    recurLeadDays: integer("recur_lead_days"),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("program_stage_requirements_program_stage_id_idx").on(t.programStageId),
    index("program_stage_requirements_program_id_idx").on(t.programId),
    index("program_stage_requirements_org_id_idx").on(t.orgId),
  ],
);

export const units = pgTable(
  "units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // The customer's own identifier (store number, VIN, site code); CSV
    // import will key on it next slice.
    externalRef: text("external_ref"),
    // v1 assignment model: unit-level, one participant. Set-null keeps the
    // unit when a participant is deleted. Guard trigger in 0013 pins the
    // participant to the unit's org.
    assignedParticipantId: uuid("assigned_participant_id"),
    // The customer's customer this unit belongs to; scopes the portal.
    // Set-null keeps the unit (and its history) when a client is deleted.
    // Guard trigger in 0018 pins the client to the unit's org.
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("units_program_id_idx").on(t.programId),
    index("units_org_id_idx").on(t.orgId),
    index("units_assigned_participant_id_idx").on(t.assignedParticipantId),
    index("units_client_id_idx").on(t.clientId),
  ],
);

// One row per (unit × stage) — fanned out by the units AFTER INSERT trigger
// (see 0008), backfilled for pre-feature units. Clients may update ONLY
// `status` (column-scoped grant); `done_at` is trigger-maintained.
export const unitStages = pgTable(
  "unit_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    programStageId: uuid("program_stage_id")
      .notNull()
      .references(() => programStages.id, { onDelete: "cascade" }),
    // Denormalized for PostgREST embeds and per-program counts.
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // 'pending' | 'done' — CHECK lives in 0008 (custom SQL keeps it and the
    // grants/policies in one reviewable place).
    status: text("status").notNull().default("pending"),
    // 'requirements' (derived) | 'override' (staff said so) | null (pending).
    // No client grant — maintained only by 0011's triggers (the done_at pattern).
    doneSource: text("done_source"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    // Stamped ONLY by recur_rearm (slice 11) with the superseded driver's
    // value_date. Due/lapsed are derived from it at read time — no stored
    // status. No client grant; the definer RPC is the single writer.
    dueAt: timestamp("due_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("unit_stages_unit_stage_uq").on(t.unitId, t.programStageId),
    index("unit_stages_unit_id_idx").on(t.unitId),
    index("unit_stages_program_stage_id_idx").on(t.programStageId),
    index("unit_stages_program_id_idx").on(t.programId),
    index("unit_stages_org_id_idx").on(t.orgId),
  ],
);

// One answer per (unit_stage × requirement). Clients supply ONLY the id
// pair + one value column; a BEFORE trigger (0011) fills unit_id/
// program_id/org_id/type from the parent rows and validates the pair.
// The one-value-matching-type CHECK lives in 0011.
export const unitStageResponses = pgTable(
  "unit_stage_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    unitStageId: uuid("unit_stage_id")
      .notNull()
      .references(() => unitStages.id, { onDelete: "cascade" }),
    programStageRequirementId: uuid("program_stage_requirement_id")
      .notNull()
      .references(() => programStageRequirements.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    valueText: text("value_text"),
    valueNumber: numeric("value_number"),
    valueBool: boolean("value_bool"),
    valueDate: date("value_date"),
    answeredByUserId: uuid("answered_by_user_id"),
    // Set ONLY inside the participant RPCs (no client column grant on any
    // role); the prepare trigger nulls it on staff writes (attribution
    // symmetry — the audit trail never shows both).
    answeredByParticipantId: uuid("answered_by_participant_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("unit_stage_responses_stage_requirement_uq").on(
      t.unitStageId,
      t.programStageRequirementId,
    ),
    index("unit_stage_responses_unit_stage_id_idx").on(t.unitStageId),
    index("unit_stage_responses_requirement_id_idx").on(t.programStageRequirementId),
    index("unit_stage_responses_unit_id_idx").on(t.unitId),
    index("unit_stage_responses_program_id_idx").on(t.programId),
    index("unit_stage_responses_org_id_idx").on(t.orgId),
    // Recurrence (slice 11) scans expiry dates.
    index("unit_stage_responses_value_date_idx").on(t.valueDate),
  ],
);

// Previous rounds' answers, moved here verbatim by recur_rearm (slice 11).
// A separate table — NOT a flag column — so the live table keeps its
// (unit_stage, requirement) uniqueness and every PostgREST upsert path.
// Rows are history: member select only; the definer RPC is the only writer.
// One superseded_at value = one archived round.
export const unitStageResponseArchive = pgTable(
  "unit_stage_response_archive",
  {
    id: uuid("id").primaryKey(), // the archived response's original id
    unitStageId: uuid("unit_stage_id")
      .notNull()
      .references(() => unitStages.id, { onDelete: "cascade" }),
    programStageRequirementId: uuid("program_stage_requirement_id")
      .notNull()
      .references(() => programStageRequirements.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    valueText: text("value_text"),
    valueNumber: numeric("value_number"),
    valueBool: boolean("value_bool"),
    valueDate: date("value_date"),
    answeredByUserId: uuid("answered_by_user_id"),
    answeredByParticipantId: uuid("answered_by_participant_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("usr_archive_unit_stage_id_idx").on(t.unitStageId),
    index("usr_archive_unit_id_idx").on(t.unitId),
    index("usr_archive_org_id_idx").on(t.orgId),
  ],
);
