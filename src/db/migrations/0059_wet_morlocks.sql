ALTER TABLE "booking_pages" DROP CONSTRAINT "booking_pages_pkey";--> statement-breakpoint
ALTER TABLE "booking_pages" ADD COLUMN "channel" text DEFAULT 'appointments' NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_org_id_channel_pk" PRIMARY KEY("org_id","channel");
