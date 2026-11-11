import { AppException } from '../../common/errors/app.exception.js';
import {
  allowedTransitions,
  AppointmentTrigger as T,
  assertTransition,
  canTransition,
} from './appointment-state-machine.js';
import { AppointmentStatus as S } from './appointment.enums.js';

// Every allowed (from, to, trigger). Anything else must be rejected.
const ALLOWED: [S, S, T][] = [
  [S.PENDING, S.CONFIRMED, T.APPOINTMENT],
  [S.PENDING, S.CANCELLED, T.APPOINTMENT],
  [S.PENDING, S.RESCHEDULED, T.APPOINTMENT],
  [S.PENDING, S.NO_SHOW, T.APPOINTMENT],
  [S.PENDING, S.ATTENDED, T.ATTEND],
  [S.CONFIRMED, S.CANCELLED, T.APPOINTMENT],
  [S.CONFIRMED, S.RESCHEDULED, T.APPOINTMENT],
  [S.CONFIRMED, S.NO_SHOW, T.APPOINTMENT],
  [S.CONFIRMED, S.ATTENDED, T.ATTEND],
  [S.ATTENDED, S.CONFIRMED, T.UNDO_ATTEND],
  [S.NO_SHOW, S.CONFIRMED, T.UNDO_NO_SHOW],
];

const STATUSES = Object.values(S);
const TRIGGERS = Object.values(T);
const ALL: [S, S, T][] = STATUSES.flatMap((from) =>
  STATUSES.flatMap((to) => TRIGGERS.map((t): [S, S, T] => [from, to, t])),
);
const FORBIDDEN = ALL.filter(
  ([from, to, t]) =>
    !ALLOWED.some(([f, tt, trig]) => f === from && tt === to && trig === t),
);

describe('appointment state machine', () => {
  it.each(ALLOWED)('allows %s -> %s via %s', (from, to, trigger) => {
    expect(canTransition(from, to, trigger)).toBe(true);
    expect(() => assertTransition(from, to, trigger)).not.toThrow();
  });

  it.each(FORBIDDEN)(
    'forbids %s -> %s via %s with 422',
    (from, to, trigger) => {
      expect(canTransition(from, to, trigger)).toBe(false);
      try {
        assertTransition(from, to, trigger);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(AppException);
        expect((error as AppException).getStatus()).toBe(422);
        expect((error as AppException).code).toBe('INVALID_STATUS_TRANSITION');
      }
    },
  );

  it('confirm cannot undo an attendance or a no-show', () => {
    expect(allowedTransitions(S.ATTENDED)).toEqual([]);
    expect(allowedTransitions(S.NO_SHOW)).toEqual([]);
  });

  it('cancelled and rescheduled appointments are final', () => {
    for (const status of [S.CANCELLED, S.RESCHEDULED]) {
      for (const trigger of TRIGGERS) {
        expect(allowedTransitions(status, trigger)).toEqual([]);
      }
    }
  });

  it('covers every (from, to, trigger) combination', () => {
    expect(ALLOWED.length + FORBIDDEN.length).toBe(6 * 6 * TRIGGERS.length);
  });
});
