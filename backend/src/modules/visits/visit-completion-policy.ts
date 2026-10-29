import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import type { Visit } from './entities/visit.entity.js';

/**
 * Hook consulted inside the completion transaction, before anything is
 * written. Stage 7 will bind a policy requiring a signed clinical note,
 * without touching VisitsService: implement VisitCompletionPolicy and bind it
 * to VISIT_COMPLETION_POLICY in VisitsModule.
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

// Default until clinical notes exist: every visit may be completed.
@Injectable()
export class AllowAllVisitCompletionPolicy implements VisitCompletionPolicy {
  check(): Promise<VisitCompletionDecision> {
    return Promise.resolve({ allowed: true });
  }
}
