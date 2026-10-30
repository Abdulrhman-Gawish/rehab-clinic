import type { EntityManager } from 'typeorm';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import type { Visit } from './entities/visit.entity.js';

/**
 * Hook consulted inside the completion transaction, before anything is
 * written. VisitsModule binds SignedNoteCompletionPolicy (clinical module):
 * the visit's note must be SIGNED.
 */
export const VISIT_COMPLETION_POLICY = Symbol('VISIT_COMPLETION_POLICY');

export interface VisitCompletionContext {
  visit: Visit;
  actor: Actor;
}

export type VisitCompletionDecision =
  { allowed: true } | { allowed: false; reason: string };

export interface VisitCompletionPolicy {
  // `manager` is the completion transaction (read with it for consistency).
  check(
    context: VisitCompletionContext,
    manager: EntityManager,
  ): Promise<VisitCompletionDecision>;
}
