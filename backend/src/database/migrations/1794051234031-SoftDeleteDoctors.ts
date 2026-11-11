import { MigrationInterface, QueryRunner } from 'typeorm';

export class SoftDeleteDoctors1794051234031 implements MigrationInterface {
  name = 'SoftDeleteDoctors1794051234031';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "doctors" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctors" ADD CONSTRAINT "chk_doctors_deleted_inactive" CHECK ("deleted_at" IS NULL OR "is_active" = false)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "doctors" DROP CONSTRAINT "chk_doctors_deleted_inactive"`,
    );
    await queryRunner.query(`ALTER TABLE "doctors" DROP COLUMN "deleted_at"`);
  }
}
