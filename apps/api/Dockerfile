# Build context is the repo root, not apps/api/ — npm workspaces need the
# root package.json/lockfile present to resolve correctly. See
# docker-compose.yml's `build.context`.
FROM node:22-alpine AS base
WORKDIR /repo

# --- Stage: full install + compile (needs devDependencies like tsc) ---
FROM base AS build
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci
COPY apps/api ./apps/api
RUN npm run build -w api

# --- Stage: production-only node_modules (no drizzle-kit/tsx/vitest/etc.) ---
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci --omit=dev

# --- Stage: what actually ships ---
FROM node:22-alpine AS runner
WORKDIR /repo
ENV NODE_ENV=production

COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/src/db/migrations ./apps/api/src/db/migrations
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

WORKDIR /repo/apps/api
EXPOSE 4000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
