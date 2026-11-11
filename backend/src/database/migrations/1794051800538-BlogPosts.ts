import { MigrationInterface, QueryRunner } from 'typeorm';

export class BlogPosts1794051800538 implements MigrationInterface {
  name = 'BlogPosts1794051800538';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."blog_category" AS ENUM('NEUROLOGICAL', 'ORTHOPEDIC_SPINE', 'SPORTS_INJURIES', 'NUTRITION_BODY_SHAPING', 'CHEST', 'OBSTETRICS_GYNECOLOGY', 'CARDIAC', 'INTERNAL_GERIATRIC', 'OTHER')`,
    );
    await queryRunner.query(
      `CREATE TABLE "blog_posts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "title" character varying(200) NOT NULL, "description" character varying(500) NOT NULL, "keywords" text array NOT NULL, "category" "public"."blog_category" NOT NULL, "content" text NOT NULL, "cover_image_key" character varying(255) NOT NULL, "cover_image_mime_type" character varying(100) NOT NULL, "author_id" uuid NOT NULL, "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_blog_posts_keywords_count" CHECK (cardinality("keywords") BETWEEN 5 AND 20), CONSTRAINT "PK_dd2add25eac93daefc93da9d387" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "blog_posts" ADD CONSTRAINT "fk_blog_posts_author" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "blog_posts" DROP CONSTRAINT "fk_blog_posts_author"`,
    );
    await queryRunner.query(`DROP TABLE "blog_posts"`);
    await queryRunner.query(`DROP TYPE "public"."blog_category"`);
  }
}
