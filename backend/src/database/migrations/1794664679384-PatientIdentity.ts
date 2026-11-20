import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Patient identity collected at check-in: National ID (or a passport for a
 * non-Egyptian), and the clinic code RH + 4 digits + 4-digit sequence, with
 * its per-prefix counter (patient_code_counters). Existing patients get
 * their code when their identity document is first recorded.
 */
export class PatientIdentity1794664679384 implements MigrationInterface {
  name = 'PatientIdentity1794664679384';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "patient_code_counters" ("prefix" character varying(4) NOT NULL, "last_value" integer NOT NULL, CONSTRAINT "chk_patient_code_counters_last_value" CHECK (last_value BETWEEN 1 AND 9999), CONSTRAINT "PK_ff3515ae01788659e4c64e6e53e" PRIMARY KEY ("prefix"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" ADD "patient_code" character varying(10)`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" ADD CONSTRAINT "uq_patients_patient_code" UNIQUE ("patient_code")`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" ADD "national_id" character varying(14)`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" ADD CONSTRAINT "uq_patients_national_id" UNIQUE ("national_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" ADD "passport_number" character varying(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" ADD CONSTRAINT "uq_patients_passport_number" UNIQUE ("passport_number")`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" ADD CONSTRAINT "chk_patients_patient_code" CHECK (patient_code IS NULL OR patient_code ~ '^RH[0-9]{8}$')`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" ADD CONSTRAINT "chk_patients_one_id_document" CHECK (national_id IS NULL OR passport_number IS NULL)`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" ADD CONSTRAINT "chk_patients_passport_number" CHECK (passport_number IS NULL OR passport_number ~ '^[A-Z0-9]{5,20}$')`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" ADD CONSTRAINT "chk_patients_national_id" CHECK (national_id IS NULL OR national_id ~ '^[23][0-9]{13}$')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "patients" DROP CONSTRAINT "chk_patients_national_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" DROP CONSTRAINT "chk_patients_passport_number"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" DROP CONSTRAINT "chk_patients_one_id_document"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" DROP CONSTRAINT "chk_patients_patient_code"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" DROP CONSTRAINT "uq_patients_passport_number"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" DROP COLUMN "passport_number"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" DROP CONSTRAINT "uq_patients_national_id"`,
    );
    await queryRunner.query(`ALTER TABLE "patients" DROP COLUMN "national_id"`);
    await queryRunner.query(
      `ALTER TABLE "patients" DROP CONSTRAINT "uq_patients_patient_code"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" DROP COLUMN "patient_code"`,
    );
    await queryRunner.query(`DROP TABLE "patient_code_counters"`);
  }
}
