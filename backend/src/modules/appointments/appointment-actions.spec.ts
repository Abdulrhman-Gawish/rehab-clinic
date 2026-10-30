import { AppException } from '../../common/errors/app.exception.js';
import {
  allowedDeskActions,
  allowedWalkInActions,
  assertDeskAction,
  assertWalkInUndo,
  DeskAction as A,
  type ActionFacts,
} from './appointment-actions.js';
import { AppointmentStatus as S } from './appointment.enums.js';

const today = { isToday: true, hasStarted: false };
const started = { isToday: true, hasStarted: true };
const pastDay = { isToday: false, hasStarted: true };
const futureDay = { isToday: false, hasStarted: false };

function codeOf(run: () => void): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).getStatus()).toBe(422);
    return (error as AppException).code;
  }
}

describe('allowedDeskActions', () => {
  it.each<[string, S, ActionFacts, A[]]>([
    [
      'PENDING today, not started',
      S.PENDING,
      today,
      [A.CONFIRM, A.CANCEL, A.RESCHEDULE, A.ATTEND],
    ],
    [
      'PENDING today, started',
      S.PENDING,
      started,
      [A.CONFIRM, A.CANCEL, A.RESCHEDULE, A.NO_SHOW, A.ATTEND],
    ],
    [
      'PENDING on a future day',
      S.PENDING,
      futureDay,
      [A.CONFIRM, A.CANCEL, A.RESCHEDULE],
    ],
    [
      'CONFIRMED today, not started',
      S.CONFIRMED,
      today,
      [A.CANCEL, A.RESCHEDULE, A.ATTEND],
    ],
    [
      'CONFIRMED today, started',
      S.CONFIRMED,
      started,
      [A.CANCEL, A.RESCHEDULE, A.NO_SHOW, A.ATTEND],
    ],
    [
      'CONFIRMED on a past day',
      S.CONFIRMED,
      pastDay,
      [A.CANCEL, A.RESCHEDULE, A.NO_SHOW],
    ],
    ['ATTENDED today, no note, unpaid', S.ATTENDED, started, [A.UNDO_ATTEND]],
    [
      'ATTENDED today with a note',
      S.ATTENDED,
      { ...started, visitHasNote: true },
      [],
    ],
    [
      'ATTENDED today with payments',
      S.ATTENDED,
      { ...started, invoiceHasPayments: true },
      [],
    ],
    ['ATTENDED on a past day', S.ATTENDED, pastDay, []],
    ['NO_SHOW today', S.NO_SHOW, started, [A.UNDO_NO_SHOW]],
    ['NO_SHOW on a past day', S.NO_SHOW, pastDay, []],
    ['CANCELLED', S.CANCELLED, started, []],
    ['RESCHEDULED', S.RESCHEDULED, started, []],
  ])('%s', (_name, status, facts, expected) => {
    expect(allowedDeskActions(status, facts)).toEqual(expected);
  });

  it('agrees with assertDeskAction for every status, action and situation', () => {
    const situations: ActionFacts[] = [
      today,
      started,
      pastDay,
      futureDay,
      { ...started, visitHasNote: true },
      { ...started, invoiceHasPayments: true },
    ];
    for (const status of Object.values(S)) {
      for (const facts of situations) {
        const allowed = allowedDeskActions(status, facts);
        for (const action of Object.values(A)) {
          const code = codeOf(() => assertDeskAction(action, status, facts));
          expect(code === undefined).toBe(allowed.includes(action));
        }
      }
    }
  });
});

describe('assertDeskAction error codes', () => {
  it.each<[string, A, S, ActionFacts, string]>([
    [
      'no-show before the start',
      A.NO_SHOW,
      S.CONFIRMED,
      today,
      'NO_SHOW_TOO_EARLY',
    ],
    [
      'attend on another day',
      A.ATTEND,
      S.CONFIRMED,
      pastDay,
      'ATTEND_WRONG_DAY',
    ],
    [
      'undo attend on another day',
      A.UNDO_ATTEND,
      S.ATTENDED,
      pastDay,
      'UNDO_WRONG_DAY',
    ],
    [
      'undo attend with a note',
      A.UNDO_ATTEND,
      S.ATTENDED,
      { ...started, visitHasNote: true },
      'VISIT_HAS_NOTE',
    ],
    [
      'undo attend with payments',
      A.UNDO_ATTEND,
      S.ATTENDED,
      { ...started, invoiceHasPayments: true },
      'INVOICE_HAS_PAYMENTS',
    ],
    [
      'undo no-show on another day',
      A.UNDO_NO_SHOW,
      S.NO_SHOW,
      pastDay,
      'UNDO_WRONG_DAY',
    ],
    [
      'confirm an attended appointment',
      A.CONFIRM,
      S.ATTENDED,
      started,
      'INVALID_STATUS_TRANSITION',
    ],
  ])('%s -> %s', (_name, action, status, facts, code) => {
    expect(codeOf(() => assertDeskAction(action, status, facts))).toBe(code);
  });
});

describe('walk-ins', () => {
  it('can be undone while active, today, without a note or payments', () => {
    expect(allowedWalkInActions(true, { isToday: true })).toEqual([
      A.UNDO_ATTEND,
    ]);
    expect(codeOf(() => assertWalkInUndo({ isToday: true }))).toBeUndefined();
  });

  it.each<[string, boolean, ActionFacts, string | undefined]>([
    ['voided', false, { isToday: true }, undefined],
    ['another day', true, { isToday: false }, 'UNDO_WRONG_DAY'],
    [
      'with a note',
      true,
      { isToday: true, visitHasNote: true },
      'VISIT_HAS_NOTE',
    ],
    [
      'with payments',
      true,
      { isToday: true, invoiceHasPayments: true },
      'INVOICE_HAS_PAYMENTS',
    ],
  ])('cannot be undone: %s', (_name, active, facts, code) => {
    expect(allowedWalkInActions(active, facts)).toEqual([]);
    if (code) expect(codeOf(() => assertWalkInUndo(facts))).toBe(code);
  });
});
