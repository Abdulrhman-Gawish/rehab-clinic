import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { DoctorsModule } from '../doctors/doctors.module.js';
import { PackagesModule } from '../packages/packages.module.js';
import { PatientsModule } from '../patients/patients.module.js';
import { VisitStatusHistory } from './entities/visit-status-history.entity.js';
import { Visit } from './entities/visit.entity.js';
import {
  AttendController,
  PatientVisitsController,
  VisitsController,
} from './visits.controller.js';
import { VisitsService } from './visits.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Visit, VisitStatusHistory]),
    AppointmentsModule,
    BillingModule,
    PatientsModule,
    DoctorsModule,
    PackagesModule,
  ],
  controllers: [VisitsController, AttendController, PatientVisitsController],
  providers: [VisitsService],
  exports: [VisitsService],
})
export class VisitsModule {}
