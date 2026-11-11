import { MigrationInterface, QueryRunner } from 'typeorm';

export class Packages1793401623289 implements MigrationInterface {
  name = 'Packages1793401623289';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "packages" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(120) NOT NULL, "service_id" uuid NOT NULL, "sessions_count" integer NOT NULL, "price" numeric(12,2) NOT NULL, "all_doctors" boolean NOT NULL DEFAULT false, "offer_type" "public"."discount_type", "offer_value" numeric(12,2), "offer_starts_on" date, "offer_ends_on" date, "is_public" boolean NOT NULL DEFAULT true, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "chk_packages_offer" CHECK (("offer_type" IS NULL AND "offer_value" IS NULL AND "offer_starts_on" IS NULL AND "offer_ends_on" IS NULL)
   OR ("offer_type" IS NOT NULL AND "offer_value" > 0
       AND ("offer_type" <> 'PERCENT' OR "offer_value" <= 100)
       AND ("offer_type" <> 'FIXED' OR "offer_value" <= "price")
       AND ("offer_starts_on" IS NULL OR "offer_ends_on" IS NULL OR "offer_starts_on" <= "offer_ends_on"))), CONSTRAINT "chk_packages_price_non_negative" CHECK ("price" >= 0), CONSTRAINT "chk_packages_sessions_positive" CHECK ("sessions_count" > 0), CONSTRAINT "PK_020801f620e21f943ead9311c98" PRIMARY KEY ("id"))`);
    await queryRunner.query(
      `CREATE INDEX "idx_packages_service_id" ON "packages"  ("service_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "package_doctors" ("package_id" uuid NOT NULL, "doctor_id" uuid NOT NULL, CONSTRAINT "PK_2b1d28b907d2c98bf3d1b406ef1" PRIMARY KEY ("package_id", "doctor_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_package_doctors_doctor_id" ON "package_doctors"  ("doctor_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."patient_package_status" AS ENUM('ACTIVE', 'FINISHED', 'CANCELLED')`,
    );
    await queryRunner.query(`CREATE TABLE "patient_packages" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "patient_id" uuid NOT NULL, "package_id" uuid NOT NULL, "service_id" uuid NOT NULL, "name" character varying(120) NOT NULL, "list_price" numeric(12,2) NOT NULL, "offer_amount" numeric(12,2) NOT NULL DEFAULT '0', "price" numeric(12,2) NOT NULL, "total_sessions" integer NOT NULL, "used_sessions" integer NOT NULL DEFAULT '0', "invoice_id" uuid NOT NULL, "status" "public"."patient_package_status" NOT NULL, "sold_by" uuid NOT NULL, "sold_at" TIMESTAMP WITH TIME ZONE NOT NULL, "cancelled_at" TIMESTAMP WITH TIME ZONE, "cancelled_by" uuid, "cancel_reason" character varying(255), CONSTRAINT "uq_patient_packages_invoice" UNIQUE ("invoice_id"), CONSTRAINT "chk_patient_packages_status" CHECK (("status" = 'ACTIVE' AND "used_sessions" < "total_sessions" AND "cancelled_at" IS NULL AND "cancelled_by" IS NULL AND "cancel_reason" IS NULL)
   OR ("status" = 'FINISHED' AND "used_sessions" = "total_sessions" AND "cancelled_at" IS NULL AND "cancelled_by" IS NULL AND "cancel_reason" IS NULL)
   OR ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL AND "cancel_reason" IS NOT NULL)), CONSTRAINT "chk_patient_packages_amounts" CHECK ("list_price" >= 0 AND "offer_amount" >= 0 AND "price" >= 0 AND "price" = "list_price" - "offer_amount"), CONSTRAINT "chk_patient_packages_sessions" CHECK ("total_sessions" > 0 AND "used_sessions" >= 0 AND "used_sessions" <= "total_sessions"), CONSTRAINT "PK_f9649d23916a19712895263a665" PRIMARY KEY ("id"))`);
    await queryRunner.query(
      `CREATE INDEX "idx_patient_packages_package_id" ON "patient_packages"  ("package_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_patient_packages_patient_sold" ON "patient_packages"  ("patient_id", "sold_at") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."package_usage_reason" AS ENUM('ATTENDED', 'NO_SHOW')`,
    );
    await queryRunner.query(`CREATE TABLE "package_usages" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "patient_package_id" uuid NOT NULL, "reason" "public"."package_usage_reason" NOT NULL, "visit_id" uuid, "appointment_id" uuid, "used_at" TIMESTAMP WITH TIME ZONE NOT NULL, "used_by" uuid NOT NULL, "restored_at" TIMESTAMP WITH TIME ZONE, "restored_by" uuid, "restore_reason" character varying(255), CONSTRAINT "chk_package_usages_restored" CHECK (("restored_at" IS NULL AND "restored_by" IS NULL AND "restore_reason" IS NULL)
   OR ("restored_at" IS NOT NULL AND "restored_by" IS NOT NULL AND "restore_reason" IS NOT NULL)), CONSTRAINT "chk_package_usages_source" CHECK (("reason" = 'ATTENDED' AND "visit_id" IS NOT NULL AND "appointment_id" IS NULL)
   OR ("reason" = 'NO_SHOW' AND "appointment_id" IS NOT NULL AND "visit_id" IS NULL)), CONSTRAINT "PK_0ff5fe60ff400c3c878701dd22c" PRIMARY KEY ("id"))`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_package_usages_appointment_active" ON "package_usages"  ("appointment_id") WHERE "restored_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_package_usages_visit_active" ON "package_usages"  ("visit_id") WHERE "restored_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_package_usages_patient_package" ON "package_usages"  ("patient_package_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "packages" ADD CONSTRAINT "fk_packages_service" FOREIGN KEY ("service_id") REFERENCES "clinic_services"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "package_doctors" ADD CONSTRAINT "fk_package_doctors_package" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "package_doctors" ADD CONSTRAINT "fk_package_doctors_doctor" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_packages" ADD CONSTRAINT "fk_patient_packages_patient" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_packages" ADD CONSTRAINT "fk_patient_packages_package" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_packages" ADD CONSTRAINT "fk_patient_packages_service" FOREIGN KEY ("service_id") REFERENCES "clinic_services"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_packages" ADD CONSTRAINT "fk_patient_packages_invoice" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_packages" ADD CONSTRAINT "fk_patient_packages_sold_by" FOREIGN KEY ("sold_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_packages" ADD CONSTRAINT "fk_patient_packages_cancelled_by" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "package_usages" ADD CONSTRAINT "fk_package_usages_patient_package" FOREIGN KEY ("patient_package_id") REFERENCES "patient_packages"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "package_usages" ADD CONSTRAINT "fk_package_usages_visit" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "package_usages" ADD CONSTRAINT "fk_package_usages_appointment" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "package_usages" ADD CONSTRAINT "fk_package_usages_used_by" FOREIGN KEY ("used_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "package_usages" ADD CONSTRAINT "fk_package_usages_restored_by" FOREIGN KEY ("restored_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "package_usages" DROP CONSTRAINT "fk_package_usages_restored_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "package_usages" DROP CONSTRAINT "fk_package_usages_used_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "package_usages" DROP CONSTRAINT "fk_package_usages_appointment"`,
    );
    await queryRunner.query(
      `ALTER TABLE "package_usages" DROP CONSTRAINT "fk_package_usages_visit"`,
    );
    await queryRunner.query(
      `ALTER TABLE "package_usages" DROP CONSTRAINT "fk_package_usages_patient_package"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_packages" DROP CONSTRAINT "fk_patient_packages_cancelled_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_packages" DROP CONSTRAINT "fk_patient_packages_sold_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_packages" DROP CONSTRAINT "fk_patient_packages_invoice"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_packages" DROP CONSTRAINT "fk_patient_packages_service"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_packages" DROP CONSTRAINT "fk_patient_packages_package"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_packages" DROP CONSTRAINT "fk_patient_packages_patient"`,
    );
    await queryRunner.query(
      `ALTER TABLE "package_doctors" DROP CONSTRAINT "fk_package_doctors_doctor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "package_doctors" DROP CONSTRAINT "fk_package_doctors_package"`,
    );
    await queryRunner.query(
      `ALTER TABLE "packages" DROP CONSTRAINT "fk_packages_service"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_package_usages_patient_package"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_package_usages_visit_active"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_package_usages_appointment_active"`,
    );
    await queryRunner.query(`DROP TABLE "package_usages"`);
    await queryRunner.query(`DROP TYPE "public"."package_usage_reason"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_patient_packages_patient_sold"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_patient_packages_package_id"`,
    );
    await queryRunner.query(`DROP TABLE "patient_packages"`);
    await queryRunner.query(`DROP TYPE "public"."patient_package_status"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_package_doctors_doctor_id"`,
    );
    await queryRunner.query(`DROP TABLE "package_doctors"`);
    await queryRunner.query(`DROP INDEX "public"."idx_packages_service_id"`);
    await queryRunner.query(`DROP TABLE "packages"`);
  }
}
