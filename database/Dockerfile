# syntax=docker/dockerfile:1
#
# PostgreSQL 16 for the clinic. The official image does all the work; this file exists so that the version, the time
# zone and the health check are defined once, wherever the image runs (the stack, `database/docker-compose.yml` alone,
# or the backend's development database in `backend/docker-compose.dev.yml`).
#
# Deliberately NOT here:
# - init scripts or data: the backend's migrations create the schema and its seed creates the first OWNER;
# - credentials: POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD come from the environment at run time
#   (database/.env), and they only matter the first time, when the data directory is empty.
#
# The data directory is /var/lib/postgresql/data (PostgreSQL 16 images); mount a named volume there.
FROM postgres:16-alpine

# The backend stores every instant as timestamptz and renders it in CLINIC_TIMEZONE itself: the server stays in UTC.
ENV TZ=UTC \
    PGTZ=UTC

# Checks over TCP on purpose: while a fresh volume is being initialised the image runs a temporary server that only
# listens on the Unix socket, so a socket check would report "healthy" before the real server is up.
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --start-interval=2s --retries=5 \
  CMD pg_isready -h 127.0.0.1 -p 5432 -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-${POSTGRES_USER:-postgres}}" || exit 1
