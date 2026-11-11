import { ErrorCode, unprocessable } from '../../common/errors/app.exception.js';
import { AppointmentStatus as S } from './appointment.enums.js';

/**
 * What triggers a transition. Some transitions are reserved for one
 * operation: e.g. ATTENDED -> CONFIRMED only happens through "undo attend",
 * never through POST /appointments/:id/confirm.
 */
export enum AppointmentTrigger {
  // Plain appointment actions (confirm, cancel, no-show, reschedule).
  APPOINTMENT = 'APPOINTMENT',
  ATTEND = 'ATTEND',
  UNDO_ATTEND = 'UNDO_ATTEND',
  UNDO_NO_SHOW = 'UNDO_NO_SHOW',
}

const T = AppointmentTrigger;

/**
 * The ONLY definition of allowed appointment status transitions, and which
 * operation may perform each of them. Reception does all of them; time and
 * undo rules (same day, after the start, no note, no payments) are checked
 * on top, see appointment-actions.ts.
 */
const TRANSITIONS: Readonly<
  Record<S, Readonly<Partial<Record<S, readonly AppointmentTrigger[]>>>>
> = {
  [S.PENDING]: {
    [S.CONFIRMED]: [T.APPOINTMENT],
    [S.CANCELLED]: [T.APPOINTMENT],
    [S.RESCHEDULED]: [T.APPOINTMENT],
    [S.NO_SHOW]: [T.APPOINTMENT],
    [S.ATTENDED]: [T.ATTEND],
  },
  [S.CONFIRMED]: {
    [S.CANCELLED]: [T.APPOINTMENT],
    [S.RESCHEDULED]: [T.APPOINTMENT],
    [S.NO_SHOW]: [T.APPOINTMENT],
    [S.ATTENDED]: [T.ATTEND],
  },
  [S.ATTENDED]: {
    [S.CONFIRMED]: [T.UNDO_ATTEND],
  },
  [S.NO_SHOW]: {
    [S.CONFIRMED]: [T.UNDO_NO_SHOW],
  },
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
