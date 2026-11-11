#!/bin/sh
# Runs on every container start. Every step is safe to repeat:
# 1. wait-for-db: waits (up to 60 s) until PostgreSQL accepts connections; wrong credentials fail at once.
# 2. migrations: only the pending ones run, in order, in one transaction (a failure rolls them all back and the
#    container stops before the API starts). Nothing is ever dropped or reset.
# 3. seed: creates the first OWNER only when the database has no OWNER yet (a fresh install).
# The API then replaces this shell (exec), so it receives the stop signal directly and shuts down cleanly.
set -e

node dist/database/wait-for-db.js

echo "Running pending migrations..."
node node_modules/typeorm/cli.js migration:run -d dist/database/data-source.js

echo "Seeding the first OWNER (fresh database only)..."
node dist/database/seeds/run-seeds.js

exec node dist/main.js
