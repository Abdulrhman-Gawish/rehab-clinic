import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DoctorsModule } from '../doctors/doctors.module.js';
import { PackagesModule } from '../packages/packages.module.js';
import { PatientsModule } from '../patients/patients.module.js';
import { Visit } from '../visits/entities/visit.entity.js';
import { AppointmentWriter } from './appointment-writer.service.js';
import {
  AppointmentsController,
  PatientAppointmentsController,
} from './appointments.controller.js';
import { AppointmentsService } from './appointments.service.js';
import { AvailabilityService } from './availability/availability.service.js';
import { AppointmentStatusHistory } from './entities/appointment-status-history.entity.js';
import { Appointment } from './entities/appointment.entity.js';
import {
  PublicBookingController,
  PublicSlotsController,
} from './public-appointments.controller.js';
import { PublicBookingService } from './public-booking.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Appointment, AppointmentStatusHistory, Visit]),
    DoctorsModule,
    PatientsModule,
    PackagesModule,
  ],
  controllers: [
    AppointmentsController,
    PatientAppointmentsController,
    PublicSlotsController,
    PublicBookingController,
  ],
  providers: [
    AvailabilityService,
    AppointmentWriter,
    AppointmentsService,
    PublicBookingService,
  ],
  exports: [AvailabilityService, AppointmentsService, AppointmentWriter],
})
export class AppointmentsModule {}
