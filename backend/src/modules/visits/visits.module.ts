import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { DoctorsModule } from '../doctors/doctors.module.js';
import { PatientsModule } from '../patients/patients.module.js';
import { VisitStatusHistory } from './entities/visit-status-history.entity.js';
import { Visit } from './entities/visit.entity.js';
import {
  AllowAllVisitCompletionPolicy,
  VISIT_COMPLETION_POLICY,
} from './visit-completion-policy.js';
import {
  CheckInController,
  PatientVisitsController,
  VisitsController,
} from './visits.controller.js';
import { VisitsService } from './visits.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Visit, VisitStatusHistory]),
    AppointmentsModule,
    PatientsModule,
    DoctorsModule,
  ],
  controllers: [VisitsController, CheckInController, PatientVisitsController],
  providers: [
    VisitsService,
    // Stage 7 swaps this for "a signed clinical note is required".
    {
      provide: VISIT_COMPLETION_POLICY,
      useClass: AllowAllVisitCompletionPolicy,
    },
  ],
  exports: [VisitsService],
})
export class VisitsModule {}
