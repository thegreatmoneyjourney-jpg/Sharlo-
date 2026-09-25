CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid,
	"name" text NOT NULL,
	"question_count" integer NOT NULL,
	"geometry" jsonb NOT NULL,
	"is_stock" boolean DEFAULT false NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "templates_stock_name_unique" ON "templates" USING btree ("name") WHERE "templates"."is_stock" = true;--> statement-breakpoint
CREATE POLICY "templates_select_own_or_stock" ON "templates" AS PERMISSIVE FOR SELECT TO "app_user" USING ("templates"."owner_id" is null or "templates"."owner_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "templates_insert_own_only" ON "templates" AS PERMISSIVE FOR INSERT TO "app_user" WITH CHECK ("templates"."owner_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "templates_update_own_only" ON "templates" AS PERMISSIVE FOR UPDATE TO "app_user" USING ("templates"."owner_id" = nullif(current_setting('app.current_user_id', true), '')::uuid) WITH CHECK ("templates"."owner_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "templates_delete_own_only" ON "templates" AS PERMISSIVE FOR DELETE TO "app_user" USING ("templates"."owner_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);