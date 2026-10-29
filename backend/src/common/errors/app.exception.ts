import { HttpException, HttpStatus } from '@nestjs/common';

// Machine-readable error codes returned in the `code` field of error bodies.
export enum ErrorCode {
  SLOT_UNAVAILABLE = 'SLOT_UNAVAILABLE',
  PATIENT_OVERLAP = 'PATIENT_OVERLAP',
  BOOKING_LIMIT_REACHED = 'BOOKING_LIMIT_REACHED',
  OUTSIDE_SCHEDULE = 'OUTSIDE_SCHEDULE',
  DATE_OUT_OF_RANGE = 'DATE_OUT_OF_RANGE',
  SERVICE_NOT_OFFERED = 'SERVICE_NOT_OFFERED',
  INVALID_STATUS_TRANSITION = 'INVALID_STATUS_TRANSITION',
  NO_SHOW_TOO_EARLY = 'NO_SHOW_TOO_EARLY',
  SCHEDULE_OVERLAP = 'SCHEDULE_OVERLAP',
  BACKDATE_LIMIT_EXCEEDED = 'BACKDATE_LIMIT_EXCEEDED',
}

// HttpException carrying a stable `code` (and optional details) that the
// global filter copies into the response body.
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ErrorCode,
    message: string,
    details?: unknown,
  ) {
    super({ message, code, ...(details !== undefined && { details }) }, status);
  }
}

export const conflict = (code: ErrorCode, message: string, details?: unknown) =>
  new AppException(HttpStatus.CONFLICT, code, message, details);

export const unprocessable = (
  code: ErrorCode,
  message: string,
  details?: unknown,
) => new AppException(HttpStatus.UNPROCESSABLE_ENTITY, code, message, details);
