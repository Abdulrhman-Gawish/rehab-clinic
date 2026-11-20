import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PatientCodeCounter } from './entities/patient-code-counter.entity.js';
import { Patient } from './entities/patient.entity.js';
import { PatientsController } from './patients.controller.js';
import { PatientsService } from './patients.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Patient, PatientCodeCounter])],
  controllers: [PatientsController],
  providers: [PatientsService],
  // findOrCreateByPhone: bookings and walk-ins; check-in details: visits.
  exports: [PatientsService],
})
export class PatientsModule {}
