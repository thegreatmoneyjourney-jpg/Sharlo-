import Fastify, { type FastifyInstance } from 'fastify';
import { healthRoutes } from './routes/health.js';

/**
 * Builds the Fastify instance without starting it listening — kept separate
 * from index.ts so tests can build+inject against it without binding a port.
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: true,
  });

  app.register(healthRoutes);

  return app;
}
