import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Appointment } from '../appointments/entities/appointment.entity.js';
import { DoctorsModule } from '../doctors/doctors.module.js';
import { Doctor } from '../doctors/entities/doctor.entity.js';
import { DoctorSchedulesService } from './doctor-schedules.service.js';
import { DoctorTimeOffService } from './doctor-time-off.service.js';
import { DoctorSchedule } from './entities/doctor-schedule.entity.js';
import { DoctorTimeOff } from './entities/doctor-time-off.entity.js';
import { SchedulesController } from './schedules.controller.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DoctorSchedule,
      DoctorTimeOff,
      Doctor,
      Appointment,
    ]),
    DoctorsModule,
  ],
  controllers: [SchedulesController],
  providers: [DoctorSchedulesService, DoctorTimeOffService],
  exports: [DoctorSchedulesService, DoctorTimeOffService],
})
export class SchedulesModule {}
