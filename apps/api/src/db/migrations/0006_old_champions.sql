CREATE TABLE "email_otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_otp_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth_provider" text NOT NULL;--> statement-breakpoint
CREATE POLICY "users_select_by_email_lookup" ON "users" AS PERMISSIVE FOR SELECT TO "app_user" USING ("users"."email" = nullif(current_setting('app.email_lookup', true), ''));--> statement-breakpoint
CREATE POLICY "email_otp_codes_by_email_lookup" ON "email_otp_codes" AS PERMISSIVE FOR ALL TO "app_user" USING ("email_otp_codes"."email" = nullif(current_setting('app.otp_email_lookup', true), '')) WITH CHECK ("email_otp_codes"."email" = nullif(current_setting('app.otp_email_lookup', true), ''));