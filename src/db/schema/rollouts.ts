import { pgTable, uuid, text, integer, timestamp, index, unique } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { templates } from "./templates";

// One execution of a template's workflow across many units. Creating a
// rollout SNAPSHOTS the template's stages (copy-on-use); the snapshot is
// immutable and the template link is provenance only.
export const rollouts = pgTable(
  "rollouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // Provenance only — the snapshot carries all load-bearing data, so a
    // deleted template leaves the rollout intact with template_id null.
    templateId: uuid("template_id").references(() => templates.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    // Set app-side by renameRollout; list ordering uses created_at.
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("rollouts_org_id_idx").on(t.orgId), index("rollouts_template_id_idx").on(t.templateId)],
);

// The frozen copy. Written only inside the create_rollout RPC; API roles
// hold select-only grants, so no client write path exists at any layer.
export const rolloutStages = pgTable(
  "rollout_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rolloutId: uuid("rollout_id")
      .notNull()
      .references(() => rollouts.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(), // contiguous 0..n-1, written once by the RPC
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("rollout_stages_rollout_id_idx").on(t.rolloutId),
    index("rollout_stages_org_id_idx").on(t.orgId),
  ],
);

export const units = pgTable(
  "units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rolloutId: uuid("rollout_id")
      .notNull()
      .references(() => rollouts.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // The customer's own identifier (store number, VIN, site code); CSV
    // import will key on it next slice.
    externalRef: text("external_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("units_rollout_id_idx").on(t.rolloutId), index("units_org_id_idx").on(t.orgId)],
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
    rolloutStageId: uuid("rollout_stage_id")
      .notNull()
      .references(() => rolloutStages.id, { onDelete: "cascade" }),
    // Denormalized for PostgREST embeds and per-rollout counts.
    rolloutId: uuid("rollout_id")
      .notNull()
      .references(() => rollouts.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // 'pending' | 'done' — CHECK lives in 0008 (custom SQL keeps it and the
    // grants/policies in one reviewable place).
    status: text("status").notNull().default("pending"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("unit_stages_unit_stage_uq").on(t.unitId, t.rolloutStageId),
    index("unit_stages_unit_id_idx").on(t.unitId),
    index("unit_stages_rollout_stage_id_idx").on(t.rolloutStageId),
    index("unit_stages_rollout_id_idx").on(t.rolloutId),
    index("unit_stages_org_id_idx").on(t.orgId),
  ],
);
