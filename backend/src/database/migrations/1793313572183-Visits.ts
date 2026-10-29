import { MigrationInterface, QueryRunner } from 'typeorm';

export class Visits1793313572183 implements MigrationInterface {
  name = 'Visits1793313572183';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Hand edited: visit_status is shared by two tables and TypeORM emitted
    // it twice; it also rebuilt idx_appointment_status_history_appointment
    // around the changed_at default change, which is unnecessary.
    await queryRunner.query(
      `CREATE TYPE "public"."visit_status" AS ENUM('WAITING', 'IN_SESSION', 'COMPLETED', 'CANCELLED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "visits" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "appointment_id" uuid, "patient_id" uuid NOT NULL, "doctor_id" uuid NOT NULL, "service_id" uuid NOT NULL, "status" "public"."visit_status" NOT NULL, "checked_in_at" TIMESTAMP WITH TIME ZONE NOT NULL, "checked_in_by" uuid NOT NULL, "started_at" TIMESTAMP WITH TIME ZONE, "completed_at" TIMESTAMP WITH TIME ZONE, "completed_by" uuid, "cancelled_at" TIMESTAMP WITH TIME ZONE, "cancelled_by" uuid, "cancel_reason" character varying(255), CONSTRAINT "chk_visits_cancelled_reason" CHECK ("status" <> 'CANCELLED' OR ("cancelled_at" IS NOT NULL AND "cancel_reason" IS NOT NULL)), CONSTRAINT "chk_visits_completed_times" CHECK ("status" <> 'COMPLETED' OR ("started_at" IS NOT NULL AND "completed_at" IS NOT NULL AND "completed_at" >= "started_at")), CONSTRAINT "chk_visits_in_session_started" CHECK ("status" <> 'IN_SESSION' OR "started_at" IS NOT NULL), CONSTRAINT "PK_0b0b322289a41015c6ea4e8bf30" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_visits_doctor_in_session" ON "visits"  ("doctor_id") WHERE "status" = 'IN_SESSION'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_visits_patient_open" ON "visits"  ("patient_id") WHERE "status" IN ('WAITING', 'IN_SESSION')`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_visits_appointment_live" ON "visits"  ("appointment_id") WHERE "status" <> 'CANCELLED'`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_visits_status" ON "visits"  ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_visits_patient_checked_in" ON "visits"  ("patient_id", "checked_in_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_visits_doctor_checked_in" ON "visits"  ("doctor_id", "checked_in_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "visit_status_history" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "visit_id" uuid NOT NULL, "from_status" "public"."visit_status", "to_status" "public"."visit_status" NOT NULL, "changed_by" uuid NOT NULL, "reason" character varying(255), "changed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), CONSTRAINT "PK_f97d4da916ea4a8113c14667d44" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_visit_status_history_visit" ON "visit_status_history"  ("visit_id", "changed_at") `,
    );
    // History rows written in one transaction must keep their order.
    await queryRunner.query(
      `ALTER TABLE "appointment_status_history" ALTER COLUMN "changed_at" SET DEFAULT clock_timestamp()`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ADD CONSTRAINT "fk_visits_appointment" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ADD CONSTRAINT "fk_visits_patient" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ADD CONSTRAINT "fk_visits_doctor" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ADD CONSTRAINT "fk_visits_service" FOREIGN KEY ("service_id") REFERENCES "clinic_services"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ADD CONSTRAINT "fk_visits_checked_in_by" FOREIGN KEY ("checked_in_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ADD CONSTRAINT "fk_visits_completed_by" FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ADD CONSTRAINT "fk_visits_cancelled_by" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_status_history" ADD CONSTRAINT "fk_visit_status_history_visit" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_status_history" ADD CONSTRAINT "fk_visit_status_history_changed_by" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "visit_status_history" DROP CONSTRAINT "fk_visit_status_history_changed_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_status_history" DROP CONSTRAINT "fk_visit_status_history_visit"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" DROP CONSTRAINT "fk_visits_cancelled_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" DROP CONSTRAINT "fk_visits_completed_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" DROP CONSTRAINT "fk_visits_checked_in_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" DROP CONSTRAINT "fk_visits_service"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" DROP CONSTRAINT "fk_visits_doctor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" DROP CONSTRAINT "fk_visits_patient"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" DROP CONSTRAINT "fk_visits_appointment"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment_status_history" ALTER COLUMN "changed_at" SET DEFAULT now()`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_visit_status_history_visit"`,
    );
    await queryRunner.query(`DROP TABLE "visit_status_history"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_visits_doctor_checked_in"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_visits_patient_checked_in"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_visits_status"`);
    await queryRunner.query(`DROP INDEX "public"."uq_visits_appointment_live"`);
    await queryRunner.query(`DROP INDEX "public"."uq_visits_patient_open"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_visits_doctor_in_session"`,
    );
    await queryRunner.query(`DROP TABLE "visits"`);
    await queryRunner.query(`DROP TYPE "public"."visit_status"`);
  }
}
