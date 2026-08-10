import { pgTable, uuid, text, integer, timestamp, index, boolean, jsonb } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// Workflow templates. Programs will COPY a template's stages at creation
// (copy-on-use), so templates stay freely editable and hard-deletable.
export const templates = pgTable(
  "templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("templates_org_id_idx").on(t.orgId)],
);

export const templateStages = pgTable(
  "template_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => templates.id, { onDelete: "cascade" }),
    // Denormalized tenant key: every domain row carries org_id for RLS.
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // App-managed ordering. Gaps are allowed (deletes leave them; the
    // reorder RPC rewrites 0..n-1). Always read with ORDER BY position, id.
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("template_stages_template_id_idx").on(t.templateId),
    index("template_stages_org_id_idx").on(t.orgId),
  ],
);

// Typed requirements a stage collects. Freely editable with the template;
// programs snapshot them (create_program), so edits never leak into runs.
// `type` CHECK and all policies/grants live in 0011 (custom SQL).
export const templateStageRequirements = pgTable(
  "template_stage_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateStageId: uuid("template_stage_id")
      .notNull()
      .references(() => templateStages.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // 'text'|'number'|'boolean'|'date'|'choice'|'checklist'|'photo'
    type: text("type").notNull(),
    label: text("label").notNull(),
    required: boolean("required").notNull().default(true),
    // {options: string[]} for choice, {items: string[]} for checklist, else {}
    config: jsonb("config").notNull().default({}),
    // Per stage, 0..n-1; gaps allowed (reorder RPC rewrites). ORDER BY position, id.
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("template_stage_requirements_template_stage_id_idx").on(t.templateStageId),
    index("template_stage_requirements_org_id_idx").on(t.orgId),
  ],
);
