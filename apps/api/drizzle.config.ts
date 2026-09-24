import { defineConfig } from 'drizzle-kit';

// Migrations run with a privileged (table-owning) connection — never the
// restricted `app_user` role RLS policies are written against. See
// src/db/testing/provision-app-role.ts for how that restricted role gets
// provisioned separately from schema migrations.
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/sharlo',
  },
});
