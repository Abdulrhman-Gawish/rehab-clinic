import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import {
  ErrorCode,
  unprocessable,
} from '../../../common/errors/app.exception.js';
import { ClinicTimeService } from '../../../common/time/clinic-time.service.js';
import { dayOfWeek } from '../../../common/time/clinic-time.util.js';
import type { EnvironmentVariables } from '../../../config/env.validation.js';
import type { ClinicService } from '../../clinic-services/entities/clinic-service.entity.js';
import { DoctorClinicService } from '../../doctors/entities/doctor-clinic-service.entity.js';
import { Doctor } from '../../doctors/entities/doctor.entity.js';
import { DoctorSchedule } from '../../schedules/entities/doctor-schedule.entity.js';
import { DoctorTimeOff } from '../../schedules/entities/doctor-time-off.entity.js';
import { ACTIVE_STATUSES } from '../appointment.enums.js';
import type { SlotDto } from '../dto/availability.dto.js';
import { Appointment } from '../entities/appointment.entity.js';
import {
  generateSlots,
  scheduleWindows,
  type Interval,
} from './slot-generator.js';

const MINUTE_MS = 60_000;

export interface BookingContext {
  doctor: Doctor;
  service: ClinicService;
}

export interface SlotQueryOptions {
  // Public website: the doctor must also be listed publicly.
  publicOnly?: boolean;
  // Reception: whole local day, ignoring schedule, time off and lead time.
  includeOutsideSchedule?: boolean;
}

/**
 * Computes bookable slots. This is only a hint for the UI: the appointments
 * exclusion constraints are the real guarantee against double booking.
 */
@Injectable()
export class AvailabilityService {
  private readonly intervalMinutes: number;
  private readonly leadMinutes: number;
  private readonly maxDaysAhead: number;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly time: ClinicTimeService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.intervalMinutes = config.get('SLOT_INTERVAL_MINUTES', { infer: true });
    this.leadMinutes = config.get('BOOKING_MIN_LEAD_MINUTES', { infer: true });
    this.maxDaysAhead = config.get('BOOKING_MAX_DAYS_AHEAD', { infer: true });
  }

  async getSlots(
    doctorId: string,
    serviceId: string,
    date: string,
    options: SlotQueryOptions = {},
  ): Promise<SlotDto[]> {
    const manager = this.dataSource.manager;
    const context = await this.loadContext(
      doctorId,
      serviceId,
      options,
      manager,
    );
    this.assertDateInRange(date);

    const day = this.time.dayBounds(date);
    const outside = options.includeOutsideSchedule ?? false;
    const windows = outside
      ? [day]
      : await this.windowsFor(doctorId, date, manager);
    const blocked = [
      ...(outside ? [] : await this.timeOff(doctorId, day, manager)),
      ...(await this.busyAppointments(doctorId, day, manager)),
    ];
    const slots = generateSlots(windows, {
      durationMinutes: context.service.durationMinutes,
      intervalMinutes: this.intervalMinutes,
      blocked,
      notBefore: outside ? this.time.now() : this.earliestStart(),
    });
    return slots.map((slot) => ({
      startAt: this.time.toIso(slot.start),
      endAt: this.time.toIso(slot.end),
    }));
  }

  /**
   * The doctor must be active (and public when booking online) and must offer
   * the service, which must itself be active.
   */
  async loadContext(
    doctorId: string,
    serviceId: string,
    options: Pick<SlotQueryOptions, 'publicOnly'>,
    manager: EntityManager,
  ): Promise<BookingContext> {
    const doctor = await manager
      .getRepository(Doctor)
      .createQueryBuilder('doctor')
      .innerJoinAndSelect('doctor.user', 'user')
      .where('doctor.id = :doctorId', { doctorId })
      .andWhere('doctor.isActive = true AND user.isActive = true')
      .andWhere(options.publicOnly ? 'doctor.isPublic = true' : 'TRUE')
      .getOne();
    if (!doctor) throw new NotFoundException('Doctor not found');

    const assignment = await manager
      .getRepository(DoctorClinicService)
      .createQueryBuilder('assignment')
      .innerJoinAndSelect('assignment.service', 'service')
      .where('assignment.doctorId = :doctorId', { doctorId })
      .andWhere('assignment.serviceId = :serviceId', { serviceId })
      .andWhere('service.isActive = true')
      .getOne();
    if (!assignment?.service) {
      throw unprocessable(
        ErrorCode.SERVICE_NOT_OFFERED,
        'The doctor does not offer this service',
      );
    }
    return { doctor, service: assignment.service };
  }

  // Local dates from today up to today + BOOKING_MAX_DAYS_AHEAD.
  assertDateInRange(date: string): void {
    const today = this.time.today();
    const last = this.time.addDays(today, this.maxDaysAhead);
    if (date < today || date > last) {
      throw unprocessable(
        ErrorCode.DATE_OUT_OF_RANGE,
        `Date must be between ${today} and ${last}`,
        { from: today, to: last },
      );
    }
  }

  earliestStart(): Date {
    return new Date(this.time.now().getTime() + this.leadMinutes * MINUTE_MS);
  }

  async windowsFor(
    doctorId: string,
    date: string,
    manager: EntityManager,
  ): Promise<Interval[]> {
    const ranges = await manager.getRepository(DoctorSchedule).find({
      where: { doctorId, dayOfWeek: dayOfWeek(date), isActive: true },
      order: { startTime: 'ASC' },
    });
    return scheduleWindows(date, ranges, this.time.zone);
  }

  async timeOff(
    doctorId: string,
    range: Interval,
    manager: EntityManager,
  ): Promise<Interval[]> {
    const rows = await manager
      .getRepository(DoctorTimeOff)
      .createQueryBuilder('off')
      .where('off.doctorId = :doctorId', { doctorId })
      .andWhere('off.startAt < :end AND off.endAt > :start', {
        start: range.start,
        end: range.end,
      })
      .getMany();
    return rows.map((row) => ({ start: row.startAt, end: row.endAt }));
  }

  /**
   * A requested start must be one of the doctor's slots for that local date
   * (schedule, time off, lead time and max days ahead), ignoring existing
   * bookings: those are decided by the exclusion constraints on insert,
   * which also covers races.
   */
  async assertBookable(
    context: BookingContext,
    startAt: Date,
    manager: EntityManager,
  ): Promise<void> {
    const date = this.time.localDate(startAt);
    this.assertDateInRange(date);

    const doctorId = context.doctor.id;
    const slots = generateSlots(
      await this.windowsFor(doctorId, date, manager),
      {
        durationMinutes: context.service.durationMinutes,
        intervalMinutes: this.intervalMinutes,
        blocked: await this.timeOff(
          doctorId,
          this.time.dayBounds(date),
          manager,
        ),
        notBefore: this.earliestStart(),
      },
    );
    if (!slots.some((slot) => slot.start.getTime() === startAt.getTime())) {
      throw unprocessable(
        ErrorCode.OUTSIDE_SCHEDULE,
        "The requested time is not an available slot in the doctor's schedule",
      );
    }
  }

  private async busyAppointments(
    doctorId: string,
    range: Interval,
    manager: EntityManager,
  ): Promise<Interval[]> {
    const rows = await manager
      .getRepository(Appointment)
      .createQueryBuilder('appointment')
      .select(['appointment.startAt', 'appointment.endAt'])
      .where('appointment.doctorId = :doctorId', { doctorId })
      .andWhere('appointment.status IN (:...active)', {
        active: ACTIVE_STATUSES,
      })
      .andWhere('appointment.startAt < :end AND appointment.endAt > :start', {
        start: range.start,
        end: range.end,
      })
      .getMany();
    return rows.map((row) => ({ start: row.startAt, end: row.endAt }));
  }
}
