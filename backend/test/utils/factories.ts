import type { INestApplication } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { UserRole } from '../../src/common/enums/user-role.enum.js';
import { ClinicService } from '../../src/modules/clinic-services/entities/clinic-service.entity.js';
import { DoctorClinicService } from '../../src/modules/doctors/entities/doctor-clinic-service.entity.js';
import { Doctor } from '../../src/modules/doctors/entities/doctor.entity.js';
import { DoctorSchedule } from '../../src/modules/schedules/entities/doctor-schedule.entity.js';
import { insertUser, login, type TestUser } from './auth-helpers.js';

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
  const tokens = await login(app, user.email);
  return {
    id: user.id,
    email: user.email,
    role: UserRole.DOCTOR,
    doctorId: doctor.id,
    ...tokens,
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
