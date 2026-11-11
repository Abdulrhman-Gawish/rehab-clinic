# syntax=docker/dockerfile:1
#
# Frontend image: the production build of the clinic UI (React + Vite) served by nginx, which also forwards /api/ to
# the backend on the same origin (nginx/default.conf.template).
#
#   build    all dependencies, then `npm run build` (tsc, the i18n catalog check, vite build -> dist/)
#   runtime  nginx (unprivileged: runs as uid 101 and listens on 8080) with dist/ and the config only
#
# Nothing secret is or can be in the bundle: the build context holds no .env file, the browser only ever calls
# /api/v1 on its own address, and the OWNER quick-login button (a dev-server convenience) is always off here.
# The backend address is runtime configuration (BACKEND_URL), so one image works in any environment.
#
# Build alone:  docker build -t rehab-clinic-frontend ./frontend

ARG NODE_IMAGE=node:24-alpine
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.30-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY scripts ./scripts
COPY public ./public
COPY src ./src
# Fixed, not a build argument: with QUICK_LOGIN=false vite.config.ts puts no quick-login button and no OWNER
# credentials into the bundle.
ENV QUICK_LOGIN=false
RUN npm run build

FROM ${NGINX_IMAGE} AS runtime
# BACKEND_URL: where nginx forwards /api/ (the backend service on the Docker network). Only this variable is
# substituted into the nginx template.
ENV BACKEND_URL=http://backend:3000 \
    NGINX_ENVSUBST_FILTER=^BACKEND_URL$
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --start-interval=2s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
