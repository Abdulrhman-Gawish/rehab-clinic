import { MigrationInterface, QueryRunner } from 'typeorm';
import { backfillInvoiceTotalChanges } from '../invoice-total-changes-backfill.js';

/**
 * The history of each invoice's total (invoice_total_changes), so a past
 * day's balances use the totals in effect then: a discount or item edit made
 * later must not change them.
 *
 * Existing invoices are backfilled from the audit log, which recorded the
 * resulting total of every change (INVOICE_CREATED `total`, item changes
 * `invoice.total`, discount changes `invoiceTotal`). An invoice whose
 * audited history is incomplete (no creation row, or a last total that is
 * not its current total) gets a single row, its current total from its
 * issue: exactly how balances were computed before.
 */
export class InvoiceTotalChanges1794657758642 implements MigrationInterface {
  name = 'InvoiceTotalChanges1794657758642';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "invoice_total_changes" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "invoice_id" uuid NOT NULL, "changed_at" TIMESTAMP WITH TIME ZONE NOT NULL, "total" numeric(12,2) NOT NULL, CONSTRAINT "uq_invoice_total_changes_invoice_at" UNIQUE ("invoice_id", "changed_at"), CONSTRAINT "chk_invoice_total_changes_total" CHECK ("total" >= 0), CONSTRAINT "PK_741db6e47790dfeffb975ea8f93" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_total_changes" ADD CONSTRAINT "fk_invoice_total_changes_invoice" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await backfillInvoiceTotalChanges(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_total_changes" DROP CONSTRAINT "fk_invoice_total_changes_invoice"`,
    );
    await queryRunner.query(`DROP TABLE "invoice_total_changes"`);
  }
}
