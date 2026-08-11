CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "accent_color" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "logo_path" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "access_tokens" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clients_org_id_idx" ON "clients" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_org_lower_name_uq" ON "clients" USING btree ("org_id",lower("name"));--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_tokens" ADD CONSTRAINT "access_tokens_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "units_client_id_idx" ON "units" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "access_tokens_client_id_idx" ON "access_tokens" USING btree ("client_id");