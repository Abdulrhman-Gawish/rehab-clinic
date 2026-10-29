import Joi from 'joi';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

// Variables needed to reach the database. Shared by the app and the TypeORM
// CLI data source (which must not require JWT secrets etc.).
export interface DatabaseEnv {
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_PASSWORD: string;
  DB_DATABASE: string;
  DB_LOGGING: boolean;
}

export interface EnvironmentVariables extends DatabaseEnv {
  NODE_ENV: NodeEnv;
  PORT: number;
  LOG_LEVEL: string;
  CORS_ORIGINS: string;
  TRUST_PROXY: boolean;
  SWAGGER_ENABLED: boolean;

  JWT_ACCESS_SECRET: string;
  JWT_ACCESS_TTL_SECONDS: number;
  JWT_REFRESH_TTL_DAYS: number;

  THROTTLE_ENABLED: boolean;
  THROTTLE_TTL_MS: number;
  THROTTLE_LIMIT: number;
}

const databaseKeys = {
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_DATABASE: Joi.string().required(),
  DB_LOGGING: Joi.boolean().default(false),
};

export const databaseEnvSchema = Joi.object<DatabaseEnv>(databaseKeys);

export const envSchema = Joi.object<EnvironmentVariables>({
  ...databaseKeys,
  NODE_ENV: Joi.string()
    .valid(...Object.values(NodeEnv))
    .default(NodeEnv.Development),
  PORT: Joi.number().port().default(3000),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),
  // Comma separated list of allowed origins; empty disables CORS.
  CORS_ORIGINS: Joi.string().allow('').default(''),
  // Enable when running behind a reverse proxy so req.ip is the client IP.
  TRUST_PROXY: Joi.boolean().default(false),
  SWAGGER_ENABLED: Joi.boolean().default(true),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL_SECONDS: Joi.number().integer().positive().default(900),
  JWT_REFRESH_TTL_DAYS: Joi.number().integer().positive().default(7),

  THROTTLE_ENABLED: Joi.boolean().default(true),
  THROTTLE_TTL_MS: Joi.number().integer().positive().default(60_000),
  THROTTLE_LIMIT: Joi.number().integer().positive().default(120),
});

// Validates and converts raw env strings; unknown variables (PATH etc.) are
// kept as-is. Throws with every problem listed so startup fails fast.
export function validateWith<T>(
  schema: Joi.ObjectSchema<T>,
  raw: Record<string, unknown>,
): T {
  const { value, error } = schema.validate(raw, {
    allowUnknown: true,
    abortEarly: false,
  });
  if (error) {
    throw new Error(`Invalid environment configuration: ${error.message}`);
  }
  return value;
}

export function validateEnv(
  raw: Record<string, unknown>,
): EnvironmentVariables {
  return validateWith(envSchema, raw);
}
