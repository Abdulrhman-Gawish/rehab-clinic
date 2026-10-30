import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClinicalRecords1793324015307 implements MigrationInterface {
  name = 'ClinicalRecords1793324015307';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."note_status" AS ENUM('DRAFT', 'SIGNED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "clinical_notes" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "visit_id" uuid NOT NULL, "patient_id" uuid NOT NULL, "doctor_id" uuid NOT NULL, "chief_complaint" text, "assessment" text, "treatment_done" text, "progress" text, "plan" text, "pain_score" smallint, "status" "public"."note_status" NOT NULL, "signed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "uq_clinical_notes_visit" UNIQUE ("visit_id"), CONSTRAINT "chk_clinical_notes_signed" CHECK ("status" <> 'SIGNED' OR "signed_at" IS NOT NULL), CONSTRAINT "chk_clinical_notes_pain_score" CHECK ("pain_score" IS NULL OR "pain_score" BETWEEN 0 AND 10), CONSTRAINT "PK_590ad4cecf429ecc12e8202cbb4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_clinical_notes_patient_status" ON "clinical_notes"  ("patient_id", "status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "clinical_note_addenda" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "note_id" uuid NOT NULL, "doctor_id" uuid NOT NULL, "content" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0436ccb794886f4574009f7a3b3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_clinical_note_addenda_note" ON "clinical_note_addenda"  ("note_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "patient_attachments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "patient_id" uuid NOT NULL, "visit_id" uuid, "title" character varying(200) NOT NULL, "file_key" character varying(255) NOT NULL, "mime_type" character varying(100) NOT NULL, "size_bytes" integer NOT NULL, "uploaded_by" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "chk_patient_attachments_size_positive" CHECK ("size_bytes" > 0), CONSTRAINT "PK_263bf523b887ac1642853c8a55a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_patient_attachments_patient_created" ON "patient_attachments"  ("patient_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "patient_medical_info" ("patient_id" uuid NOT NULL, "allergies" text, "chronic_conditions" text, "past_surgeries" text, "current_medications" text, "notes" text, "updated_by" uuid NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0273f72c7ee5042721c531ff40a" PRIMARY KEY ("patient_id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "clinical_notes" ADD CONSTRAINT "fk_clinical_notes_visit" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "clinical_notes" ADD CONSTRAINT "fk_clinical_notes_patient" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "clinical_notes" ADD CONSTRAINT "fk_clinical_notes_doctor" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "clinical_note_addenda" ADD CONSTRAINT "fk_clinical_note_addenda_note" FOREIGN KEY ("note_id") REFERENCES "clinical_notes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "clinical_note_addenda" ADD CONSTRAINT "fk_clinical_note_addenda_doctor" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_attachments" ADD CONSTRAINT "fk_patient_attachments_patient" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_attachments" ADD CONSTRAINT "fk_patient_attachments_visit" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_attachments" ADD CONSTRAINT "fk_patient_attachments_uploaded_by" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_medical_info" ADD CONSTRAINT "fk_patient_medical_info_patient" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_medical_info" ADD CONSTRAINT "fk_patient_medical_info_updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "patient_medical_info" DROP CONSTRAINT "fk_patient_medical_info_updated_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_medical_info" DROP CONSTRAINT "fk_patient_medical_info_patient"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_attachments" DROP CONSTRAINT "fk_patient_attachments_uploaded_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_attachments" DROP CONSTRAINT "fk_patient_attachments_visit"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_attachments" DROP CONSTRAINT "fk_patient_attachments_patient"`,
    );
    await queryRunner.query(
      `ALTER TABLE "clinical_note_addenda" DROP CONSTRAINT "fk_clinical_note_addenda_doctor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "clinical_note_addenda" DROP CONSTRAINT "fk_clinical_note_addenda_note"`,
    );
    await queryRunner.query(
      `ALTER TABLE "clinical_notes" DROP CONSTRAINT "fk_clinical_notes_doctor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "clinical_notes" DROP CONSTRAINT "fk_clinical_notes_patient"`,
    );
    await queryRunner.query(
      `ALTER TABLE "clinical_notes" DROP CONSTRAINT "fk_clinical_notes_visit"`,
    );
    await queryRunner.query(`DROP TABLE "patient_medical_info"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_patient_attachments_patient_created"`,
    );
    await queryRunner.query(`DROP TABLE "patient_attachments"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_clinical_note_addenda_note"`,
    );
    await queryRunner.query(`DROP TABLE "clinical_note_addenda"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_clinical_notes_patient_status"`,
    );
    await queryRunner.query(`DROP TABLE "clinical_notes"`);
    await queryRunner.query(`DROP TYPE "public"."note_status"`);
  }
}
