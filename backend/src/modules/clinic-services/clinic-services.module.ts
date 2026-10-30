import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ClinicServicesController,
  PublicClinicServicesController,
} from './clinic-services.controller.js';
import { DoctorClinicService } from '../doctors/entities/doctor-clinic-service.entity.js';
import { Doctor } from '../doctors/entities/doctor.entity.js';
import { ClinicServicesService } from './clinic-services.service.js';
import { ClinicService } from './entities/clinic-service.entity.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([ClinicService, Doctor, DoctorClinicService]),
  ],
  controllers: [ClinicServicesController, PublicClinicServicesController],
  providers: [ClinicServicesService],
  exports: [ClinicServicesService],
})
export class ClinicServicesModule {}
