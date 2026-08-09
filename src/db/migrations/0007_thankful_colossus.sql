CREATE TABLE "unit_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"rollout_stage_id" uuid NOT NULL,
	"rollout_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_stages_unit_stage_uq" UNIQUE("unit_id","rollout_stage_id")
);
--> statement-breakpoint
ALTER TABLE "unit_stages" ADD CONSTRAINT "unit_stages_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_stages" ADD CONSTRAINT "unit_stages_rollout_stage_id_rollout_stages_id_fk" FOREIGN KEY ("rollout_stage_id") REFERENCES "public"."rollout_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_stages" ADD CONSTRAINT "unit_stages_rollout_id_rollouts_id_fk" FOREIGN KEY ("rollout_id") REFERENCES "public"."rollouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_stages" ADD CONSTRAINT "unit_stages_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "unit_stages_unit_id_idx" ON "unit_stages" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "unit_stages_rollout_stage_id_idx" ON "unit_stages" USING btree ("rollout_stage_id");--> statement-breakpoint
CREATE INDEX "unit_stages_rollout_id_idx" ON "unit_stages" USING btree ("rollout_id");--> statement-breakpoint
CREATE INDEX "unit_stages_org_id_idx" ON "unit_stages" USING btree ("org_id");