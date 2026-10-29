import { MigrationInterface, QueryRunner } from 'typeorm';

export class InvoiceDiscounts1793315461994 implements MigrationInterface {
  name = 'InvoiceDiscounts1793315461994';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."discount_type" AS ENUM('PERCENT', 'FIXED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "invoice_discounts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "invoice_id" uuid NOT NULL, "patient_id" uuid NOT NULL, "type" "public"."discount_type" NOT NULL, "value" numeric(12,2) NOT NULL, "amount" numeric(12,2) NOT NULL, "reason" character varying(255) NOT NULL, "repeated_from_id" uuid, "applied_by" uuid NOT NULL, "applied_at" TIMESTAMP WITH TIME ZONE NOT NULL, "removed_at" TIMESTAMP WITH TIME ZONE, "removed_by" uuid, "removal_reason" character varying(255), CONSTRAINT "chk_invoice_discounts_removed" CHECK (("removed_at" IS NULL AND "removed_by" IS NULL) OR ("removed_at" IS NOT NULL AND "removed_by" IS NOT NULL)), CONSTRAINT "chk_invoice_discounts_reason" CHECK (length(trim("reason")) >= 3), CONSTRAINT "chk_invoice_discounts_amount_non_negative" CHECK ("amount" >= 0), CONSTRAINT "chk_invoice_discounts_value" CHECK (("type" = 'PERCENT' AND "value" > 0 AND "value" <= 100) OR ("type" = 'FIXED' AND "value" > 0)), CONSTRAINT "PK_27c169f24ffb614aedd9ee6f29b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_invoice_discounts_patient_applied" ON "invoice_discounts"  ("patient_id", "applied_at") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_invoice_discounts_active" ON "invoice_discounts"  ("invoice_id") WHERE "removed_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_discounts" ADD CONSTRAINT "fk_invoice_discounts_invoice" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_discounts" ADD CONSTRAINT "fk_invoice_discounts_patient" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_discounts" ADD CONSTRAINT "fk_invoice_discounts_repeated_from" FOREIGN KEY ("repeated_from_id") REFERENCES "invoice_discounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_discounts" ADD CONSTRAINT "fk_invoice_discounts_applied_by" FOREIGN KEY ("applied_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_discounts" ADD CONSTRAINT "fk_invoice_discounts_removed_by" FOREIGN KEY ("removed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_discounts" DROP CONSTRAINT "fk_invoice_discounts_removed_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_discounts" DROP CONSTRAINT "fk_invoice_discounts_applied_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_discounts" DROP CONSTRAINT "fk_invoice_discounts_repeated_from"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_discounts" DROP CONSTRAINT "fk_invoice_discounts_patient"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_discounts" DROP CONSTRAINT "fk_invoice_discounts_invoice"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_invoice_discounts_active"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_invoice_discounts_patient_applied"`,
    );
    await queryRunner.query(`DROP TABLE "invoice_discounts"`);
    await queryRunner.query(`DROP TYPE "public"."discount_type"`);
  }
}
