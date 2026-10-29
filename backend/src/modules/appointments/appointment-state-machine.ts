import { ErrorCode, unprocessable } from '../../common/errors/app.exception.js';
import { AppointmentStatus as S } from './appointment.enums.js';

/**
 * What triggers a transition. Some transitions are reserved for one
 * operation: e.g. CHECKED_IN -> CONFIRMED only happens through "undo
 * check-in", never through PATCH /appointments/:id/confirm.
 */
export enum AppointmentTrigger {
  // Direct appointment endpoints (confirm, cancel, no-show, reschedule).
  APPOINTMENT = 'APPOINTMENT',
  CHECK_IN = 'CHECK_IN',
  UNDO_CHECK_IN = 'UNDO_CHECK_IN',
  VISIT_CANCEL = 'VISIT_CANCEL',
  VISIT_COMPLETE = 'VISIT_COMPLETE',
}

const T = AppointmentTrigger;

/**
 * The ONLY definition of allowed appointment status transitions, and which
 * operation may perform each of them.
 *
 * Checking in a PENDING booking runs two steps in one transaction:
 * PENDING -> CONFIRMED -> CHECKED_IN (two history rows).
 */
const TRANSITIONS: Readonly<
  Record<S, Readonly<Partial<Record<S, readonly AppointmentTrigger[]>>>>
> = {
  [S.PENDING]: {
    [S.CONFIRMED]: [T.APPOINTMENT, T.CHECK_IN],
    [S.CANCELLED]: [T.APPOINTMENT],
  },
  [S.CONFIRMED]: {
    [S.CANCELLED]: [T.APPOINTMENT],
    [S.NO_SHOW]: [T.APPOINTMENT],
    [S.RESCHEDULED]: [T.APPOINTMENT],
    [S.CHECKED_IN]: [T.CHECK_IN],
  },
  [S.CHECKED_IN]: {
    [S.COMPLETED]: [T.VISIT_COMPLETE],
    [S.CONFIRMED]: [T.UNDO_CHECK_IN],
    [S.CANCELLED]: [T.VISIT_CANCEL],
  },
  [S.COMPLETED]: {},
  [S.NO_SHOW]: {},
  [S.CANCELLED]: {},
  [S.RESCHEDULED]: {},
};

// Target statuses reachable from `from` through `trigger`.
export function allowedTransitions(
  from: S,
  trigger: AppointmentTrigger = T.APPOINTMENT,
): S[] {
  return (Object.entries(TRANSITIONS[from]) as [S, AppointmentTrigger[]][])
    .filter(([, triggers]) => triggers.includes(trigger))
    .map(([to]) => to);
}

export function canTransition(
  from: S,
  to: S,
  trigger: AppointmentTrigger = T.APPOINTMENT,
): boolean {
  return TRANSITIONS[from][to]?.includes(trigger) ?? false;
}

// Throws 422 INVALID_STATUS_TRANSITION for anything not listed above.
export function assertTransition(
  from: S,
  to: S,
  trigger: AppointmentTrigger = T.APPOINTMENT,
): void {
  if (!canTransition(from, to, trigger)) {
    throw unprocessable(
      ErrorCode.INVALID_STATUS_TRANSITION,
      `Cannot change an appointment from ${from} to ${to}`,
      { from, to, allowed: allowedTransitions(from, trigger) },
    );
  }
}
