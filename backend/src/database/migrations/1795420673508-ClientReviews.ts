import { MigrationInterface, QueryRunner } from 'typeorm';

// Client reviews (OWNER only) and their attachments. Generated from the
// entities; nothing hand-written.

export class ClientReviews1795420673508 implements MigrationInterface {
  name = 'ClientReviews1795420673508';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."client_review_type" AS ENUM('TEXT', 'IMAGE', 'GALLERY')`,
    );
    await queryRunner.query(
      `CREATE TABLE "client_reviews" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "review_type" "public"."client_review_type" NOT NULL, "client_name" character varying(120) NOT NULL, "content" text NOT NULL, "keywords" text array NOT NULL DEFAULT '{}', "is_published" boolean NOT NULL DEFAULT false, "created_by_id" uuid NOT NULL, "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_client_reviews_keywords_count" CHECK (cardinality("keywords") <= 20), CONSTRAINT "PK_3abbbb3db496435c053e20e3a44" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "client_review_attachments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "review_id" uuid NOT NULL, "file_name" character varying(200) NOT NULL, "file_key" character varying(255) NOT NULL, "mime_type" character varying(100) NOT NULL, "size_bytes" integer NOT NULL, "uploaded_by" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_client_review_attachments_size_positive" CHECK ("size_bytes" > 0), CONSTRAINT "PK_54eda85675fcbe60d8f3c455570" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_client_review_attachments_review" ON "client_review_attachments"  ("review_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "client_reviews" ADD CONSTRAINT "fk_client_reviews_created_by" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_review_attachments" ADD CONSTRAINT "fk_client_review_attachments_review" FOREIGN KEY ("review_id") REFERENCES "client_reviews"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_review_attachments" ADD CONSTRAINT "fk_client_review_attachments_uploaded_by" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "client_review_attachments" DROP CONSTRAINT "fk_client_review_attachments_uploaded_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_review_attachments" DROP CONSTRAINT "fk_client_review_attachments_review"`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_reviews" DROP CONSTRAINT "fk_client_reviews_created_by"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_client_review_attachments_review"`,
    );
    await queryRunner.query(`DROP TABLE "client_review_attachments"`);
    await queryRunner.query(`DROP TABLE "client_reviews"`);
    await queryRunner.query(`DROP TYPE "public"."client_review_type"`);
  }
}
