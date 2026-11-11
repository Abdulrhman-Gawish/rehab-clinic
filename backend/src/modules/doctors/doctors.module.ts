import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { ClinicService } from '../clinic-services/entities/clinic-service.entity.js';
import { UsersModule } from '../users/users.module.js';
import {
  DoctorsController,
  PublicDoctorsController,
} from './doctors.controller.js';
import { DoctorAccessService } from './doctor-access.service.js';
import { DoctorsService } from './doctors.service.js';
import { DoctorClinicService } from './entities/doctor-clinic-service.entity.js';
import { Doctor } from './entities/doctor.entity.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Doctor, DoctorClinicService, ClinicService]),
    UsersModule,
    AuthModule,
  ],
  controllers: [DoctorsController, PublicDoctorsController],
  providers: [DoctorsService, DoctorAccessService],
  exports: [DoctorsService, DoctorAccessService],
})
export class DoctorsModule {}
