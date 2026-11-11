import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Billing correction: a replacement invoice points at the cancelled invoice
 * of the same visit it replaces (invoices.replaces_invoice_id). Each invoice
 * is replaced at most once (uq_invoices_replaces), only session invoices are
 * replaced and never by themselves (chk_invoices_replaces). Existing rows
 * replace nothing (NULL).
 */
export class InvoiceReplacements1794393712749 implements MigrationInterface {
  name = 'InvoiceReplacements1794393712749';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "replaces_invoice_id" uuid`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_invoices_replaces" ON "invoices"  ("replaces_invoice_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "chk_invoices_replaces" CHECK ("replaces_invoice_id" IS NULL OR ("replaces_invoice_id" <> "id" AND "visit_id" IS NOT NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_replaces" FOREIGN KEY ("replaces_invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "fk_invoices_replaces"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "chk_invoices_replaces"`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_invoices_replaces"`);
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP COLUMN "replaces_invoice_id"`,
    );
  }
}
