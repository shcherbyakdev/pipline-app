ALTER TABLE "orgs" ADD COLUMN "currency" text DEFAULT 'PLN' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "price_cents" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "deposit_cents" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rental_offerings" ADD COLUMN "price_cents" integer;--> statement-breakpoint
ALTER TABLE "rental_offerings" ADD COLUMN "pricing_mode" text DEFAULT 'per_unit' NOT NULL;--> statement-breakpoint
ALTER TABLE "rental_offerings" ADD COLUMN "deposit_type" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "rental_offerings" ADD COLUMN "deposit_value" integer;--> statement-breakpoint
ALTER TABLE "rental_offerings" ADD COLUMN "cancel_window_min" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rental_offerings" ADD COLUMN "terms_text" text;--> statement-breakpoint
ALTER TABLE "rental_offerings" DROP COLUMN "price_label";