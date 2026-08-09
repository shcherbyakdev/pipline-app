import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
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
