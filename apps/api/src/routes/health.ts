import type { FastifyInstance } from 'fastify';

/**
 * Unauthenticated liveness/readiness check. Deliberately returns nothing
 * beyond a status string — never wire in anything that touches the DB
 * or Drive-adjacent state here without reconsidering whether it belongs
 * in this always-public route.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    return { status: 'ok' as const, service: 'sharlo-api' };
  });
}
