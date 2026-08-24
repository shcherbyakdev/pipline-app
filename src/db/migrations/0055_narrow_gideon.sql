ALTER TABLE "rental_offerings" ALTER COLUMN "start_time" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "rental_offerings" ALTER COLUMN "end_time" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD COLUMN "rental_offering_id" uuid;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD COLUMN "rental_offering_id" uuid;--> statement-breakpoint
ALTER TABLE "rental_offerings" ADD COLUMN "slot_increment_min" integer;--> statement-breakpoint
ALTER TABLE "rental_offerings" ADD COLUMN "min_duration_min" integer;--> statement-breakpoint
ALTER TABLE "rental_offerings" ADD COLUMN "max_duration_min" integer;--> statement-breakpoint
ALTER TABLE "rental_offerings" ADD COLUMN "turnover_min" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rental_offerings" ADD COLUMN "min_notice_min" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_rental_offering_id_rental_offerings_id_fk" FOREIGN KEY ("rental_offering_id") REFERENCES "public"."rental_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_rental_offering_id_rental_offerings_id_fk" FOREIGN KEY ("rental_offering_id") REFERENCES "public"."rental_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "availability_exceptions_offering_date_idx" ON "availability_exceptions" USING btree ("rental_offering_id","date");--> statement-breakpoint
CREATE INDEX "availability_rules_offering_weekday_idx" ON "availability_rules" USING btree ("rental_offering_id","weekday");