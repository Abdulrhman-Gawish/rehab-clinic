import type { PostgresDataSourceOptions } from 'typeorm/driver/postgres/PostgresDataSourceOptions.js';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import type { DatabaseEnv } from '../config/env.validation.js';

// Options shared by the Nest app and the TypeORM CLI data source.
// Schema changes only ever happen through migrations.
export function buildTypeOrmOptions(
  env: DatabaseEnv,
): PostgresDataSourceOptions {
  return {
    type: 'postgres',
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_DATABASE,
    synchronize: false,
    migrationsRun: false,
    logging: env.DB_LOGGING,
    namingStrategy: new SnakeNamingStrategy(),
    // gen_random_uuid() is built into PostgreSQL 13+, no extension needed.
    uuidExtension: 'pgcrypto',
    // Session time zone is UTC so timestamptz values are rendered in UTC.
    extra: { options: '-c timezone=UTC' },
  };
}
