import { ErrorCode, unprocessable } from '../../common/errors/app.exception.js';
import { AppointmentStatus as S } from './appointment.enums.js';

/**
 * The ONLY definition of allowed appointment status transitions.
 * CHECKED_IN / COMPLETED transitions arrive with the visits stage.
 */
const TRANSITIONS: Readonly<Record<S, readonly S[]>> = {
  [S.PENDING]: [S.CONFIRMED, S.CANCELLED],
  [S.CONFIRMED]: [S.CANCELLED, S.NO_SHOW, S.RESCHEDULED],
  [S.CHECKED_IN]: [],
  [S.COMPLETED]: [],
  [S.NO_SHOW]: [],
  [S.CANCELLED]: [],
  [S.RESCHEDULED]: [],
};

export function allowedTransitions(from: S): readonly S[] {
  return TRANSITIONS[from];
}

export function canTransition(from: S, to: S): boolean {
  return TRANSITIONS[from].includes(to);
}

// Throws 422 INVALID_STATUS_TRANSITION for anything not listed above.
export function assertTransition(from: S, to: S): void {
  if (!canTransition(from, to)) {
    throw unprocessable(
      ErrorCode.INVALID_STATUS_TRANSITION,
      `Cannot change an appointment from ${from} to ${to}`,
      { from, to, allowed: TRANSITIONS[from] },
    );
  }
}
