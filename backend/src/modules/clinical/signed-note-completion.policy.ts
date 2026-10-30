import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type {
  VisitCompletionContext,
  VisitCompletionDecision,
  VisitCompletionPolicy,
} from '../visits/visit-completion-policy.js';
import { NoteStatus } from './clinical.enums.js';
import { ClinicalNote } from './entities/clinical-note.entity.js';

// Bound in VisitsModule: a visit is completed only once its note is SIGNED.
@Injectable()
export class SignedNoteCompletionPolicy implements VisitCompletionPolicy {
  async check(
    { visit }: VisitCompletionContext,
    manager: EntityManager,
  ): Promise<VisitCompletionDecision> {
    const note = await manager.findOne(ClinicalNote, {
      where: { visitId: visit.id },
      select: { id: true, status: true },
    });
    if (note?.status === NoteStatus.SIGNED) return { allowed: true };
    return {
      allowed: false,
      reason: note
        ? 'Sign the clinical note before completing the visit'
        : 'Write and sign the clinical note before completing the visit',
    };
  }
}
