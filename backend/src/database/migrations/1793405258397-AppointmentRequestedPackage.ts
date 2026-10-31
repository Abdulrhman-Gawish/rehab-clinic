import { MigrationInterface, QueryRunner } from 'typeorm';

export class AppointmentRequestedPackage1793405258397 implements MigrationInterface {
  name = 'AppointmentRequestedPackage1793405258397';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD "requested_package_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD CONSTRAINT "fk_appointments_requested_package" FOREIGN KEY ("requested_package_id") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT "fk_appointments_requested_package"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP COLUMN "requested_package_id"`,
    );
  }
}
