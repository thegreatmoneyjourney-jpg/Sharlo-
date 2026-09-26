CREATE TABLE "sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"csrf_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "sessions_select_by_lookup_token" ON "sessions" AS PERMISSIVE FOR SELECT TO "app_user" USING ("sessions"."token" = nullif(current_setting('app.session_lookup_token', true), ''));--> statement-breakpoint
CREATE POLICY "sessions_insert_own_only" ON "sessions" AS PERMISSIVE FOR INSERT TO "app_user" WITH CHECK ("sessions"."user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "sessions_delete_own_only" ON "sessions" AS PERMISSIVE FOR DELETE TO "app_user" USING ("sessions"."user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);