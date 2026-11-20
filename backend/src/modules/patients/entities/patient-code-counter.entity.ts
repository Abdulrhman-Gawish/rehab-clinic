import { Check, Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * The last sequence used for each 4 code digits (RH + digits + sequence).
 * Incremented with INSERT ... ON CONFLICT DO UPDATE ... RETURNING in the
 * transaction that gives the patient its code: the row lock serializes
 * concurrent registrations of one prefix, and a rollback gives the number
 * back (no gap, no duplicate).
 */
@Entity('patient_code_counters')
@Check('chk_patient_code_counters_last_value', 'last_value BETWEEN 1 AND 9999')
export class PatientCodeCounter {
  @PrimaryColumn({ type: 'varchar', length: 4 })
  prefix: string;

  @Column({ type: 'int' })
  lastValue: number;
}
