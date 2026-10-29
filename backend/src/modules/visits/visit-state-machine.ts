import { ErrorCode, unprocessable } from '../../common/errors/app.exception.js';
import { VisitStatus as V } from './visit.enums.js';

/**
 * The ONLY definition of allowed visit transitions. COMPLETED and CANCELLED
 * are final: visits are never reopened.
 */
const TRANSITIONS: Readonly<Record<V, readonly V[]>> = {
  [V.WAITING]: [V.IN_SESSION, V.CANCELLED],
  [V.IN_SESSION]: [V.COMPLETED],
  [V.COMPLETED]: [],
  [V.CANCELLED]: [],
};

export function allowedVisitTransitions(from: V): readonly V[] {
  return TRANSITIONS[from];
}

export function canVisitTransition(from: V, to: V): boolean {
  return TRANSITIONS[from].includes(to);
}

// Throws 422 INVALID_VISIT_TRANSITION for anything not listed above.
export function assertVisitTransition(from: V, to: V): void {
  if (!canVisitTransition(from, to)) {
    throw unprocessable(
      ErrorCode.INVALID_VISIT_TRANSITION,
      `Cannot change a visit from ${from} to ${to}`,
      { from, to, allowed: TRANSITIONS[from] },
    );
  }
}
