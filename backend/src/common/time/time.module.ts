import { Global, Module } from '@nestjs/common';
import {
  CLOCK,
  ClinicTimeService,
  systemClock,
} from './clinic-time.service.js';

@Global()
@Module({
  providers: [{ provide: CLOCK, useValue: systemClock }, ClinicTimeService],
  exports: [CLOCK, ClinicTimeService],
})
export class TimeModule {}
