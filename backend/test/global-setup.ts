import { execSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DataSource } from 'typeorm';
import { resolveTestDatabase } from './test-env.js';

// backend/.tmp/e2e-storage: where the e2e suites put uploads (they set
// STORAGE_LOCAL_PATH=.tmp/e2e-storage). Fixed here on purpose: never derived
// from STORAGE_LOCAL_PATH, which in this process comes from .env and points at
// the real uploads.
const E2E_STORAGE = fileURLToPath(
  new URL('../.tmp/e2e-storage', import.meta.url),
);

function connect(database: string): Promise<DataSource> {
  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database,
  }).initialize();
}

// Creates the test database if needed, wipes it and the e2e uploads, and
// applies the real migrations (the same path production uses; never synchronize).
export default async function setup(): Promise<void> {
  const database = resolveTestDatabase();

  const admin = await connect('postgres');
  const rows: unknown[] = await admin.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [database],
  );
  if (rows.length === 0) {
    await admin.query(`CREATE DATABASE "${database}"`);
  }
  await admin.destroy();

  const test = await connect(database);
  await test.query('DROP SCHEMA public CASCADE');
  await test.query('CREATE SCHEMA public');
  await test.destroy();

  // Files from earlier runs belong to rows that were just dropped.
  await rm(E2E_STORAGE, { recursive: true, force: true });

  execSync('npm run migration:run', {
    stdio: 'inherit',
    env: { ...process.env, DB_DATABASE: database },
  });
}
