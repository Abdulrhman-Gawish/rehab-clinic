import { execSync } from 'node:child_process';
import { DataSource } from 'typeorm';
import { resolveTestDatabase } from './test-env.js';

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

// Creates the test database if needed, wipes it, and applies the real
// migrations (the same path production uses; never synchronize).
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

  execSync('npm run migration:run', {
    stdio: 'inherit',
    env: { ...process.env, DB_DATABASE: database },
  });
}
