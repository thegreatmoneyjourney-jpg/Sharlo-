CREATE TABLE "schools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"drive_location_type" text NOT NULL,
	"drive_location_id" text NOT NULL,
	"school_wrapped_key_by_admin_master_key" text NOT NULL,
	"admin_x25519_public_key" text NOT NULL,
	"admin_x25519_wrapped_private_key" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schools" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "schools" ADD CONSTRAINT "schools_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "schools_admin_access_only" ON "schools" AS PERMISSIVE FOR ALL TO "app_user" USING ("schools"."admin_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);