import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DoctorsModule } from '../doctors/doctors.module.js';
import { PatientsModule } from '../patients/patients.module.js';
import { AppointmentWriter } from './appointment-writer.service.js';
import {
  AppointmentsController,
  PatientAppointmentsController,
} from './appointments.controller.js';
import { AppointmentsService } from './appointments.service.js';
import { AvailabilityService } from './availability/availability.service.js';
import { BOOKING_VERIFIER, NoopBookingVerifier } from './booking-verifier.js';
import { AppointmentStatusHistory } from './entities/appointment-status-history.entity.js';
import { Appointment } from './entities/appointment.entity.js';
import {
  PublicBookingController,
  PublicSlotsController,
} from './public-appointments.controller.js';
import { PublicBookingService } from './public-booking.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Appointment, AppointmentStatusHistory]),
    DoctorsModule,
    PatientsModule,
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
    // Swap for a CAPTCHA-backed implementation later.
    { provide: BOOKING_VERIFIER, useClass: NoopBookingVerifier },
  ],
  exports: [AvailabilityService, AppointmentsService],
})
export class AppointmentsModule {}
