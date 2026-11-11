import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { DOCUMENT_PREFIX, DocumentScope } from './billing.enums.js';

/**
 * Gapless yearly document numbers: INV-2026-000123, RCP-..., EXP-...
 * MUST be called with the manager of the transaction that inserts the
 * document, so a rollback also releases the number (no gaps) and the
 * counter row lock serializes concurrent inserts (no duplicates).
 */
@Injectable()
export class DocumentCounterService {
  constructor(private readonly time: ClinicTimeService) {}

  async next(
    scope: DocumentScope,
    manager: EntityManager,
    at: Date = this.time.now(),
  ): Promise<string> {
    // Year of the document in clinic local time.
    const year = Number(this.time.localDate(at).slice(0, 4));
    const rows: { last_value: number }[] = await manager.query(
      `INSERT INTO document_counters (scope, year, last_value)
       VALUES ($1, $2, 1)
       ON CONFLICT (scope, year)
       DO UPDATE SET last_value = document_counters.last_value + 1
       RETURNING last_value`,
      [scope, year],
    );
    const value = String(rows[0].last_value).padStart(6, '0');
    return `${DOCUMENT_PREFIX[scope]}-${year}-${value}`;
  }
}
