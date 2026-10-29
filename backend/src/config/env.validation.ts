import Joi from 'joi';
import { isValidZone } from '../common/time/clinic-time.util.js';

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

  CLINIC_TIMEZONE: string;
  SLOT_INTERVAL_MINUTES: number;
  BOOKING_MIN_LEAD_MINUTES: number;
  BOOKING_MAX_DAYS_AHEAD: number;
  BOOKING_MAX_ACTIVE_PER_PHONE: number;
  BACKDATE_MAX_DAYS: number;

  RECEPTIONIST_MAX_DISCOUNT_PERCENT: number;
  BILLING_OVERDUE_DAYS: number;
  CLINIC_NAME: string;
  CLINIC_PHONE: string;
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

  // IANA zone of the clinic. Egypt observes DST: never assume a fixed offset.
  CLINIC_TIMEZONE: Joi.string()
    .default('Africa/Cairo')
    .custom((value: string, helpers) =>
      isValidZone(value) ? value : helpers.error('any.invalid'),
    ),
  SLOT_INTERVAL_MINUTES: Joi.number().integer().min(5).max(120).default(15),
  BOOKING_MIN_LEAD_MINUTES: Joi.number().integer().min(0).default(60),
  BOOKING_MAX_DAYS_AHEAD: Joi.number().integer().min(1).max(365).default(30),
  BOOKING_MAX_ACTIVE_PER_PHONE: Joi.number().integer().min(1).default(3),
  // How far back a RECEPTIONIST may backdate (allowOutsideSchedule); OWNER: no limit.
  BACKDATE_MAX_DAYS: Joi.number().integer().min(0).default(7),

  // Highest effective discount % a RECEPTIONIST may give (OWNER: no limit).
  RECEPTIONIST_MAX_DISCOUNT_PERCENT: Joi.number().min(0).max(100).default(100),
  // Invoices with a balance issued more than N days ago need attention.
  BILLING_OVERDUE_DAYS: Joi.number().integer().min(1).default(7),
  // Printed on receipts.
  CLINIC_NAME: Joi.string().trim().default('Rehab Clinic'),
  CLINIC_PHONE: Joi.string().trim().allow('').default(''),
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
