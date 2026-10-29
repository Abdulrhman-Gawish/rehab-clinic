import { AppException } from '../../common/errors/app.exception.js';
import {
  allowedVisitTransitions,
  assertVisitTransition,
  canVisitTransition,
} from './visit-state-machine.js';
import { VisitStatus as V } from './visit.enums.js';

const ALLOWED: [V, V][] = [
  [V.WAITING, V.IN_SESSION],
  [V.WAITING, V.CANCELLED],
  [V.IN_SESSION, V.COMPLETED],
];
const ALL = Object.values(V);
const FORBIDDEN = ALL.flatMap((from) =>
  ALL.map((to): [V, V] => [from, to]),
).filter(([from, to]) => !ALLOWED.some(([f, t]) => f === from && t === to));

describe('visit state machine', () => {
  it.each(ALLOWED)('allows %s -> %s', (from, to) => {
    expect(canVisitTransition(from, to)).toBe(true);
    expect(() => assertVisitTransition(from, to)).not.toThrow();
  });

  it.each(FORBIDDEN)('forbids %s -> %s with 422', (from, to) => {
    try {
      assertVisitTransition(from, to);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).getStatus()).toBe(422);
      expect((error as AppException).code).toBe('INVALID_VISIT_TRANSITION');
    }
  });

  it('never reopens COMPLETED or CANCELLED visits', () => {
    expect(allowedVisitTransitions(V.COMPLETED)).toEqual([]);
    expect(allowedVisitTransitions(V.CANCELLED)).toEqual([]);
  });

  it('IN_SESSION cannot be cancelled', () => {
    expect(canVisitTransition(V.IN_SESSION, V.CANCELLED)).toBe(false);
  });

  it('covers all 16 pairs', () => {
    expect(ALLOWED.length + FORBIDDEN.length).toBe(16);
  });
});
