import { MigrationInterface, QueryRunner } from 'typeorm';

// Payments are manual desk records: the reference is optional for every
// method, and the Idempotency-Key columns are gone.
export class PaymentsManualReference1793318095089 implements MigrationInterface {
  name = 'PaymentsManualReference1793318095089';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "chk_payments_reference"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "uq_payments_idempotency_key"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN "idempotency_key"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN "idempotency_hash"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" ADD "idempotency_hash" character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD "idempotency_key" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "uq_payments_idempotency_key" UNIQUE ("idempotency_key")`,
    );
    // NOT VALID: rows recorded without a reference after `up` stay as they are.
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "chk_payments_reference" CHECK ("type" <> 'PAYMENT' OR "method" = 'CASH' OR "reference" IS NOT NULL) NOT VALID`,
    );
  }
}
