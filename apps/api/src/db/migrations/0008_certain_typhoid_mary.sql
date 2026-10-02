CREATE TABLE "school_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"drive_location_type" text NOT NULL,
	"drive_location_id" text NOT NULL,
	"email" text NOT NULL,
	"drive_access_granted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_members_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "school_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "school_members" ADD CONSTRAINT "school_members_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_members" ADD CONSTRAINT "school_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "school_members_admin_manages_own_school" ON "school_members" AS PERMISSIVE FOR ALL TO "app_user" USING ("school_members"."school_id" in (select "schools"."id" from "schools" where "schools"."admin_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "school_members_self_select" ON "school_members" AS PERMISSIVE FOR SELECT TO "app_user" USING ("school_members"."user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "school_members_self_update" ON "school_members" AS PERMISSIVE FOR UPDATE TO "app_user" USING ("school_members"."user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid) WITH CHECK ("school_members"."user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);