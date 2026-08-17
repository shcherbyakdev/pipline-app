CREATE TABLE "rental_offerings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_label" text,
	"range_mode" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"min_stay" integer DEFAULT 1 NOT NULL,
	"max_stay" integer,
	"turnover_days" integer DEFAULT 0 NOT NULL,
	"min_notice_days" integer DEFAULT 0 NOT NULL,
	"booking_window_days" integer DEFAULT 180 NOT NULL,
	"unit_selection" text DEFAULT 'auto' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rental_unit_blackouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"rental_unit_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rental_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"offering_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "service_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "rental_offering_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "rental_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "rental_offerings" ADD CONSTRAINT "rental_offerings_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_unit_blackouts" ADD CONSTRAINT "rental_unit_blackouts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_unit_blackouts" ADD CONSTRAINT "rental_unit_blackouts_rental_unit_id_rental_units_id_fk" FOREIGN KEY ("rental_unit_id") REFERENCES "public"."rental_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_units" ADD CONSTRAINT "rental_units_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_units" ADD CONSTRAINT "rental_units_offering_id_rental_offerings_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."rental_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rental_offerings_org_id_idx" ON "rental_offerings" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "rental_unit_blackouts_unit_start_idx" ON "rental_unit_blackouts" USING btree ("rental_unit_id","start_date");--> statement-breakpoint
CREATE INDEX "rental_units_offering_id_idx" ON "rental_units" USING btree ("offering_id");--> statement-breakpoint
CREATE INDEX "rental_units_org_id_idx" ON "rental_units" USING btree ("org_id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_rental_offering_id_rental_offerings_id_fk" FOREIGN KEY ("rental_offering_id") REFERENCES "public"."rental_offerings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_rental_unit_id_rental_units_id_fk" FOREIGN KEY ("rental_unit_id") REFERENCES "public"."rental_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_rental_unit_starts_at_idx" ON "bookings" USING btree ("rental_unit_id","starts_at");