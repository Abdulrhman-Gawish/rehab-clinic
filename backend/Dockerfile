# syntax=docker/dockerfile:1
#
# Backend image: the compiled NestJS API on Node 24 (Alpine), run as the unprivileged `node` user.
#
#   build      all dependencies + `nest build` (TypeScript -> dist/)
#   prod-deps  runtime dependencies only (`npm ci --omit=dev`), cached on the lockfile alone
#   runtime    dist/ + production node_modules; nothing else from the source tree
#
# No configuration or secret is baked in: everything comes from the environment at run time (backend/.env and
# database/.env through docker-compose.yml). The database wait, the migrations and the first-OWNER seed run when the
# container starts (docker-entrypoint.sh), because there is no database at build time.
#
# Build alone:  docker build -t rehab-clinic-backend ./backend

ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
# Type declarations are only for other TypeScript code; the runtime doesn't need them.
RUN npm run build && find dist -name '*.d.ts' -delete

FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    STORAGE_LOCAL_PATH=/app/storage
WORKDIR /app
# package.json carries "type": "module", which Node needs to load dist/ as ES modules.
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh ./
# The code stays owned by root (read-only for the app). Only storage/ is writable: uploads go there, on a volume.
# (A recursive chown of /app would copy node_modules into a second layer.)
RUN mkdir -p storage && chown node:node storage
USER node
EXPOSE 3000
# GET /api/v1/health answers 200 only when the database answers too.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --start-interval=2s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
