import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import {
  validateEnv,
  type EnvironmentVariables,
} from './config/env.validation.js';
import { buildLoggerParams } from './config/logger.config.js';
import { DEFAULT_THROTTLE } from './common/decorators/throttle.decorators.js';
import { TimeModule } from './common/time/time.module.js';
import { DatabaseModule } from './database/database.module.js';
import { AppointmentsModule } from './modules/appointments/appointments.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { BillingModule } from './modules/billing/billing.module.js';
import { ClinicalModule } from './modules/clinical/clinical.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ClinicServicesModule } from './modules/clinic-services/clinic-services.module.js';
import { DoctorsModule } from './modules/doctors/doctors.module.js';
import { ExpensesModule } from './modules/expenses/expenses.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { PatientsModule } from './modules/patients/patients.module.js';
import { SchedulesModule } from './modules/schedules/schedules.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { VisitsModule } from './modules/visits/visits.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        buildLoggerParams({
          NODE_ENV: config.get('NODE_ENV', { infer: true }),
          LOG_LEVEL: config.get('LOG_LEVEL', { infer: true }),
        }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        throttlers: [{ name: 'default', ...DEFAULT_THROTTLE }],
        skipIf: () => !config.get('THROTTLE_ENABLED', { infer: true }),
      }),
    }),
    // Domain events (e.g. visit.completed), emitted after commit.
    EventEmitterModule.forRoot(),
    DatabaseModule,
    TimeModule,
    HealthModule,
    AuditModule,
    AuthModule,
    UsersModule,
    PatientsModule,
    ClinicServicesModule,
    DoctorsModule,
    SchedulesModule,
    AppointmentsModule,
    VisitsModule,
    BillingModule,
    ExpensesModule,
    ClinicalModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
