CREATE TABLE "premium_waitlist" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"joined_by" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "premium_waitlist" ADD CONSTRAINT "premium_waitlist_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;