import { MigrationInterface, QueryRunner } from 'typeorm';

const APPOINTMENT_EXCLUSIONS = (statuses: string) => [
  `ALTER TABLE "appointments" ADD CONSTRAINT "excl_appointments_patient_overlap" EXCLUDE USING gist ("patient_id" WITH =, tstzrange("start_at", "end_at", '[)') WITH &&) WHERE ("status" IN (${statuses}))`,
  `ALTER TABLE "appointments" ADD CONSTRAINT "excl_appointments_doctor_overlap" EXCLUDE USING gist ("doctor_id" WITH =, tstzrange("start_at", "end_at", '[)') WITH &&) WHERE ("status" IN (${statuses}))`,
];

/**
 * Reception does all of attendance (attend / undo) and doctors only write
 * notes. Written by hand: Postgres cannot drop enum values, so each enum is
 * renamed, recreated and every column using it converted (the exclusion
 * constraints and partial indexes that compare statuses are rebuilt
 * around it).
 *
 * Appointments: CHECKED_IN and COMPLETED -> ATTENDED (history rows too).
 * Visits: WAITING / IN_SESSION / COMPLETED -> ACTIVE, CANCELLED -> VOIDED;
 * started_at, completed_at and completed_by are dropped, the check-in and
 * cancel columns renamed to attended_* / voided_* / void_reason.
 *
 * down() is lossy: ATTENDED appointments and ACTIVE visits come back as
 * COMPLETED (started and completed at the attended time).
 */
export class DeskWorkflow1793330000000 implements MigrationInterface {
  name = 'DeskWorkflow1793330000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---------- appointments ----------
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT "excl_appointments_patient_overlap"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT "excl_appointments_doctor_overlap"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."appointment_status" RENAME TO "appointment_status_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."appointment_status" AS ENUM('PENDING', 'CONFIRMED', 'ATTENDED', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED')`,
    );
    const toAttended = (column: string) =>
      `(CASE WHEN "${column}"::text IN ('CHECKED_IN', 'COMPLETED') THEN 'ATTENDED' ELSE "${column}"::text END)::"public"."appointment_status"`;
    await queryRunner.query(
      `ALTER TABLE "appointments" ALTER COLUMN "status" TYPE "public"."appointment_status" USING ${toAttended('status')}`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment_status_history" ALTER COLUMN "from_status" TYPE "public"."appointment_status" USING ${toAttended('from_status')}`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment_status_history" ALTER COLUMN "to_status" TYPE "public"."appointment_status" USING ${toAttended('to_status')}`,
    );
    await queryRunner.query(`DROP TYPE "public"."appointment_status_old"`);
    for (const sql of APPOINTMENT_EXCLUSIONS(
      `'PENDING', 'CONFIRMED', 'ATTENDED'`,
    )) {
      await queryRunner.query(sql);
    }

    // ---------- visits ----------
    await queryRunner.query(
      `DROP INDEX "public"."uq_visits_doctor_in_session"`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_visits_patient_open"`);
    await queryRunner.query(`DROP INDEX "public"."uq_visits_appointment_live"`);
    await queryRunner.query(
      `ALTER TABLE "visits" DROP CONSTRAINT "chk_visits_in_session_started"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" DROP CONSTRAINT "chk_visits_completed_times"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" DROP CONSTRAINT "chk_visits_cancelled_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" DROP CONSTRAINT "fk_visits_completed_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" DROP COLUMN "started_at", DROP COLUMN "completed_at", DROP COLUMN "completed_by"`,
    );
    for (const [from, to] of [
      ['checked_in_at', 'attended_at'],
      ['checked_in_by', 'attended_by'],
      ['cancelled_at', 'voided_at'],
      ['cancelled_by', 'voided_by'],
      ['cancel_reason', 'void_reason'],
    ]) {
      await queryRunner.query(
        `ALTER TABLE "visits" RENAME COLUMN "${from}" TO "${to}"`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "visits" RENAME CONSTRAINT "fk_visits_checked_in_by" TO "fk_visits_attended_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" RENAME CONSTRAINT "fk_visits_cancelled_by" TO "fk_visits_voided_by"`,
    );
    await queryRunner.query(
      `ALTER INDEX "public"."idx_visits_doctor_checked_in" RENAME TO "idx_visits_doctor_attended"`,
    );
    await queryRunner.query(
      `ALTER INDEX "public"."idx_visits_patient_checked_in" RENAME TO "idx_visits_patient_attended"`,
    );

    await queryRunner.query(
      `ALTER TYPE "public"."visit_status" RENAME TO "visit_status_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."visit_status" AS ENUM('ACTIVE', 'VOIDED')`,
    );
    const toActive = (column: string) =>
      `(CASE WHEN "${column}" IS NULL THEN NULL WHEN "${column}"::text = 'CANCELLED' THEN 'VOIDED' ELSE 'ACTIVE' END)::"public"."visit_status"`;
    await queryRunner.query(
      `ALTER TABLE "visits" ALTER COLUMN "status" TYPE "public"."visit_status" USING ${toActive('status')}`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_status_history" ALTER COLUMN "from_status" TYPE "public"."visit_status" USING ${toActive('from_status')}`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_status_history" ALTER COLUMN "to_status" TYPE "public"."visit_status" USING ${toActive('to_status')}`,
    );
    await queryRunner.query(`DROP TYPE "public"."visit_status_old"`);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_visits_appointment_active" ON "visits"  ("appointment_id") WHERE "status" = 'ACTIVE'`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ADD CONSTRAINT "chk_visits_voided" CHECK ("status" <> 'VOIDED' OR ("voided_at" IS NOT NULL AND "void_reason" IS NOT NULL))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ---------- visits ----------
    await queryRunner.query(
      `ALTER TABLE "visits" DROP CONSTRAINT "chk_visits_voided"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_visits_appointment_active"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."visit_status" RENAME TO "visit_status_new"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."visit_status" AS ENUM('WAITING', 'IN_SESSION', 'COMPLETED', 'CANCELLED')`,
    );
    const toOldVisit = (column: string) =>
      `(CASE WHEN "${column}" IS NULL THEN NULL WHEN "${column}"::text = 'VOIDED' THEN 'CANCELLED' ELSE 'COMPLETED' END)::"public"."visit_status"`;
    await queryRunner.query(
      `ALTER TABLE "visits" ALTER COLUMN "status" TYPE "public"."visit_status" USING ${toOldVisit('status')}`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_status_history" ALTER COLUMN "from_status" TYPE "public"."visit_status" USING ${toOldVisit('from_status')}`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_status_history" ALTER COLUMN "to_status" TYPE "public"."visit_status" USING ${toOldVisit('to_status')}`,
    );
    await queryRunner.query(`DROP TYPE "public"."visit_status_new"`);

    await queryRunner.query(
      `ALTER INDEX "public"."idx_visits_patient_attended" RENAME TO "idx_visits_patient_checked_in"`,
    );
    await queryRunner.query(
      `ALTER INDEX "public"."idx_visits_doctor_attended" RENAME TO "idx_visits_doctor_checked_in"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" RENAME CONSTRAINT "fk_visits_voided_by" TO "fk_visits_cancelled_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" RENAME CONSTRAINT "fk_visits_attended_by" TO "fk_visits_checked_in_by"`,
    );
    for (const [from, to] of [
      ['void_reason', 'cancel_reason'],
      ['voided_by', 'cancelled_by'],
      ['voided_at', 'cancelled_at'],
      ['attended_by', 'checked_in_by'],
      ['attended_at', 'checked_in_at'],
    ]) {
      await queryRunner.query(
        `ALTER TABLE "visits" RENAME COLUMN "${from}" TO "${to}"`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "visits" ADD "started_at" TIMESTAMP WITH TIME ZONE, ADD "completed_at" TIMESTAMP WITH TIME ZONE, ADD "completed_by" uuid`,
    );
    await queryRunner.query(
      `UPDATE "visits" SET "started_at" = "checked_in_at", "completed_at" = "checked_in_at", "completed_by" = "checked_in_by" WHERE "status" = 'COMPLETED'`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ADD CONSTRAINT "fk_visits_completed_by" FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ADD CONSTRAINT "chk_visits_cancelled_reason" CHECK ("status" <> 'CANCELLED' OR ("cancelled_at" IS NOT NULL AND "cancel_reason" IS NOT NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ADD CONSTRAINT "chk_visits_completed_times" CHECK ("status" <> 'COMPLETED' OR ("started_at" IS NOT NULL AND "completed_at" IS NOT NULL AND "completed_at" >= "started_at"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ADD CONSTRAINT "chk_visits_in_session_started" CHECK ("status" <> 'IN_SESSION' OR "started_at" IS NOT NULL)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_visits_appointment_live" ON "visits"  ("appointment_id") WHERE "status" <> 'CANCELLED'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_visits_patient_open" ON "visits"  ("patient_id") WHERE "status" IN ('WAITING', 'IN_SESSION')`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_visits_doctor_in_session" ON "visits"  ("doctor_id") WHERE "status" = 'IN_SESSION'`,
    );

    // ---------- appointments ----------
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT "excl_appointments_patient_overlap"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT "excl_appointments_doctor_overlap"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."appointment_status" RENAME TO "appointment_status_new"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."appointment_status" AS ENUM('PENDING', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED')`,
    );
    const toCompleted = (column: string) =>
      `(CASE WHEN "${column}"::text = 'ATTENDED' THEN 'COMPLETED' ELSE "${column}"::text END)::"public"."appointment_status"`;
    await queryRunner.query(
      `ALTER TABLE "appointments" ALTER COLUMN "status" TYPE "public"."appointment_status" USING ${toCompleted('status')}`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment_status_history" ALTER COLUMN "from_status" TYPE "public"."appointment_status" USING ${toCompleted('from_status')}`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment_status_history" ALTER COLUMN "to_status" TYPE "public"."appointment_status" USING ${toCompleted('to_status')}`,
    );
    await queryRunner.query(`DROP TYPE "public"."appointment_status_new"`);
    for (const sql of APPOINTMENT_EXCLUSIONS(
      `'PENDING', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED'`,
    )) {
      await queryRunner.query(sql);
    }
  }
}
