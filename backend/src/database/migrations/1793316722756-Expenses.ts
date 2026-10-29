import { MigrationInterface, QueryRunner } from 'typeorm';

export class Expenses1793316722756 implements MigrationInterface {
  name = 'Expenses1793316722756';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "expense_categories" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(80) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "uq_expense_categories_name" UNIQUE ("name"), CONSTRAINT "PK_d0ef31e189d9523461215b62775" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."expense_status" AS ENUM('VALID', 'VOIDED')`,
    );
    await queryRunner.query(`CREATE TABLE "expenses" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "expense_number" character varying(32) NOT NULL, "category_id" uuid NOT NULL, "description" character varying(255) NOT NULL, "amount" numeric(12,2) NOT NULL, "expense_date" date NOT NULL, "vendor_name" character varying(120), "payment_method" "public"."payment_method" NOT NULL, "reference" character varying(100), "receipt_file_key" character varying(255), "status" "public"."expense_status" NOT NULL DEFAULT 'VALID', "created_by" uuid NOT NULL, "voided_at" TIMESTAMP WITH TIME ZONE, "voided_by" uuid, "void_reason" character varying(255), CONSTRAINT "uq_expenses_expense_number" UNIQUE ("expense_number"), CONSTRAINT "chk_expenses_voided" CHECK (("status" = 'VALID' AND "voided_at" IS NULL AND "voided_by" IS NULL AND "void_reason" IS NULL)
   OR ("status" = 'VOIDED' AND "voided_at" IS NOT NULL AND "voided_by" IS NOT NULL AND "void_reason" IS NOT NULL)), CONSTRAINT "chk_expenses_amount_positive" CHECK ("amount" > 0), CONSTRAINT "PK_94c3ceb17e3140abc9282c20610" PRIMARY KEY ("id"))`);
    await queryRunner.query(
      `CREATE INDEX "idx_expenses_category_date" ON "expenses"  ("category_id", "expense_date") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_expenses_expense_date" ON "expenses"  ("expense_date") `,
    );
    await queryRunner.query(
      `ALTER TABLE "expenses" ADD CONSTRAINT "fk_expenses_category" FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "expenses" ADD CONSTRAINT "fk_expenses_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "expenses" ADD CONSTRAINT "fk_expenses_voided_by" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    // Hand written: default expense categories (reference data).
    await queryRunner.query(
      `INSERT INTO "expense_categories" ("name") VALUES ($1), ($2), ($3), ($4), ($5), ($6)`,
      ['ضيافة', 'مستلزمات طبية', 'أدوات مكتبية', 'صيانة', 'نظافة', 'أخرى'],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "expenses" DROP CONSTRAINT "fk_expenses_voided_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "expenses" DROP CONSTRAINT "fk_expenses_created_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "expenses" DROP CONSTRAINT "fk_expenses_category"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_expenses_expense_date"`);
    await queryRunner.query(`DROP INDEX "public"."idx_expenses_category_date"`);
    await queryRunner.query(`DROP TABLE "expenses"`);
    await queryRunner.query(`DROP TYPE "public"."expense_status"`);
    await queryRunner.query(`DROP TABLE "expense_categories"`);
  }
}
