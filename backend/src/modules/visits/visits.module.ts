import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AcquisitionModule } from '../acquisition/acquisition.module.js';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { ClinicalModule } from '../clinical/clinical.module.js';
import { DoctorsModule } from '../doctors/doctors.module.js';
import { PackagesModule } from '../packages/packages.module.js';
import { PatientsModule } from '../patients/patients.module.js';
import { ReferralsModule } from '../referrals/referrals.module.js';
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
    ClinicalModule,
    PatientsModule,
    DoctorsModule,
    PackagesModule,
    // Check-in: the referral source or doctor referral collected at the desk.
    AcquisitionModule,
    ReferralsModule,
  ],
  controllers: [VisitsController, AttendController, PatientVisitsController],
  providers: [VisitsService],
  exports: [VisitsService],
})
export class VisitsModule {}
