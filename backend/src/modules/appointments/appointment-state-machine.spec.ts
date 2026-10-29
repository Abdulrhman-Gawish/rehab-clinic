import { AppException } from '../../common/errors/app.exception.js';
import {
  allowedTransitions,
  assertTransition,
  canTransition,
} from './appointment-state-machine.js';
import { AppointmentStatus as S } from './appointment.enums.js';

const ALLOWED: [S, S][] = [
  [S.PENDING, S.CONFIRMED],
  [S.PENDING, S.CANCELLED],
  [S.CONFIRMED, S.CANCELLED],
  [S.CONFIRMED, S.NO_SHOW],
  [S.CONFIRMED, S.RESCHEDULED],
];

const ALL = Object.values(S);
const FORBIDDEN = ALL.flatMap((from) =>
  ALL.map((to): [S, S] => [from, to]),
).filter(([from, to]) => !ALLOWED.some(([f, t]) => f === from && t === to));

describe('appointment state machine', () => {
  it.each(ALLOWED)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it.each(FORBIDDEN)('forbids %s -> %s with 422', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    try {
      assertTransition(from, to);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).getStatus()).toBe(422);
      expect((error as AppException).code).toBe('INVALID_STATUS_TRANSITION');
    }
  });

  it('terminal statuses have no outgoing transitions', () => {
    for (const status of [S.NO_SHOW, S.CANCELLED, S.RESCHEDULED, S.COMPLETED]) {
      expect(allowedTransitions(status)).toEqual([]);
    }
  });

  it('covers all 49 pairs', () => {
    expect(ALLOWED.length + FORBIDDEN.length).toBe(49);
  });
});
