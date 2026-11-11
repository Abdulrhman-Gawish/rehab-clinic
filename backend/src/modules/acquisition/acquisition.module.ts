import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AcquisitionReportsService } from './acquisition-reports.service.js';
import { AcquisitionSourcesService } from './acquisition-sources.service.js';
import {
  AcquisitionController,
  AcquisitionReportsController,
} from './acquisition.controller.js';
import { PatientAcquisitionSource } from './entities/patient-acquisition-source.entity.js';

// How patients find the clinic: sources recorded at the desk, and the
// campaign tags (utm_*) online bookings carry (stored on appointments).
@Module({
  imports: [TypeOrmModule.forFeature([PatientAcquisitionSource])],
  controllers: [AcquisitionController, AcquisitionReportsController],
  providers: [AcquisitionSourcesService, AcquisitionReportsService],
  exports: [AcquisitionSourcesService],
})
export class AcquisitionModule {}
