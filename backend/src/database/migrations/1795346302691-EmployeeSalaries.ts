import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The clinic's employees (not doctors; a login account is optional) and
 * their fixed monthly salaries: versioned salaries, payments (each one a
 * clinic expense), and the reserved EMPLOYEE_SALARY expense category.
 */

export class EmployeeSalaries1795346302691 implements MigrationInterface {
  name = 'EmployeeSalaries1795346302691';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "employees" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(120) NOT NULL, "job_title" character varying(80) NOT NULL, "phone" character varying(20), "notes" text, "user_id" uuid, "is_active" boolean NOT NULL DEFAULT true, "created_by" uuid NOT NULL, CONSTRAINT "PK_b9535a98350d5b26e7eb0c26af4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_employees_user" ON "employees"  ("user_id") WHERE "user_id" IS NOT NULL`,
    );
    await queryRunner.query(`CREATE TABLE "employee_salary_payments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "employee_id" uuid NOT NULL, "month" character varying(7) NOT NULL, "amount" numeric(12,2) NOT NULL, "payment_date" date NOT NULL, "method" "public"."payment_method" NOT NULL, "expense_id" uuid NOT NULL, "reference" character varying(100), "notes" character varying(255), "status" "public"."payment_status" NOT NULL DEFAULT 'VALID', "paid_by" uuid NOT NULL, "paid_at" TIMESTAMP WITH TIME ZONE NOT NULL, "voided_at" TIMESTAMP WITH TIME ZONE, "voided_by" uuid, "void_reason" character varying(255), CONSTRAINT "chk_employee_salary_payments_voided" CHECK (("status" = 'VALID' AND "voided_at" IS NULL AND "voided_by" IS NULL AND "void_reason" IS NULL)
   OR ("status" = 'VOIDED' AND "voided_at" IS NOT NULL AND "voided_by" IS NOT NULL AND "void_reason" IS NOT NULL)), CONSTRAINT "chk_employee_salary_payments_month" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'), CONSTRAINT "chk_employee_salary_payments_amount_positive" CHECK ("amount" > 0), CONSTRAINT "PK_b753d21e830472d7eceff315341" PRIMARY KEY ("id"))`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_employee_salary_payments_expense" ON "employee_salary_payments"  ("expense_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_employee_salary_payments_employee_month" ON "employee_salary_payments"  ("employee_id", "month") `,
    );
    await queryRunner.query(
      `CREATE TABLE "employee_salary_terms" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "employee_id" uuid NOT NULL, "effective_month" character varying(7) NOT NULL, "fixed_salary" numeric(12,2) NOT NULL, "set_by" uuid NOT NULL, CONSTRAINT "uq_employee_salary_terms_employee_month" UNIQUE ("employee_id", "effective_month"), CONSTRAINT "chk_employee_salary_terms_fixed" CHECK ("fixed_salary" >= 0), CONSTRAINT "chk_employee_salary_terms_month" CHECK ("effective_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'), CONSTRAINT "PK_fe304ba20802160f7c5d30706e9" PRIMARY KEY ("id"))`,
    );
    // Hand written: the enum is rebuilt (not ADD VALUE) so the new key can be
    // used in this same transaction, then the reserved category of employee
    // salary payments is created.
    await queryRunner.query(
      `CREATE TYPE "public"."expense_category_key_new" AS ENUM('REFERRAL_COMMISSION', 'DOCTOR_SALARY', 'EMPLOYEE_SALARY')`,
    );
    await queryRunner.query(
      `ALTER TABLE "expense_categories" ALTER COLUMN "system_key" TYPE "public"."expense_category_key_new" USING "system_key"::"text"::"public"."expense_category_key_new"`,
    );
    await queryRunner.query(`DROP TYPE "public"."expense_category_key"`);
    await queryRunner.query(
      `ALTER TYPE "public"."expense_category_key_new" RENAME TO "expense_category_key"`,
    );
    await queryRunner.query(
      `INSERT INTO "expense_categories" ("name", "system_key") VALUES ($1, 'EMPLOYEE_SALARY')
       ON CONFLICT ("name") DO UPDATE SET "system_key" = 'EMPLOYEE_SALARY'`,
      ['رواتب الموظفين'],
    );
    await queryRunner.query(
      `ALTER TABLE "employees" ADD CONSTRAINT "fk_employees_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "employees" ADD CONSTRAINT "fk_employees_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "employee_salary_payments" ADD CONSTRAINT "fk_employee_salary_payments_employee" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "employee_salary_payments" ADD CONSTRAINT "fk_employee_salary_payments_expense" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "employee_salary_payments" ADD CONSTRAINT "fk_employee_salary_payments_paid_by" FOREIGN KEY ("paid_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "employee_salary_payments" ADD CONSTRAINT "fk_employee_salary_payments_voided_by" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "employee_salary_terms" ADD CONSTRAINT "fk_employee_salary_terms_employee" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "employee_salary_terms" ADD CONSTRAINT "fk_employee_salary_terms_set_by" FOREIGN KEY ("set_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "employee_salary_terms" DROP CONSTRAINT "fk_employee_salary_terms_set_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "employee_salary_terms" DROP CONSTRAINT "fk_employee_salary_terms_employee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "employee_salary_payments" DROP CONSTRAINT "fk_employee_salary_payments_voided_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "employee_salary_payments" DROP CONSTRAINT "fk_employee_salary_payments_paid_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "employee_salary_payments" DROP CONSTRAINT "fk_employee_salary_payments_expense"`,
    );
    await queryRunner.query(
      `ALTER TABLE "employee_salary_payments" DROP CONSTRAINT "fk_employee_salary_payments_employee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "employees" DROP CONSTRAINT "fk_employees_created_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "employees" DROP CONSTRAINT "fk_employees_user"`,
    );
    // Hand written: the salary payments' expenses stay as plain expenses in a
    // category without a system key.
    await queryRunner.query(
      `DELETE FROM "expense_categories" c WHERE c."system_key" = 'EMPLOYEE_SALARY'
         AND NOT EXISTS (SELECT 1 FROM "expenses" e WHERE e."category_id" = c."id")`,
    );
    await queryRunner.query(
      `UPDATE "expense_categories" SET "system_key" = NULL WHERE "system_key" = 'EMPLOYEE_SALARY'`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."expense_category_key_old" AS ENUM('REFERRAL_COMMISSION', 'DOCTOR_SALARY')`,
    );
    await queryRunner.query(
      `ALTER TABLE "expense_categories" ALTER COLUMN "system_key" TYPE "public"."expense_category_key_old" USING "system_key"::"text"::"public"."expense_category_key_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."expense_category_key"`);
    await queryRunner.query(
      `ALTER TYPE "public"."expense_category_key_old" RENAME TO "expense_category_key"`,
    );
    await queryRunner.query(`DROP TABLE "employee_salary_terms"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_employee_salary_payments_employee_month"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_employee_salary_payments_expense"`,
    );
    await queryRunner.query(`DROP TABLE "employee_salary_payments"`);
    await queryRunner.query(`DROP INDEX "public"."uq_employees_user"`);
    await queryRunner.query(`DROP TABLE "employees"`);
  }
}
