import { HttpException, HttpStatus } from '@nestjs/common';

// Machine-readable error codes returned in the `code` field of error bodies.
export enum ErrorCode {
  REFRESH_RACE = 'REFRESH_RACE',
  SLOT_UNAVAILABLE = 'SLOT_UNAVAILABLE',
  PATIENT_OVERLAP = 'PATIENT_OVERLAP',
  BOOKING_LIMIT_REACHED = 'BOOKING_LIMIT_REACHED',
  REFERENCE_NOT_FOUND = 'REFERENCE_NOT_FOUND',
  OUTSIDE_SCHEDULE = 'OUTSIDE_SCHEDULE',
  DATE_OUT_OF_RANGE = 'DATE_OUT_OF_RANGE',
  SERVICE_NOT_OFFERED = 'SERVICE_NOT_OFFERED',
  INVALID_STATUS_TRANSITION = 'INVALID_STATUS_TRANSITION',
  NO_SHOW_TOO_EARLY = 'NO_SHOW_TOO_EARLY',
  SCHEDULE_OVERLAP = 'SCHEDULE_OVERLAP',
  BACKDATE_LIMIT_EXCEEDED = 'BACKDATE_LIMIT_EXCEEDED',
  ATTEND_WRONG_DAY = 'ATTEND_WRONG_DAY',
  ALREADY_ATTENDED = 'ALREADY_ATTENDED',
  UNDO_WRONG_DAY = 'UNDO_WRONG_DAY',
  VISIT_HAS_NOTE = 'VISIT_HAS_NOTE',
  VISIT_VOIDED = 'VISIT_VOIDED',
  INVOICE_LOCKED = 'INVOICE_LOCKED',
  INVOICE_HAS_PAYMENTS = 'INVOICE_HAS_PAYMENTS',
  INVOICE_CANCELLED = 'INVOICE_CANCELLED',
  INVOICE_NEEDS_ITEMS = 'INVOICE_NEEDS_ITEMS',
  DISCOUNT_EXCEEDS_SUBTOTAL = 'DISCOUNT_EXCEEDS_SUBTOTAL',
  DISCOUNT_LIMIT_EXCEEDED = 'DISCOUNT_LIMIT_EXCEEDED',
  DISCOUNT_PATIENT_MISMATCH = 'DISCOUNT_PATIENT_MISMATCH',
  OVERPAYMENT = 'OVERPAYMENT',
  VOID_NOT_ALLOWED = 'VOID_NOT_ALLOWED',
  REFUND_NOT_ALLOWED = 'REFUND_NOT_ALLOWED',
  REFUND_EXCEEDS_PAYMENT = 'REFUND_EXCEEDS_PAYMENT',
  EXPENSE_DATE_IN_FUTURE = 'EXPENSE_DATE_IN_FUTURE',
  EXPENSE_EDIT_NOT_ALLOWED = 'EXPENSE_EDIT_NOT_ALLOWED',
  CATEGORY_INACTIVE = 'CATEGORY_INACTIVE',
  CATEGORY_NAME_TAKEN = 'CATEGORY_NAME_TAKEN',
  UNSUPPORTED_FILE_TYPE = 'UNSUPPORTED_FILE_TYPE',
  NOTE_NOT_ALLOWED = 'NOTE_NOT_ALLOWED',
  NOTE_SIGNED = 'NOTE_SIGNED',
  NOTE_INCOMPLETE = 'NOTE_INCOMPLETE',
  NOTE_NOT_SIGNED = 'NOTE_NOT_SIGNED',
  NOTE_NOT_VISIBLE = 'NOTE_NOT_VISIBLE',
  ATTACHMENT_VISIT_MISMATCH = 'ATTACHMENT_VISIT_MISMATCH',
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

export const notFound = (code: ErrorCode, message: string, details?: unknown) =>
  new AppException(HttpStatus.NOT_FOUND, code, message, details);
