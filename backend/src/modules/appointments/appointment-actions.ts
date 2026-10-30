import { ErrorCode, unprocessable } from '../../common/errors/app.exception.js';
import {
  AppointmentTrigger as T,
  assertTransition,
  canTransition,
} from './appointment-state-machine.js';
import { AppointmentStatus as S } from './appointment.enums.js';

// What reception can do with a day-list row (`allowedActions`).
export enum DeskAction {
  CONFIRM = 'confirm',
  CANCEL = 'cancel',
  RESCHEDULE = 'reschedule',
  NO_SHOW = 'noShow',
  UNDO_NO_SHOW = 'undoNoShow',
  ATTEND = 'attend',
  UNDO_ATTEND = 'undoAttend',
}

// What a doctor can do with a row of their own day list.
export enum DoctorAction {
  WRITE_NOTE = 'writeNote',
  VIEW_NOTE = 'viewNote',
}

// Everything the rules look at, computed by the caller.
export interface ActionFacts {
  // The clinic-local date of the appointment (or of the walk-in) is today.
  isToday: boolean;
  // The appointment's start time has passed.
  hasStarted?: boolean;
  // The visit has a clinical note (draft or signed).
  visitHasNote?: boolean;
  // The visit's invoice holds money (amount paid > 0).
  invoiceHasPayments?: boolean;
}

interface Rule {
  holds: (facts: ActionFacts) => boolean;
  code: ErrorCode;
  message: string;
}

const SAME_DAY_UNDO: Rule = {
  holds: (f) => f.isToday,
  code: ErrorCode.UNDO_WRONG_DAY,
  message: 'Undo is only possible on the same day',
};

// Undo attend (appointment or walk-in): same day, no note, nothing paid.
const UNDO_ATTEND_RULES: Rule[] = [
  SAME_DAY_UNDO,
  {
    holds: (f) => !f.visitHasNote,
    code: ErrorCode.VISIT_HAS_NOTE,
    message: 'The doctor has already written a note for this visit',
  },
  {
    holds: (f) => !f.invoiceHasPayments,
    code: ErrorCode.INVOICE_HAS_PAYMENTS,
    message: "The visit's invoice has payments; void them first",
  },
];

/**
 * Each desk action = one state machine transition plus the time and undo
 * rules on top of it. Used both to answer `allowedActions` and to reject
 * the request, so the two never disagree.
 */
const ACTIONS: Record<DeskAction, { to: S; trigger: T; rules: Rule[] }> = {
  [DeskAction.CONFIRM]: { to: S.CONFIRMED, trigger: T.APPOINTMENT, rules: [] },
  [DeskAction.CANCEL]: { to: S.CANCELLED, trigger: T.APPOINTMENT, rules: [] },
  [DeskAction.RESCHEDULE]: {
    to: S.RESCHEDULED,
    trigger: T.APPOINTMENT,
    rules: [],
  },
  [DeskAction.NO_SHOW]: {
    to: S.NO_SHOW,
    trigger: T.APPOINTMENT,
    rules: [
      {
        holds: (f) => f.hasStarted ?? false,
        code: ErrorCode.NO_SHOW_TOO_EARLY,
        message:
          'An appointment can be marked as no-show only after it has started',
      },
    ],
  },
  [DeskAction.UNDO_NO_SHOW]: {
    to: S.CONFIRMED,
    trigger: T.UNDO_NO_SHOW,
    rules: [SAME_DAY_UNDO],
  },
  [DeskAction.ATTEND]: {
    to: S.ATTENDED,
    trigger: T.ATTEND,
    rules: [
      {
        holds: (f) => f.isToday,
        code: ErrorCode.ATTEND_WRONG_DAY,
        message: "A patient can only attend on the appointment's day",
      },
    ],
  },
  [DeskAction.UNDO_ATTEND]: {
    to: S.CONFIRMED,
    trigger: T.UNDO_ATTEND,
    rules: UNDO_ATTEND_RULES,
  },
};

// The status change an action makes (the caller applies it).
export function deskTransition(action: DeskAction): { to: S; trigger: T } {
  const { to, trigger } = ACTIONS[action];
  return { to, trigger };
}

function assertRules(rules: Rule[], facts: ActionFacts): void {
  const broken = rules.find((rule) => !rule.holds(facts));
  if (broken) throw unprocessable(broken.code, broken.message);
}

// Throws 422: INVALID_STATUS_TRANSITION, or the broken rule's code.
export function assertDeskAction(
  action: DeskAction,
  status: S,
  facts: ActionFacts,
): void {
  const { to, trigger, rules } = ACTIONS[action];
  assertTransition(status, to, trigger);
  assertRules(rules, facts);
}

export function allowedDeskActions(
  status: S,
  facts: ActionFacts,
): DeskAction[] {
  return Object.values(DeskAction).filter((action) => {
    const { to, trigger, rules } = ACTIONS[action];
    return (
      canTransition(status, to, trigger) &&
      rules.every((rule) => rule.holds(facts))
    );
  });
}

// A walk-in has no appointment: undoing it (through its ACTIVE visit) is
// its only desk action, with the same rules as undoing an attendance.
export function assertWalkInUndo(facts: ActionFacts): void {
  assertRules(UNDO_ATTEND_RULES, facts);
}

export function allowedWalkInActions(
  visitActive: boolean,
  facts: ActionFacts,
): DeskAction[] {
  return visitActive && UNDO_ATTEND_RULES.every((rule) => rule.holds(facts))
    ? [DeskAction.UNDO_ATTEND]
    : [];
}
