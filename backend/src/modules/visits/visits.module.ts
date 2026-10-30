import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { DoctorsModule } from '../doctors/doctors.module.js';
import { PatientsModule } from '../patients/patients.module.js';
import { VisitStatusHistory } from './entities/visit-status-history.entity.js';
import { Visit } from './entities/visit.entity.js';
import { SignedNoteCompletionPolicy } from '../clinical/signed-note-completion.policy.js';
import { VISIT_COMPLETION_POLICY } from './visit-completion-policy.js';
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
    // A visit is completed only once its clinical note is SIGNED.
    {
      provide: VISIT_COMPLETION_POLICY,
      useClass: SignedNoteCompletionPolicy,
    },
  ],
  exports: [VisitsService],
})
export class VisitsModule {}
