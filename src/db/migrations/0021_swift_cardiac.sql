CREATE TABLE "unit_stage_response_archive" (
	"id" uuid PRIMARY KEY NOT NULL,
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
	"answered_by_participant_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_tokens" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chases" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "template_stage_requirements" ADD COLUMN "recur_lead_days" integer;--> statement-breakpoint
ALTER TABLE "program_stage_requirements" ADD COLUMN "recur_lead_days" integer;--> statement-breakpoint
ALTER TABLE "unit_stages" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "unit_stage_response_archive" ADD CONSTRAINT "unit_stage_response_archive_unit_stage_id_unit_stages_id_fk" FOREIGN KEY ("unit_stage_id") REFERENCES "public"."unit_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_stage_response_archive" ADD CONSTRAINT "unit_stage_response_archive_program_stage_requirement_id_program_stage_requirements_id_fk" FOREIGN KEY ("program_stage_requirement_id") REFERENCES "public"."program_stage_requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_stage_response_archive" ADD CONSTRAINT "unit_stage_response_archive_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_stage_response_archive" ADD CONSTRAINT "unit_stage_response_archive_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_stage_response_archive" ADD CONSTRAINT "unit_stage_response_archive_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usr_archive_unit_stage_id_idx" ON "unit_stage_response_archive" USING btree ("unit_stage_id");--> statement-breakpoint
CREATE INDEX "usr_archive_unit_id_idx" ON "unit_stage_response_archive" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "usr_archive_org_id_idx" ON "unit_stage_response_archive" USING btree ("org_id");