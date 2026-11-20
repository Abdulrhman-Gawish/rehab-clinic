import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Appointment types (EXAMINATION, FOLLOW_UP, SESSION) and the Diagnosis
 * field of clinical notes.
 * - appointments.type: required by the API on every new booking; existing
 *   appointments stay NULL ("not set") until reception sets it.
 * - visits.type: a walk-in's own type (chosen at check-in). A visit of an
 *   appointment takes the appointment's type, so it is always NULL there
 *   (chk_visits_type_walk_in). Existing walk-ins stay NULL ("not set").
 * Nothing is backfilled: no type is guessed for existing data.
 */
export class AppointmentTypes1795095082277 implements MigrationInterface {
  name = 'AppointmentTypes1795095082277';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."appointment_type" AS ENUM('EXAMINATION', 'FOLLOW_UP', 'SESSION')`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD "type" "public"."appointment_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ADD "type" "public"."appointment_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ADD CONSTRAINT "chk_visits_type_walk_in" CHECK ("appointment_id" IS NULL OR "type" IS NULL)`,
    );
    await queryRunner.query(
      `ALTER TABLE "clinical_notes" ADD "diagnosis" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "clinical_notes" DROP COLUMN "diagnosis"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" DROP CONSTRAINT "chk_visits_type_walk_in"`,
    );
    await queryRunner.query(`ALTER TABLE "visits" DROP COLUMN "type"`);
    await queryRunner.query(`ALTER TABLE "appointments" DROP COLUMN "type"`);
    await queryRunner.query(`DROP TYPE "public"."appointment_type"`);
  }
}
