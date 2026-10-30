import { MigrationInterface, QueryRunner } from 'typeorm';

export class SoftDeleteServicesPackages1793404094668 implements MigrationInterface {
  name = 'SoftDeleteServicesPackages1793404094668';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "clinic_services" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "packages" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "clinic_services" ADD CONSTRAINT "chk_clinic_services_deleted_inactive" CHECK ("deleted_at" IS NULL OR "is_active" = false)`,
    );
    await queryRunner.query(
      `ALTER TABLE "packages" ADD CONSTRAINT "chk_packages_deleted_inactive" CHECK ("deleted_at" IS NULL OR "is_active" = false)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "packages" DROP CONSTRAINT "chk_packages_deleted_inactive"`,
    );
    await queryRunner.query(
      `ALTER TABLE "clinic_services" DROP CONSTRAINT "chk_clinic_services_deleted_inactive"`,
    );
    await queryRunner.query(`ALTER TABLE "packages" DROP COLUMN "deleted_at"`);
    await queryRunner.query(
      `ALTER TABLE "clinic_services" DROP COLUMN "deleted_at"`,
    );
  }
}
