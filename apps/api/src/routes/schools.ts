import type { FastifyInstance } from 'fastify';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import type * as schema from '../db/schema.js';
import { requireSession } from '../auth/request-session.js';
import { createSchool, listSchoolsForAdmin } from '../auth/schools.js';

type Db = PostgresJsDatabase<typeof schema>;

// Same structural-validation-only gate `encryption.ts`'s own hexStringSchema
// is — reject anything that isn't even shaped like hex before it reaches
// the database; the server never decodes or interprets these values either
// way (ADR-0005's zero-knowledge boundary applies here too).
const hexStringSchema = z
  .string()
  .min(1)
  .regex(/^[0-9a-f]+$/i, 'must be a hex-encoded string');

const createSchoolBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  driveLocationType: z.enum(['shared_drive', 'folder']),
  driveLocationId: z.string().min(1),
  schoolWrappedKeyByAdminMasterKey: hexStringSchema,
  adminX25519PublicKey: hexStringSchema,
  adminX25519WrappedPrivateKey: hexStringSchema,
});

export interface SchoolRoutesOptions {
  db: Db;
}

/**
 * `M3-014`/`ADR-0010` — session-authenticated; `POST /schools` is covered
 * by the global CSRF double-submit hook the same as every other mutating
 * session-bearing route in this app (`app.ts`).
 */
export async function schoolRoutes(app: FastifyInstance, opts: SchoolRoutesOptions): Promise<void> {
  const { db } = opts;

  app.get('/schools', async (req, reply) => {
    const session = await requireSession(req, reply, db);
    if (!session) return;

    const result = await listSchoolsForAdmin(db, session.userId);
    return reply.code(200).send({ schools: result });
  });

  app.post('/schools', async (req, reply) => {
    const session = await requireSession(req, reply, db);
    if (!session) return;

    const parsed = createSchoolBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
    }

    const school = await createSchool(db, session.userId, parsed.data);
    return reply.code(201).send(school);
  });
}
