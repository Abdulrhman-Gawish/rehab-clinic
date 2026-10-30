#!/bin/sh
# Runs on every container start. Both steps are idempotent: migrations skip
# what is already applied, the seed skips an existing OWNER.
set -e

echo "Running migrations..."
npx typeorm migration:run -d dist/database/data-source.js

echo "Seeding the OWNER (SEED_OWNER_*)..."
node dist/database/seeds/run-seeds.js

exec node dist/main.js
