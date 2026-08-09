CREATE TABLE "template_stage_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_stage_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_stage_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_stage_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"required" boolean NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_stage_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_stage_id" uuid NOT NULL,
	"program_stage_requirement_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"type" text NOT NULL,
	"value_text" text,
	"value_number" numeric,
	"value_bool" boolean,
	"value_date" date,
	"answered_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_stage_responses_stage_requirement_uq" UNIQUE("unit_stage_id","program_stage_requirement_id")
);
--> statement-breakpoint
ALTER TABLE "unit_stages" ADD COLUMN "done_source" text;--> statement-breakpoint
ALTER TABLE "template_stage_requirements" ADD CONSTRAINT "template_stage_requirements_template_stage_id_template_stages_id_fk" FOREIGN KEY ("template_stage_id") REFERENCES "public"."template_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_stage_requirements" ADD CONSTRAINT "template_stage_requirements_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_stage_requirements" ADD CONSTRAINT "program_stage_requirements_program_stage_id_program_stages_id_fk" FOREIGN KEY ("program_stage_id") REFERENCES "public"."program_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_stage_requirements" ADD CONSTRAINT "program_stage_requirements_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_stage_requirements" ADD CONSTRAINT "program_stage_requirements_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_stage_responses" ADD CONSTRAINT "unit_stage_responses_unit_stage_id_unit_stages_id_fk" FOREIGN KEY ("unit_stage_id") REFERENCES "public"."unit_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_stage_responses" ADD CONSTRAINT "unit_stage_responses_program_stage_requirement_id_program_stage_requirements_id_fk" FOREIGN KEY ("program_stage_requirement_id") REFERENCES "public"."program_stage_requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_stage_responses" ADD CONSTRAINT "unit_stage_responses_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_stage_responses" ADD CONSTRAINT "unit_stage_responses_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_stage_responses" ADD CONSTRAINT "unit_stage_responses_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "template_stage_requirements_template_stage_id_idx" ON "template_stage_requirements" USING btree ("template_stage_id");--> statement-breakpoint
CREATE INDEX "template_stage_requirements_org_id_idx" ON "template_stage_requirements" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "program_stage_requirements_program_stage_id_idx" ON "program_stage_requirements" USING btree ("program_stage_id");--> statement-breakpoint
CREATE INDEX "program_stage_requirements_program_id_idx" ON "program_stage_requirements" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "program_stage_requirements_org_id_idx" ON "program_stage_requirements" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "unit_stage_responses_unit_stage_id_idx" ON "unit_stage_responses" USING btree ("unit_stage_id");--> statement-breakpoint
CREATE INDEX "unit_stage_responses_requirement_id_idx" ON "unit_stage_responses" USING btree ("program_stage_requirement_id");--> statement-breakpoint
CREATE INDEX "unit_stage_responses_unit_id_idx" ON "unit_stage_responses" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "unit_stage_responses_program_id_idx" ON "unit_stage_responses" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "unit_stage_responses_org_id_idx" ON "unit_stage_responses" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "unit_stage_responses_value_date_idx" ON "unit_stage_responses" USING btree ("value_date");