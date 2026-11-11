import { MigrationInterface, QueryRunner } from 'typeorm';

export class PatientsDoctorsServices1793310152221 implements MigrationInterface {
  name = 'PatientsDoctorsServices1793310152221';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "clinic_services" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(120) NOT NULL, "description" text, "duration_minutes" integer NOT NULL, "base_price" numeric(12,2) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "chk_clinic_services_base_price_non_negative" CHECK (base_price >= 0), CONSTRAINT "chk_clinic_services_duration_positive" CHECK (duration_minutes > 0), CONSTRAINT "PK_f351cd55bc942f6a5ac36abf3fe" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "doctors" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "specialty" character varying(120) NOT NULL, "bio" text, "photo_url" character varying(500), "is_public" boolean NOT NULL DEFAULT true, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "uq_doctors_user_id" UNIQUE ("user_id"), CONSTRAINT "PK_8207e7889b50ee3695c2b8154ff" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "doctor_services" ("doctor_id" uuid NOT NULL, "service_id" uuid NOT NULL, "price_override" numeric(12,2), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "chk_doctor_services_price_override_non_negative" CHECK (price_override IS NULL OR price_override >= 0), CONSTRAINT "PK_6c076fe4e383606e988414f18f7" PRIMARY KEY ("doctor_id", "service_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_doctor_services_service_id" ON "doctor_services"  ("service_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "patients" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(120) NOT NULL, "phone" character varying(20) NOT NULL, "date_of_birth" date, "gender" character varying(16), "notes" text, "created_source" character varying(16) NOT NULL, "created_by" uuid, CONSTRAINT "uq_patients_phone" UNIQUE ("phone"), CONSTRAINT "chk_patients_gender" CHECK (gender IS NULL OR gender IN ('MALE', 'FEMALE')), CONSTRAINT "chk_patients_created_source" CHECK (created_source IN ('ONLINE', 'RECEPTION')), CONSTRAINT "PK_a7f0b9fcbb3469d5ec0b0aceaa7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctors" ADD CONSTRAINT "fk_doctors_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_services" ADD CONSTRAINT "fk_doctor_services_doctor" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_services" ADD CONSTRAINT "fk_doctor_services_service" FOREIGN KEY ("service_id") REFERENCES "clinic_services"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" ADD CONSTRAINT "fk_patients_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    // Hand written: trigram index for fast ILIKE '%term%' search on names.
    // pg_trgm is a trusted extension (PG13+), so the DB owner can create it.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await queryRunner.query(
      `CREATE INDEX "idx_patients_name_trgm" ON "patients" USING gin ("name" gin_trgm_ops)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_patients_name_trgm"`);
    await queryRunner.query(`DROP EXTENSION IF EXISTS pg_trgm`);
    await queryRunner.query(
      `ALTER TABLE "patients" DROP CONSTRAINT "fk_patients_created_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_services" DROP CONSTRAINT "fk_doctor_services_service"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_services" DROP CONSTRAINT "fk_doctor_services_doctor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctors" DROP CONSTRAINT "fk_doctors_user"`,
    );
    await queryRunner.query(`DROP TABLE "patients"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_doctor_services_service_id"`,
    );
    await queryRunner.query(`DROP TABLE "doctor_services"`);
    await queryRunner.query(`DROP TABLE "doctors"`);
    await queryRunner.query(`DROP TABLE "clinic_services"`);
  }
}
