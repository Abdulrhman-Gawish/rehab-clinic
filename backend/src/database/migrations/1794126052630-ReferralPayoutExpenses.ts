import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Partial payouts to referring doctors, and every payout recorded as a
 * clinic expense (referral_payouts.expense_id, NOT NULL and unique).
 * Existing payouts (each settled whole commission rows) get one allocation
 * per row they settled, their local payout date and their expense.
 */
export class ReferralPayoutExpenses1794126052630 implements MigrationInterface {
  name = 'ReferralPayoutExpenses1794126052630';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "referral_payout_allocations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "payout_id" uuid NOT NULL, "commission_id" uuid NOT NULL, "amount" numeric(12,2) NOT NULL, CONSTRAINT "uq_referral_payout_allocations_payout_commission" UNIQUE ("payout_id", "commission_id"), CONSTRAINT "chk_referral_payout_allocations_amount" CHECK ("amount" <> 0), CONSTRAINT "PK_41f2ef55ca1b17e7d80deff5845" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_referral_payout_allocations_commission" ON "referral_payout_allocations"  ("commission_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."expense_category_key" AS ENUM('REFERRAL_COMMISSION')`,
    );
    await queryRunner.query(
      `ALTER TABLE "expense_categories" ADD "system_key" "public"."expense_category_key"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_expense_categories_system_key" ON "expense_categories"  ("system_key") `,
    );
    // Hand written: the reserved category of referral payouts.
    await queryRunner.query(
      `INSERT INTO "expense_categories" ("name", "system_key") VALUES ($1, 'REFERRAL_COMMISSION')`,
      ['عمولات الأطباء المحيلين'],
    );
    // Added nullable, filled for existing payouts, then NOT NULL (below).
    await queryRunner.query(
      `ALTER TABLE "referral_payouts" ADD "payout_date" date`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_payouts" ADD "expense_id" uuid`,
    );

    // Hand written: existing payouts.
    // 1. Each one settled exactly the rows pointing at it.
    await queryRunner.query(
      `INSERT INTO "referral_payout_allocations" ("payout_id", "commission_id", "amount")
       SELECT "payout_id", "id", "amount" FROM "referral_commissions" WHERE "payout_id" IS NOT NULL`,
    );
    // 2. Paid on the clinic local day it was recorded.
    const zone = process.env.CLINIC_TIMEZONE ?? 'Africa/Cairo';
    await queryRunner.query(
      `UPDATE "referral_payouts" SET "payout_date" = ("paid_at" AT TIME ZONE $1)::date`,
      [zone],
    );
    // 3. One expense each, numbered after the expenses of its year (the
    //    counter moves on), VOIDED with a voided payout.
    await queryRunner.query(
      `WITH numbered AS (
         SELECT p.*, d.name AS doctor_name, gen_random_uuid() AS new_expense_id,
                EXTRACT(YEAR FROM p.paid_at AT TIME ZONE $1)::int AS year,
                ROW_NUMBER() OVER (PARTITION BY EXTRACT(YEAR FROM p.paid_at AT TIME ZONE $1)
                                   ORDER BY p.paid_at, p.id) AS n
           FROM referral_payouts p JOIN referring_doctors d ON d.id = p.referring_doctor_id
       ), per_year AS (
         SELECT year, COUNT(*) AS count FROM numbered GROUP BY year
       ), counters AS (
         INSERT INTO document_counters (scope, year, last_value)
         SELECT 'EXPENSE', year, count FROM per_year
         ON CONFLICT (scope, year)
         DO UPDATE SET last_value = document_counters.last_value + EXCLUDED.last_value
         RETURNING year, last_value
       ), added AS (
         INSERT INTO expenses (id, expense_number, category_id, description, amount, expense_date,
                               vendor_name, payment_method, reference, status, created_by, created_at,
                               voided_at, voided_by, void_reason)
         SELECT n.new_expense_id,
                'EXP-' || n.year || '-' || lpad((c.last_value - y.count + n.n)::text, 6, '0'),
                (SELECT id FROM expense_categories WHERE system_key = 'REFERRAL_COMMISSION'),
                left('Referral commission: ' || n.doctor_name, 255), n.amount, n.payout_date,
                left(n.doctor_name, 120), n.method, n.reference,
                (CASE WHEN n.status = 'VALID' THEN 'VALID' ELSE 'VOIDED' END)::expense_status,
                n.paid_by, n.paid_at, n.voided_at, n.voided_by, n.void_reason
           FROM numbered n
           JOIN per_year y ON y.year = n.year
           JOIN counters c ON c.year = n.year
         RETURNING id
       )
       UPDATE referral_payouts p SET expense_id = n.new_expense_id
         FROM numbered n WHERE n.id = p.id`,
      [zone],
    );

    await queryRunner.query(
      `ALTER TABLE "referral_payouts" ALTER COLUMN "payout_date" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_payouts" ALTER COLUMN "expense_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_referral_payouts_expense" ON "referral_payouts"  ("expense_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_payouts" ADD CONSTRAINT "fk_referral_payouts_expense" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_payout_allocations" ADD CONSTRAINT "fk_referral_payout_allocations_payout" FOREIGN KEY ("payout_id") REFERENCES "referral_payouts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_payout_allocations" ADD CONSTRAINT "fk_referral_payout_allocations_commission" FOREIGN KEY ("commission_id") REFERENCES "referral_commissions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  // Back to whole-row payouts kept apart from expenses. A row a payout paid
  // only in part is fully owed again, and the payouts' expenses are removed
  // (their numbers are not reused).
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "referral_payout_allocations" DROP CONSTRAINT "fk_referral_payout_allocations_commission"`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_payout_allocations" DROP CONSTRAINT "fk_referral_payout_allocations_payout"`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_payouts" DROP CONSTRAINT "fk_referral_payouts_expense"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_referral_payouts_expense"`,
    );
    // Hand written: the payouts' expenses and their reserved category.
    await queryRunner.query(
      `DELETE FROM "expenses" WHERE "id" IN (SELECT "expense_id" FROM "referral_payouts")`,
    );
    await queryRunner.query(
      `DELETE FROM "expense_categories" WHERE "system_key" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_payouts" DROP COLUMN "expense_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_payouts" DROP COLUMN "payout_date"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_expense_categories_system_key"`,
    );
    await queryRunner.query(
      `ALTER TABLE "expense_categories" DROP COLUMN "system_key"`,
    );
    await queryRunner.query(`DROP TYPE "public"."expense_category_key"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_referral_payout_allocations_commission"`,
    );
    await queryRunner.query(`DROP TABLE "referral_payout_allocations"`);
  }
}
