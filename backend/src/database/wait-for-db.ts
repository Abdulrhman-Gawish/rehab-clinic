// Usage: node dist/database/wait-for-db.js  (run by docker-entrypoint.sh)
// Waits until PostgreSQL accepts connections with the DB_* settings, so the
// migrations don't fail while the database container is still starting.
// Wrong credentials or a missing database fail at once: waiting can't fix them.
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { DataSource } from 'typeorm';
import { databaseEnvSchema, validateWith } from '../config/env.validation.js';
import { buildTypeOrmOptions } from './typeorm.options.js';

const TIMEOUT_MS = 60_000;
const RETRY_MS = 2_000;
// invalid_authorization_specification, invalid_password, invalid_catalog_name
const FATAL_CODES = new Set(['28000', '28P01', '3D000']);

// Variables already set in the environment win over the .env file.
if (existsSync('.env')) process.loadEnvFile('.env');

const env = validateWith(databaseEnvSchema, process.env);
const target = `${env.DB_HOST}:${env.DB_PORT}/${env.DB_DATABASE}`;
const deadline = Date.now() + TIMEOUT_MS;

for (;;) {
  const dataSource = new DataSource({
    ...buildTypeOrmOptions(env),
    connectTimeoutMS: 5_000,
  });
  try {
    await dataSource.initialize();
    await dataSource.destroy();
    console.log(`Database ${target} is ready.`);
    break;
  } catch (error) {
    const { code, message } = error as { code?: string; message: string };
    if ((code && FATAL_CODES.has(code)) || Date.now() >= deadline) {
      console.error(`Database ${target} is not usable: ${message}`);
      process.exit(1);
    }
    console.log(`Waiting for the database ${target} (${message})...`);
    await sleep(RETRY_MS);
  }
}
