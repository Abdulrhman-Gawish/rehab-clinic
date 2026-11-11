import { MigrationInterface, QueryRunner } from 'typeorm';

export class ArabicSearchAndLanguage1793459750707 implements MigrationInterface {
  name = 'ArabicSearchAndLanguage1793459750707';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Per-user UI language; every existing user gets the default, Arabic.
    await queryRunner.query(
      `CREATE TYPE "public"."user_language" AS ENUM('ar', 'en')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "preferred_language" "public"."user_language" NOT NULL DEFAULT 'ar'`,
    );

    // GET /payments?patientId=
    await queryRunner.query(
      `CREATE INDEX "idx_payments_patient_received" ON "payments" ("patient_id", "received_at")`,
    );

    // Patient name search that ignores common Arabic spelling variants:
    // diacritics (U+0610-061A, U+064B-065F, U+0670) and tatweel (U+0640)
    // removed, alef forms -> ا, ى -> ي, ة -> ه, then lowercased. Written by
    // hand (the entity declares the index with synchronize: false).
    await queryRunner.query(
      `CREATE FUNCTION "patient_name_search_key"(name text) RETURNS text
         LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
         AS $$ SELECT lower(translate(
           regexp_replace(name, '[\\u0610-\\u061A\\u064B-\\u065F\\u0670\\u0640]', '', 'g'),
           'أإآٱىة', 'اااايه')) $$`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_patients_name_trgm"`);
    await queryRunner.query(
      `CREATE INDEX "idx_patients_name_search_trgm" ON "patients" USING gin (patient_name_search_key("name") gin_trgm_ops)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_patients_name_search_trgm"`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_patients_name_trgm" ON "patients" USING gin ("name" gin_trgm_ops)`,
    );
    await queryRunner.query(`DROP FUNCTION "patient_name_search_key"(text)`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_payments_patient_received"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "preferred_language"`,
    );
    await queryRunner.query(`DROP TYPE "public"."user_language"`);
  }
}
