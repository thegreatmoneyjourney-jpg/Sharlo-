# Build context is the repo root (npm workspaces need the root
# package.json/lockfile), not apps/web/ — see docker-compose.yml.
FROM node:22-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci

COPY apps/web ./apps/web

# NEXT_PUBLIC_* vars are inlined into the client bundle at build time, not
# read at container-start time — this must be a build ARG, not a
# docker-compose `environment:` entry (which would have zero effect on
# what's actually baked into the bundle already produced below). See
# docker-compose.yml's `web` service `build.args`.
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

RUN npm run build -w web

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

# `output: 'standalone'` (apps/web/next.config.ts) traces and copies only
# the dependencies a request actually needs — no node_modules install in
# this stage at all, unlike apps/api's Dockerfile.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
