import { MigrationInterface, QueryRunner } from 'typeorm';

export class DoctorSchedulesTimeOff1793311636391 implements MigrationInterface {
  name = 'DoctorSchedulesTimeOff1793311636391';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Hand written: btree_gist lets GiST exclusion constraints use '=' on
    // uuid/smallint columns (non-overlapping schedule ranges, and later
    // appointments). Trusted extension, so the DB owner can create it.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);
    await queryRunner.query(
      `CREATE TABLE "doctor_schedules" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "doctor_id" uuid NOT NULL, "day_of_week" smallint NOT NULL, "start_time" TIME NOT NULL, "end_time" TIME NOT NULL, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "chk_doctor_schedules_time_order" CHECK (end_time > start_time), CONSTRAINT "chk_doctor_schedules_day_of_week" CHECK (day_of_week BETWEEN 0 AND 6), CONSTRAINT "excl_doctor_schedules_no_overlap" EXCLUDE USING gist ("doctor_id" WITH =, "day_of_week" WITH =, tsrange(('2000-01-01'::date + "start_time"), ('2000-01-01'::date + "end_time"), '[)') WITH &&) WHERE ("is_active"), CONSTRAINT "PK_a1cab57bc0a680b50d06930b377" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_doctor_schedules_doctor_day" ON "doctor_schedules"  ("doctor_id", "day_of_week") `,
    );
    await queryRunner.query(
      `CREATE TABLE "doctor_time_off" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "doctor_id" uuid NOT NULL, "start_at" TIMESTAMP WITH TIME ZONE NOT NULL, "end_at" TIMESTAMP WITH TIME ZONE NOT NULL, "reason" character varying(255), "created_by" uuid NOT NULL, CONSTRAINT "chk_doctor_time_off_period" CHECK (end_at > start_at), CONSTRAINT "PK_356c976febc26ec6df650a0e594" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_doctor_time_off_doctor_start" ON "doctor_time_off"  ("doctor_id", "start_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_schedules" ADD CONSTRAINT "fk_doctor_schedules_doctor" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_time_off" ADD CONSTRAINT "fk_doctor_time_off_doctor" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_time_off" ADD CONSTRAINT "fk_doctor_time_off_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "doctor_time_off" DROP CONSTRAINT "fk_doctor_time_off_created_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_time_off" DROP CONSTRAINT "fk_doctor_time_off_doctor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_schedules" DROP CONSTRAINT "fk_doctor_schedules_doctor"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_doctor_time_off_doctor_start"`,
    );
    await queryRunner.query(`DROP TABLE "doctor_time_off"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_doctor_schedules_doctor_day"`,
    );
    await queryRunner.query(`DROP TABLE "doctor_schedules"`);
    await queryRunner.query(`DROP EXTENSION IF EXISTS btree_gist`);
  }
}
