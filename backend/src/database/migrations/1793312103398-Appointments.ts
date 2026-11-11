import { MigrationInterface, QueryRunner } from 'typeorm';

export class Appointments1793312103398 implements MigrationInterface {
  name = 'Appointments1793312103398';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Hand written: btree_gist is created by DoctorSchedulesTimeOff; kept
    // here too so the exclusion constraints never depend on ordering.
    // The appointment_status enum is shared by two tables: TypeORM emitted
    // it twice, the duplicate CREATE/DROP was removed by hand.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);
    await queryRunner.query(
      `CREATE TYPE "public"."appointment_status" AS ENUM('PENDING', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."appointment_source" AS ENUM('ONLINE', 'RECEPTION')`,
    );
    await queryRunner.query(
      `CREATE TABLE "appointments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "reference_code" character varying(16) NOT NULL, "patient_id" uuid NOT NULL, "doctor_id" uuid NOT NULL, "service_id" uuid NOT NULL, "start_at" TIMESTAMP WITH TIME ZONE NOT NULL, "end_at" TIMESTAMP WITH TIME ZONE NOT NULL, "status" "public"."appointment_status" NOT NULL, "source" "public"."appointment_source" NOT NULL, "booked_name" character varying(120) NOT NULL, "booked_by" uuid, "rescheduled_from_id" uuid, "cancel_reason" character varying(255), "notes" text, CONSTRAINT "uq_appointments_reference_code" UNIQUE ("reference_code"), CONSTRAINT "chk_appointments_period" CHECK (end_at > start_at), CONSTRAINT "excl_appointments_patient_overlap" EXCLUDE USING gist ("patient_id" WITH =, tstzrange("start_at", "end_at", '[)') WITH &&) WHERE ("status" IN ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED')), CONSTRAINT "excl_appointments_doctor_overlap" EXCLUDE USING gist ("doctor_id" WITH =, tstzrange("start_at", "end_at", '[)') WITH &&) WHERE ("status" IN ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED')), CONSTRAINT "PK_4a437a9a27e948726b8bb3e36ad" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_appointments_status_start" ON "appointments"  ("status", "start_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_appointments_patient_start" ON "appointments"  ("patient_id", "start_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_appointments_doctor_start" ON "appointments"  ("doctor_id", "start_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "appointment_status_history" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "appointment_id" uuid NOT NULL, "from_status" "public"."appointment_status", "to_status" "public"."appointment_status" NOT NULL, "changed_by" uuid, "reason" character varying(255), "changed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_86ba2571cc6758bc7443adb7a8e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_appointment_status_history_appointment" ON "appointment_status_history"  ("appointment_id", "changed_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD CONSTRAINT "fk_appointments_patient" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD CONSTRAINT "fk_appointments_doctor" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD CONSTRAINT "fk_appointments_service" FOREIGN KEY ("service_id") REFERENCES "clinic_services"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD CONSTRAINT "fk_appointments_booked_by" FOREIGN KEY ("booked_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD CONSTRAINT "fk_appointments_rescheduled_from" FOREIGN KEY ("rescheduled_from_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment_status_history" ADD CONSTRAINT "fk_appointment_status_history_appointment" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment_status_history" ADD CONSTRAINT "fk_appointment_status_history_changed_by" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "appointment_status_history" DROP CONSTRAINT "fk_appointment_status_history_changed_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment_status_history" DROP CONSTRAINT "fk_appointment_status_history_appointment"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT "fk_appointments_rescheduled_from"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT "fk_appointments_booked_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT "fk_appointments_service"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT "fk_appointments_doctor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT "fk_appointments_patient"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_appointment_status_history_appointment"`,
    );
    await queryRunner.query(`DROP TABLE "appointment_status_history"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_appointments_doctor_start"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_appointments_patient_start"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_appointments_status_start"`,
    );
    await queryRunner.query(`DROP TABLE "appointments"`);
    await queryRunner.query(`DROP TYPE "public"."appointment_source"`);
    await queryRunner.query(`DROP TYPE "public"."appointment_status"`);
  }
}
