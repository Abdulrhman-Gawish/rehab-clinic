import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import {
  conflict,
  ErrorCode,
  unprocessable,
} from '../../common/errors/app.exception.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { isoToDate } from '../../common/time/clinic-time.util.js';
import { normalizePersonName } from '../../common/utils/person-name.util.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { Package } from '../packages/entities/package.entity.js';
import { Patient, PatientSource } from '../patients/entities/patient.entity.js';
import { PatientsService } from '../patients/patients.service.js';
import { AppointmentWriter } from './appointment-writer.service.js';
import {
  ACTIVE_STATUSES,
  AppointmentSource,
  AppointmentStatus,
} from './appointment.enums.js';
import { AvailabilityService } from './availability/availability.service.js';
import type {
  PublicBookingDto,
  PublicBookingResponseDto,
} from './dto/appointment.dto.js';
import { Appointment } from './entities/appointment.entity.js';

/**
 * Online booking from the public website. Patients are identified by phone
 * only; the response never reveals whether the phone was already known.
 */
@Injectable()
export class PublicBookingService {
  private readonly maxActivePerPhone: number;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly availability: AvailabilityService,
    private readonly patients: PatientsService,
    private readonly writer: AppointmentWriter,
    private readonly time: ClinicTimeService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.maxActivePerPhone = config.get('BOOKING_MAX_ACTIVE_PER_PHONE', {
      infer: true,
    });
  }

  async book(
    dto: PublicBookingDto,
    ip: string | null,
  ): Promise<PublicBookingResponseDto> {
    const startAt = isoToDate(dto.startAt);
    const actor = { userId: null, ip };

    return this.writer.runBooking(() =>
      this.dataSource.transaction(async (manager) => {
        const context = await this.availability.loadContext(
          dto.doctorId,
          dto.serviceId,
          { publicOnly: true },
          manager,
        );
        await this.availability.assertBookable(context, startAt, manager);
        const requested = dto.packageId
          ? await this.offeredPackage(
              dto.packageId,
              context.doctor.id,
              context.service.id,
              manager,
            )
          : null;

        // Existing phone -> existing patient, never renamed.
        const { patient } = await this.patients.findOrCreateByPhone(
          {
            name: dto.name,
            phone: dto.phone,
            source: PatientSource.ONLINE,
            createdBy: null,
            ip,
          },
          manager,
        );
        await this.assertBelowBookingLimit(patient.id, manager);

        const appointment = await this.writer.insert(
          manager,
          {
            patientId: patient.id,
            doctorId: context.doctor.id,
            serviceId: context.service.id,
            startAt,
            durationMinutes: context.service.durationMinutes,
            status: AppointmentStatus.PENDING,
            source: AppointmentSource.ONLINE,
            // Kept as typed so reception can review a name mismatch.
            bookedName: normalizePersonName(dto.name),
            bookedById: null,
            requestedPackageId: requested?.id ?? null,
          },
          actor,
        );

        return {
          referenceCode: appointment.referenceCode,
          doctorName: context.doctor.user.name,
          serviceName: context.service.name,
          startAt: this.time.toIso(appointment.startAt),
          endAt: this.time.toIso(appointment.endAt),
          status: appointment.status,
          packageName: requested?.name ?? null,
        };
      }),
    );
  }

  // The package picked online must be one GET /public/packages offers for
  // this doctor and service. Nothing is sold here: reception sells it.
  private async offeredPackage(
    packageId: string,
    doctorId: string,
    serviceId: string,
    manager: EntityManager,
  ): Promise<Package> {
    const pkg = await manager
      .getRepository(Package)
      .createQueryBuilder('pkg')
      .where('pkg.id = :packageId', { packageId })
      .andWhere('pkg.isActive = true AND pkg.isPublic = true')
      .andWhere('pkg.deletedAt IS NULL')
      .andWhere('pkg.serviceId = :serviceId', { serviceId })
      .andWhere(
        `(pkg.allDoctors OR EXISTS (SELECT 1 FROM package_doctors pd
          WHERE pd.package_id = pkg.id AND pd.doctor_id = :doctorId))`,
        { doctorId },
      )
      .getOne();
    if (!pkg) {
      throw unprocessable(
        ErrorCode.PACKAGE_NOT_OFFERED,
        'This package is not offered for this doctor and service',
      );
    }
    return pkg;
  }

  /**
   * Max N active future appointments per phone. The patient row is locked so
   * parallel bookings for the same phone are counted one after another. A
   * brand new patient simply has 0, so the answer never depends on whether
   * the phone existed.
   */
  private async assertBelowBookingLimit(
    patientId: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager.findOne(Patient, {
      where: { id: patientId },
      select: { id: true },
      lock: { mode: 'pessimistic_write' },
    });

    const active = await manager
      .getRepository(Appointment)
      .createQueryBuilder('appointment')
      .where('appointment.patientId = :patientId', { patientId })
      .andWhere('appointment.status IN (:...active)', {
        active: ACTIVE_STATUSES,
      })
      .andWhere('appointment.startAt > :now', { now: this.time.now() })
      .getCount();
    if (active >= this.maxActivePerPhone) {
      throw conflict(
        ErrorCode.BOOKING_LIMIT_REACHED,
        'This phone number already has the maximum number of upcoming appointments. Please call the clinic.',
      );
    }
  }
}
