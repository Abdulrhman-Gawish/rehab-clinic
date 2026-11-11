import { MigrationInterface, QueryRunner } from 'typeorm';

export class Invoices1793314907504 implements MigrationInterface {
  name = 'Invoices1793314907504';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "document_counters" ("scope" character varying(16) NOT NULL, "year" integer NOT NULL, "last_value" integer NOT NULL, CONSTRAINT "chk_document_counters_last_value" CHECK (last_value > 0), CONSTRAINT "PK_97c2228a9eb477a8e7572198763" PRIMARY KEY ("scope", "year"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."invoice_status" AS ENUM('ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED')`,
    );
    await queryRunner.query(`CREATE TABLE "invoices" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "invoice_number" character varying(32) NOT NULL, "patient_id" uuid NOT NULL, "visit_id" uuid, "status" "public"."invoice_status" NOT NULL, "subtotal" numeric(12,2) NOT NULL, "discount_total" numeric(12,2) NOT NULL DEFAULT '0', "total" numeric(12,2) NOT NULL, "amount_paid" numeric(12,2) NOT NULL DEFAULT '0', "notes" text, "issued_by" uuid, "issued_at" TIMESTAMP WITH TIME ZONE NOT NULL, "cancelled_at" TIMESTAMP WITH TIME ZONE, "cancelled_by" uuid, "cancel_reason" character varying(255), CONSTRAINT "uq_invoices_invoice_number" UNIQUE ("invoice_number"), CONSTRAINT "chk_invoices_status_matches_amounts" CHECK (("status" = 'CANCELLED' AND "amount_paid" = 0 AND "cancelled_at" IS NOT NULL AND "cancel_reason" IS NOT NULL)
   OR ("status" = 'PAID' AND "amount_paid" = "total")
   OR ("status" = 'PARTIALLY_PAID' AND "amount_paid" > 0 AND "amount_paid" < "total")
   OR ("status" = 'ISSUED' AND "amount_paid" = 0 AND "total" > 0)), CONSTRAINT "chk_invoices_paid_not_above_total" CHECK ("amount_paid" <= "total"), CONSTRAINT "chk_invoices_total" CHECK ("total" = "subtotal" - "discount_total"), CONSTRAINT "chk_invoices_amounts_non_negative" CHECK ("subtotal" >= 0 AND "discount_total" >= 0 AND "total" >= 0 AND "amount_paid" >= 0), CONSTRAINT "PK_668cef7c22a427fd822cc1be3ce" PRIMARY KEY ("id"))`);
    await queryRunner.query(
      `CREATE INDEX "idx_invoices_issued_at" ON "invoices"  ("issued_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_invoices_status" ON "invoices"  ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_invoices_patient_issued" ON "invoices"  ("patient_id", "issued_at") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_invoices_visit_live" ON "invoices"  ("visit_id") WHERE "status" <> 'CANCELLED'`,
    );
    await queryRunner.query(
      `CREATE TABLE "invoice_items" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "invoice_id" uuid NOT NULL, "service_id" uuid, "description" character varying(255) NOT NULL, "unit_price" numeric(12,2) NOT NULL, "quantity" integer NOT NULL, "line_total" numeric(12,2) NOT NULL, "position" integer NOT NULL, CONSTRAINT "chk_invoice_items_line_total" CHECK ("line_total" = "unit_price" * "quantity"), CONSTRAINT "chk_invoice_items_unit_price_non_negative" CHECK ("unit_price" >= 0), CONSTRAINT "chk_invoice_items_quantity_positive" CHECK ("quantity" > 0), CONSTRAINT "PK_53b99f9e0e2945e69de1a12b75a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_invoice_items_invoice" ON "invoice_items"  ("invoice_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_patient" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_visit" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_issued_by" FOREIGN KEY ("issued_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_cancelled_by" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_items" ADD CONSTRAINT "fk_invoice_items_invoice" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_items" ADD CONSTRAINT "fk_invoice_items_service" FOREIGN KEY ("service_id") REFERENCES "clinic_services"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_items" DROP CONSTRAINT "fk_invoice_items_service"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_items" DROP CONSTRAINT "fk_invoice_items_invoice"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "fk_invoices_cancelled_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "fk_invoices_issued_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "fk_invoices_visit"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "fk_invoices_patient"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_invoice_items_invoice"`);
    await queryRunner.query(`DROP TABLE "invoice_items"`);
    await queryRunner.query(`DROP INDEX "public"."uq_invoices_visit_live"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_invoices_patient_issued"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_invoices_status"`);
    await queryRunner.query(`DROP INDEX "public"."idx_invoices_issued_at"`);
    await queryRunner.query(`DROP TABLE "invoices"`);
    await queryRunner.query(`DROP TYPE "public"."invoice_status"`);
    await queryRunner.query(`DROP TABLE "document_counters"`);
  }
}
