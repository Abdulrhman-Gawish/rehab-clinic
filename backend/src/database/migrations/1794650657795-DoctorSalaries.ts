import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Salaries of the clinic's doctors: versioned terms (fixed salary +
 * commission per session or per service, each FIXED or PERCENT), payments
 * (each one a clinic expense), and the reserved DOCTOR_SALARY expense
 * category.
 */

export class DoctorSalaries1794650657795 implements MigrationInterface {
  name = 'DoctorSalaries1794650657795';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "doctor_salary_payments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "doctor_id" uuid NOT NULL, "month" character varying(7) NOT NULL, "amount" numeric(12,2) NOT NULL, "payment_date" date NOT NULL, "method" "public"."payment_method" NOT NULL, "expense_id" uuid NOT NULL, "reference" character varying(100), "notes" character varying(255), "status" "public"."payment_status" NOT NULL DEFAULT 'VALID', "paid_by" uuid NOT NULL, "paid_at" TIMESTAMP WITH TIME ZONE NOT NULL, "voided_at" TIMESTAMP WITH TIME ZONE, "voided_by" uuid, "void_reason" character varying(255), CONSTRAINT "chk_doctor_salary_payments_voided" CHECK (("status" = 'VALID' AND "voided_at" IS NULL AND "voided_by" IS NULL AND "void_reason" IS NULL)
   OR ("status" = 'VOIDED' AND "voided_at" IS NOT NULL AND "voided_by" IS NOT NULL AND "void_reason" IS NOT NULL)), CONSTRAINT "chk_doctor_salary_payments_month" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'), CONSTRAINT "chk_doctor_salary_payments_amount_positive" CHECK ("amount" > 0), CONSTRAINT "PK_94097fdc301e2a6884ecbe78183" PRIMARY KEY ("id"))`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_doctor_salary_payments_expense" ON "doctor_salary_payments"  ("expense_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_doctor_salary_payments_doctor_month" ON "doctor_salary_payments"  ("doctor_id", "month") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."salary_commission_mode" AS ENUM('NONE', 'PER_SESSION', 'PER_SERVICE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."salary_rate_type" AS ENUM('FIXED', 'PERCENT')`,
    );
    await queryRunner.query(`CREATE TABLE "doctor_salary_terms" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "doctor_id" uuid NOT NULL, "effective_month" character varying(7) NOT NULL, "fixed_salary" numeric(12,2) NOT NULL, "commission_mode" "public"."salary_commission_mode" NOT NULL, "session_rate_type" "public"."salary_rate_type", "session_rate_value" numeric(12,2), "set_by" uuid NOT NULL, CONSTRAINT "uq_doctor_salary_terms_doctor_month" UNIQUE ("doctor_id", "effective_month"), CONSTRAINT "chk_doctor_salary_terms_session_rate" CHECK (("commission_mode" = 'PER_SESSION' AND "session_rate_type" IS NOT NULL AND "session_rate_value" IS NOT NULL)
   OR ("commission_mode" <> 'PER_SESSION' AND "session_rate_type" IS NULL AND "session_rate_value" IS NULL)), CONSTRAINT "chk_doctor_salary_terms_fixed" CHECK ("fixed_salary" >= 0), CONSTRAINT "chk_doctor_salary_terms_month" CHECK ("effective_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'), CONSTRAINT "PK_e70ee9dbaccf8238ec1e3bd3568" PRIMARY KEY ("id"))`);
    await queryRunner.query(
      `CREATE TABLE "doctor_salary_service_rates" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "terms_id" uuid NOT NULL, "service_id" uuid NOT NULL, "rate_type" "public"."salary_rate_type" NOT NULL, "value" numeric(12,2) NOT NULL, CONSTRAINT "uq_doctor_salary_service_rates_terms_service" UNIQUE ("terms_id", "service_id"), CONSTRAINT "chk_doctor_salary_service_rates_value" CHECK ("value" >= 0), CONSTRAINT "PK_1f4689d8ff4219684baf0747050" PRIMARY KEY ("id"))`,
    );
    // Hand written: the enum is rebuilt (not ADD VALUE) so the new key can be
    // used in this same transaction, then the reserved category of salary
    // payments is created.
    await queryRunner.query(
      `CREATE TYPE "public"."expense_category_key_new" AS ENUM('REFERRAL_COMMISSION', 'DOCTOR_SALARY')`,
    );
    await queryRunner.query(
      `ALTER TABLE "expense_categories" ALTER COLUMN "system_key" TYPE "public"."expense_category_key_new" USING "system_key"::"text"::"public"."expense_category_key_new"`,
    );
    await queryRunner.query(`DROP TYPE "public"."expense_category_key"`);
    await queryRunner.query(
      `ALTER TYPE "public"."expense_category_key_new" RENAME TO "expense_category_key"`,
    );
    await queryRunner.query(
      `INSERT INTO "expense_categories" ("name", "system_key") VALUES ($1, 'DOCTOR_SALARY')
       ON CONFLICT ("name") DO UPDATE SET "system_key" = 'DOCTOR_SALARY'`,
      ['رواتب وعمولات الأطباء'],
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_salary_payments" ADD CONSTRAINT "fk_doctor_salary_payments_doctor" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_salary_payments" ADD CONSTRAINT "fk_doctor_salary_payments_expense" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_salary_payments" ADD CONSTRAINT "fk_doctor_salary_payments_paid_by" FOREIGN KEY ("paid_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_salary_payments" ADD CONSTRAINT "fk_doctor_salary_payments_voided_by" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_salary_terms" ADD CONSTRAINT "fk_doctor_salary_terms_doctor" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_salary_terms" ADD CONSTRAINT "fk_doctor_salary_terms_set_by" FOREIGN KEY ("set_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_salary_service_rates" ADD CONSTRAINT "fk_doctor_salary_service_rates_terms" FOREIGN KEY ("terms_id") REFERENCES "doctor_salary_terms"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_salary_service_rates" ADD CONSTRAINT "fk_doctor_salary_service_rates_service" FOREIGN KEY ("service_id") REFERENCES "clinic_services"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "doctor_salary_service_rates" DROP CONSTRAINT "fk_doctor_salary_service_rates_service"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_salary_service_rates" DROP CONSTRAINT "fk_doctor_salary_service_rates_terms"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_salary_terms" DROP CONSTRAINT "fk_doctor_salary_terms_set_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_salary_terms" DROP CONSTRAINT "fk_doctor_salary_terms_doctor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_salary_payments" DROP CONSTRAINT "fk_doctor_salary_payments_voided_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_salary_payments" DROP CONSTRAINT "fk_doctor_salary_payments_paid_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_salary_payments" DROP CONSTRAINT "fk_doctor_salary_payments_expense"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_salary_payments" DROP CONSTRAINT "fk_doctor_salary_payments_doctor"`,
    );
    // Hand written: the salary payments' expenses stay as plain expenses in a
    // category without a system key.
    await queryRunner.query(
      `DELETE FROM "expense_categories" c WHERE c."system_key" = 'DOCTOR_SALARY'
         AND NOT EXISTS (SELECT 1 FROM "expenses" e WHERE e."category_id" = c."id")`,
    );
    await queryRunner.query(
      `UPDATE "expense_categories" SET "system_key" = NULL WHERE "system_key" = 'DOCTOR_SALARY'`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."expense_category_key_old" AS ENUM('REFERRAL_COMMISSION')`,
    );
    await queryRunner.query(
      `ALTER TABLE "expense_categories" ALTER COLUMN "system_key" TYPE "public"."expense_category_key_old" USING "system_key"::"text"::"public"."expense_category_key_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."expense_category_key"`);
    await queryRunner.query(
      `ALTER TYPE "public"."expense_category_key_old" RENAME TO "expense_category_key"`,
    );
    await queryRunner.query(`DROP TABLE "doctor_salary_service_rates"`);
    await queryRunner.query(`DROP TABLE "doctor_salary_terms"`);
    await queryRunner.query(`DROP TYPE "public"."salary_rate_type"`);
    await queryRunner.query(`DROP TYPE "public"."salary_commission_mode"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_doctor_salary_payments_doctor_month"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_doctor_salary_payments_expense"`,
    );
    await queryRunner.query(`DROP TABLE "doctor_salary_payments"`);
  }
}
