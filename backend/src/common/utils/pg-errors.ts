import { QueryFailedError } from 'typeorm';

export const PgErrorCode = {
  UniqueViolation: '23505',
  ForeignKeyViolation: '23503',
  CheckViolation: '23514',
  NotNullViolation: '23502',
  InvalidTextRepresentation: '22P02',
} as const;

export interface PgDriverError {
  code?: string;
  constraint?: string;
  detail?: string;
}

export function getPgError(error: unknown): PgDriverError | null {
  if (!(error instanceof QueryFailedError)) return null;
  return error.driverError as PgDriverError;
}

// True when `error` is a unique violation, optionally of a specific constraint.
export function isUniqueViolation(
  error: unknown,
  constraint?: string,
): boolean {
  const pg = getPgError(error);
  return (
    pg?.code === PgErrorCode.UniqueViolation &&
    (constraint === undefined || pg.constraint === constraint)
  );
}
