CREATE TABLE "chases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"unit_id" uuid,
	"sends_done" integer DEFAULT 0 NOT NULL,
	"next_send_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_tokens" ADD COLUMN "chase_id" uuid;--> statement-breakpoint
ALTER TABLE "chases" ADD CONSTRAINT "chases_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chases" ADD CONSTRAINT "chases_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chases" ADD CONSTRAINT "chases_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chases" ADD CONSTRAINT "chases_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chases_org_id_idx" ON "chases" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "chases_participant_id_idx" ON "chases" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "chases_program_id_idx" ON "chases" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "chases_unit_id_idx" ON "chases" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "access_tokens_chase_id_idx" ON "access_tokens" USING btree ("chase_id");