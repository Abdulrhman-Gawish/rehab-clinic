import { Check, Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Gapless yearly numbering (INV-2026-000123). Incremented with
 * INSERT ... ON CONFLICT DO UPDATE ... RETURNING inside the same transaction
 * as the document insert: a rollback also rolls the number back, and the
 * row lock serializes concurrent documents of one scope/year.
 */
@Entity('document_counters')
@Check('chk_document_counters_last_value', 'last_value > 0')
export class DocumentCounter {
  @PrimaryColumn({ type: 'varchar', length: 16 })
  scope: string;

  @PrimaryColumn({ type: 'int' })
  year: number;

  @Column({ type: 'int' })
  lastValue: number;
}
