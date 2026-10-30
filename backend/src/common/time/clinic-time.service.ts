import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import {
  localDateOf,
  localDayBounds,
  localToUtc,
  toZonedIso,
  type AmbiguityPolicy,
} from './clinic-time.util.js';

// Source of "now". Overridden in tests to freeze time.
export const CLOCK = Symbol('CLOCK');
export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };

// Clinic-zone aware date/time operations, bound to CLINIC_TIMEZONE.
@Injectable()
export class ClinicTimeService {
  readonly zone: string;

  constructor(
    config: ConfigService<EnvironmentVariables, true>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.zone = config.get('CLINIC_TIMEZONE', { infer: true });
  }

  now(): Date {
    return this.clock.now();
  }

  today(): string {
    return localDateOf(this.now(), this.zone);
  }

  toIso(instant: Date): string {
    return toZonedIso(instant, this.zone);
  }

  localDate(instant: Date): string {
    return localDateOf(instant, this.zone);
  }

  localToUtc(date: string, time: string, ambiguity?: AmbiguityPolicy): Date {
    return localToUtc(date, time, this.zone, ambiguity);
  }

  dayBounds(date: string): { start: Date; end: Date } {
    return localDayBounds(date, this.zone);
  }

  /**
   * List filters `from=YYYY-MM-DD&to=YYYY-MM-DD` (inclusive, clinic local
   * dates) as instants: `start` = start of `from`, `end` = start of the day
   * after `to` (exclusive). Either may be missing.
   */
  dateRange(from?: string, to?: string): { start?: Date; end?: Date } {
    return {
      start: from ? this.dayBounds(from).start : undefined,
      end: to ? this.dayBounds(to).end : undefined,
    };
  }
}
