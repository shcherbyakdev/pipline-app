CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"unit_stage_id" uuid NOT NULL,
	"response_id" uuid,
	"provider" text DEFAULT 'supabase' NOT NULL,
	"path" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum_sha256" text NOT NULL,
	"uploaded_by_participant_id" uuid,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_unit_stage_id_unit_stages_id_fk" FOREIGN KEY ("unit_stage_id") REFERENCES "public"."unit_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_response_id_unit_stage_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."unit_stage_responses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_uploaded_by_participant_id_participants_id_fk" FOREIGN KEY ("uploaded_by_participant_id") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_org_id_idx" ON "evidence" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "evidence_unit_id_idx" ON "evidence" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "evidence_unit_stage_id_idx" ON "evidence" USING btree ("unit_stage_id");--> statement-breakpoint
CREATE INDEX "evidence_response_id_idx" ON "evidence" USING btree ("response_id");