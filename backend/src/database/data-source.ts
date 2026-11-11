// Data source used by the TypeORM CLI (migrations) and the seed script.
// Runs from dist/, so entities and migrations are loaded as compiled .js.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { databaseEnvSchema, validateWith } from '../config/env.validation.js';
import { buildTypeOrmOptions } from './typeorm.options.js';

// Variables already set in the environment win over the .env file.
if (existsSync('.env')) process.loadEnvFile('.env');

const env = validateWith(databaseEnvSchema, process.env);
const distRoot = join(import.meta.dirname, '..');

export default new DataSource({
  ...buildTypeOrmOptions(env),
  entities: [join(distRoot, '**/*.entity.js')],
  migrations: [join(distRoot, 'database/migrations/*.js')],
});
