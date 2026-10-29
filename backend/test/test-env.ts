import { existsSync } from 'node:fs';

// Resolves the e2e database name and refuses to point at the dev database,
// because the e2e setup drops and recreates its schema.
export function resolveTestDatabase(): string {
  if (existsSync('.env')) process.loadEnvFile('.env');

  const devDatabase = process.env.DB_DATABASE ?? '';
  const testDatabase = process.env.DB_TEST_DATABASE || `${devDatabase}_test`;
  if (!devDatabase || testDatabase === devDatabase) {
    throw new Error(
      'Set DB_DATABASE and a different DB_TEST_DATABASE: e2e tests wipe the test database.',
    );
  }
  if (!/^\w+$/.test(testDatabase)) {
    throw new Error(`Invalid test database name: ${testDatabase}`);
  }
  return testDatabase;
}
