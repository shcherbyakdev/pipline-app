CREATE TABLE "service_staff" (
	"org_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	CONSTRAINT "service_staff_service_id_staff_id_pk" PRIMARY KEY("service_id","staff_id")
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"email" text,
	"color" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD COLUMN "staff_id" uuid;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD COLUMN "staff_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "staff_id" uuid;--> statement-breakpoint
ALTER TABLE "service_staff" ADD CONSTRAINT "service_staff_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_staff" ADD CONSTRAINT "service_staff_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_staff" ADD CONSTRAINT "service_staff_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_staff_staff_id_idx" ON "service_staff" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "service_staff_org_id_idx" ON "service_staff" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "staff_org_id_idx" ON "staff" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "staff_org_active_sort_idx" ON "staff" USING btree ("org_id","active","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_org_slug_uq" ON "staff" USING btree ("org_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_user_id_uq" ON "staff" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "availability_exceptions_staff_date_idx" ON "availability_exceptions" USING btree ("staff_id","date");--> statement-breakpoint
CREATE INDEX "availability_rules_staff_weekday_idx" ON "availability_rules" USING btree ("staff_id","weekday");--> statement-breakpoint
CREATE INDEX "bookings_staff_starts_at_idx" ON "bookings" USING btree ("staff_id","starts_at");