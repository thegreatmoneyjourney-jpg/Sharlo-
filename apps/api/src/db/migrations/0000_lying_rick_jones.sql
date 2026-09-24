CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"google_sub" text,
	"auth_mode" text NOT NULL,
	"account_type" text DEFAULT 'teacher' NOT NULL,
	"wrapped_master_key_by_passphrase" text,
	"wrapped_master_key_by_recovery" text,
	"kdf_salt" text,
	"kdf_params" jsonb,
	"recovery_key_verifier" text,
	"recovery_key_issued_at" timestamp with time zone,
	"recovery_key_reminder_7d_sent_at" timestamp with time zone,
	"recovery_key_reminder_30d_sent_at" timestamp with time zone,
	"recovery_key_reminder_dismissed_at" timestamp with time zone,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_sub_unique" UNIQUE("google_sub")
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "users_self_access_only" ON "users" AS PERMISSIVE FOR ALL TO "app_user" USING ("users"."id" = nullif(current_setting('app.current_user_id', true), '')::uuid);