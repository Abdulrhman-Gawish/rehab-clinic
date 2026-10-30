import type { INestApplication } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { UserRole } from '../../src/common/enums/user-role.enum.js';
import {
  AppointmentSource,
  AppointmentStatus,
} from '../../src/modules/appointments/appointment.enums.js';
import { Appointment } from '../../src/modules/appointments/entities/appointment.entity.js';
import {
  Patient,
  PatientSource,
} from '../../src/modules/patients/entities/patient.entity.js';
import { ClinicService } from '../../src/modules/clinic-services/entities/clinic-service.entity.js';
import { DoctorClinicService } from '../../src/modules/doctors/entities/doctor-clinic-service.entity.js';
import { Doctor } from '../../src/modules/doctors/entities/doctor.entity.js';
import { DoctorSchedule } from '../../src/modules/schedules/entities/doctor-schedule.entity.js';
import { Visit } from '../../src/modules/visits/entities/visit.entity.js';
import { VisitStatus } from '../../src/modules/visits/visit.enums.js';
import { accessTokenFor, insertUser, type TestUser } from './auth-helpers.js';

// Direct DB inserts for test setup (bypassing the API).

export async function insertDoctor(
  dataSource: DataSource,
  overrides: Partial<Pick<Doctor, 'isActive' | 'isPublic' | 'userId'>> = {},
): Promise<Doctor> {
  const userId =
    overrides.userId ?? (await insertUser(dataSource, UserRole.DOCTOR)).id;
  const repository = dataSource.getRepository(Doctor);
  return repository.save(
    repository.create({
      specialty: 'Physiotherapy',
      bio: null,
      photoUrl: null,
      isActive: true,
      isPublic: true,
      ...overrides,
      userId,
    }),
  );
}

// A DOCTOR login together with its profile.
export async function createLoggedInDoctor(
  app: INestApplication,
  dataSource: DataSource,
): Promise<TestUser & { doctorId: string }> {
  const user = await insertUser(dataSource, UserRole.DOCTOR);
  const doctor = await insertDoctor(dataSource, { userId: user.id });
  return {
    id: user.id,
    email: user.email,
    role: UserRole.DOCTOR,
    doctorId: doctor.id,
    accessToken: accessTokenFor(app, user),
  };
}

export async function insertService(
  dataSource: DataSource,
  overrides: Partial<
    Pick<ClinicService, 'name' | 'durationMinutes' | 'basePrice' | 'isActive'>
  > = {},
): Promise<ClinicService> {
  const repository = dataSource.getRepository(ClinicService);
  return repository.save(
    repository.create({
      name: 'Session',
      description: null,
      durationMinutes: 30,
      basePrice: '300.00',
      isActive: true,
      ...overrides,
    }),
  );
}

export async function assignService(
  dataSource: DataSource,
  doctorId: string,
  serviceId: string,
): Promise<void> {
  await dataSource
    .getRepository(DoctorClinicService)
    .insert({ doctorId, serviceId, priceOverride: null });
}

// Same working hours on every weekday, in clinic local time.
export async function insertWeeklySchedule(
  dataSource: DataSource,
  doctorId: string,
  ranges: [string, string][] = [['08:00', '20:00']],
): Promise<void> {
  const rows = [0, 1, 2, 3, 4, 5, 6].flatMap((dayOfWeek) =>
    ranges.map(([startTime, endTime]) => ({
      doctorId,
      dayOfWeek,
      startTime,
      endTime,
      isActive: true,
    })),
  );
  await dataSource.getRepository(DoctorSchedule).insert(rows);
}

export async function insertPatient(
  dataSource: DataSource,
  name: string,
  phone: string,
): Promise<Patient> {
  const repository = dataSource.getRepository(Patient);
  return repository.save(
    repository.create({
      name,
      phone,
      dateOfBirth: null,
      gender: null,
      notes: null,
      createdSource: PatientSource.RECEPTION,
      createdById: null,
    }),
  );
}

let referenceSequence = 0;

// A CONFIRMED (by default) reception appointment, bypassing slot checks.
export async function insertAppointment(
  dataSource: DataSource,
  data: {
    patientId: string;
    doctorId: string;
    serviceId: string;
    startAt: Date;
    durationMinutes?: number;
    status?: AppointmentStatus;
  },
): Promise<Appointment> {
  referenceSequence += 1;
  const repository = dataSource.getRepository(Appointment);
  return repository.save(
    repository.create({
      referenceCode: `APT-F${String(referenceSequence).padStart(5, '2')}`,
      patientId: data.patientId,
      doctorId: data.doctorId,
      serviceId: data.serviceId,
      startAt: data.startAt,
      endAt: new Date(
        data.startAt.getTime() + (data.durationMinutes ?? 30) * 60_000,
      ),
      status: data.status ?? AppointmentStatus.CONFIRMED,
      source: AppointmentSource.RECEPTION,
      bookedName: 'Booked Name',
      bookedById: null,
      rescheduledFromId: null,
      cancelReason: null,
      notes: null,
    }),
  );
}

// A walk-in visit in any status, bypassing check-in (no events, no invoice).
export async function insertVisit(
  dataSource: DataSource,
  data: {
    patientId: string;
    doctorId: string;
    serviceId: string;
    checkedInById: string;
    status?: VisitStatus;
    checkedInAt?: Date;
  },
): Promise<Visit> {
  const status = data.status ?? VisitStatus.WAITING;
  const checkedInAt = data.checkedInAt ?? new Date();
  const started = [VisitStatus.IN_SESSION, VisitStatus.COMPLETED].includes(
    status,
  );
  const repository = dataSource.getRepository(Visit);
  return repository.save(
    repository.create({
      appointmentId: null,
      patientId: data.patientId,
      doctorId: data.doctorId,
      serviceId: data.serviceId,
      status,
      checkedInAt,
      checkedInById: data.checkedInById,
      startedAt: started ? checkedInAt : null,
      completedAt: status === VisitStatus.COMPLETED ? checkedInAt : null,
      completedById:
        status === VisitStatus.COMPLETED ? data.checkedInById : null,
      cancelledAt: status === VisitStatus.CANCELLED ? checkedInAt : null,
      cancelledById:
        status === VisitStatus.CANCELLED ? data.checkedInById : null,
      cancelReason: status === VisitStatus.CANCELLED ? 'Patient left' : null,
    }),
  );
}
