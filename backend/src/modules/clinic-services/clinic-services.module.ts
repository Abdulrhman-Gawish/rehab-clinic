import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ClinicServicesController,
  PublicClinicServicesController,
} from './clinic-services.controller.js';
import { ClinicServicesService } from './clinic-services.service.js';
import { ClinicService } from './entities/clinic-service.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([ClinicService])],
  controllers: [ClinicServicesController, PublicClinicServicesController],
  providers: [ClinicServicesService],
  exports: [ClinicServicesService],
})
export class ClinicServicesModule {}
