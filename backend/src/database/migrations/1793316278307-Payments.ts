import { MigrationInterface, QueryRunner } from 'typeorm';

export class Payments1793316278307 implements MigrationInterface {
  name = 'Payments1793316278307';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."payment_type" AS ENUM('PAYMENT', 'REFUND')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."payment_status" AS ENUM('VALID', 'VOIDED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."payment_method" AS ENUM('CASH', 'CARD', 'WALLET', 'INSTAPAY')`,
    );
    await queryRunner.query(`CREATE TABLE "payments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "receipt_number" character varying(32) NOT NULL, "invoice_id" uuid NOT NULL, "patient_id" uuid NOT NULL, "type" "public"."payment_type" NOT NULL, "status" "public"."payment_status" NOT NULL DEFAULT 'VALID', "amount" numeric(12,2) NOT NULL, "method" "public"."payment_method" NOT NULL, "reference" character varying(100), "reason" character varying(255), "idempotency_key" character varying(100), "idempotency_hash" character varying(64), "received_by" uuid NOT NULL, "received_at" TIMESTAMP WITH TIME ZONE NOT NULL, "voided_at" TIMESTAMP WITH TIME ZONE, "voided_by" uuid, "void_reason" character varying(255), "refund_of_id" uuid, CONSTRAINT "uq_payments_idempotency_key" UNIQUE ("idempotency_key"), CONSTRAINT "uq_payments_receipt_number" UNIQUE ("receipt_number"), CONSTRAINT "chk_payments_voided" CHECK (("status" = 'VALID' AND "voided_at" IS NULL AND "voided_by" IS NULL AND "void_reason" IS NULL)
   OR ("status" = 'VOIDED' AND "voided_at" IS NOT NULL AND "voided_by" IS NOT NULL AND "void_reason" IS NOT NULL)), CONSTRAINT "chk_payments_reference" CHECK ("type" <> 'PAYMENT' OR "method" = 'CASH' OR "reference" IS NOT NULL), CONSTRAINT "chk_payments_refund_shape" CHECK (("type" = 'REFUND' AND "refund_of_id" IS NOT NULL AND "reason" IS NOT NULL) OR ("type" = 'PAYMENT' AND "refund_of_id" IS NULL)), CONSTRAINT "chk_payments_amount_positive" CHECK ("amount" > 0), CONSTRAINT "PK_197ab7af18c93fbb0c9b28b4a59" PRIMARY KEY ("id"))`);
    await queryRunner.query(
      `CREATE INDEX "idx_payments_refund_of" ON "payments"  ("refund_of_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_payments_method_received_at" ON "payments"  ("method", "received_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_payments_received_at" ON "payments"  ("received_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_payments_invoice" ON "payments"  ("invoice_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "fk_payments_invoice" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "fk_payments_patient" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "fk_payments_received_by" FOREIGN KEY ("received_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "fk_payments_voided_by" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "fk_payments_refund_of" FOREIGN KEY ("refund_of_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "fk_payments_refund_of"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "fk_payments_voided_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "fk_payments_received_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "fk_payments_patient"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "fk_payments_invoice"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_payments_invoice"`);
    await queryRunner.query(`DROP INDEX "public"."idx_payments_received_at"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_payments_method_received_at"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_payments_refund_of"`);
    await queryRunner.query(`DROP TABLE "payments"`);
    await queryRunner.query(`DROP TYPE "public"."payment_method"`);
    await queryRunner.query(`DROP TYPE "public"."payment_status"`);
    await queryRunner.query(`DROP TYPE "public"."payment_type"`);
  }
}
