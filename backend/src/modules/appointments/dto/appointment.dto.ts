import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmpty,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { EgyptianMobile } from '../../../common/decorators/egyptian-mobile.decorator.js';
import {
  IsIsoWithOffset,
  IsLocalDate,
  LocalDateFrom,
  LocalDateTo,
} from '../../../common/decorators/date-time.decorators.js';
import {
  ToArray,
  Trim,
  TrimOrNull,
} from '../../../common/decorators/transform.decorators.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { UserRefDto } from '../../../common/dto/user-ref.dto.js';
import { NoteStatus } from '../../clinical/clinical.enums.js';
import { PersonNameField } from '../../users/dto/user.dto.js';
import { VisitStatus } from '../../visits/visit.enums.js';
import { AppointmentSource, AppointmentStatus } from '../appointment.enums.js';

const START_DOC = {
  example: '2026-11-05T17:00:00+02:00',
  description:
    'ISO 8601 with offset. The end time is always computed from the service duration.',
};
const PHONE_DOC = {
  example: '01012345678',
  description: 'Egyptian mobile, any common format',
};

// ---------- Inputs ----------

export class CreateAppointmentDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Existing patient. Either patientId OR name + phone.',
  })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional({
    example: 'Ahmed Hassan',
    description: 'New or existing patient by phone (with phone)',
  })
  @IsOptional()
  @TrimOrNull({ collapse: true })
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional(PHONE_DOC)
  @IsOptional()
  @EgyptianMobile()
  phone?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  doctorId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  serviceId: string;

  @ApiProperty(START_DOC)
  @IsIsoWithOffset()
  startAt: string;

  @ApiPropertyOptional({ maxLength: 2000, description: 'Administrative only' })
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Skip schedule, time-off and lead-time checks (audited). Overlaps are still rejected.',
  })
  @IsOptional()
  @IsBoolean()
  allowOutsideSchedule?: boolean;
}

export class PublicBookingDto {
  @PersonNameField()
  name: string;

  @ApiProperty(PHONE_DOC)
  @EgyptianMobile()
  phone: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  doctorId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  serviceId: string;

  @ApiProperty(START_DOC)
  @IsIsoWithOffset()
  startAt: string;

  // Honeypot: hidden in the website form, so humans leave it empty.
  @ApiPropertyOptional({
    description: 'Anti-bot honeypot. Must be omitted or empty.',
  })
  @IsOptional()
  @IsEmpty({ message: 'Invalid request' })
  website?: string;
}

export class CancelAppointmentDto {
  @ApiProperty({ example: 'Patient called to cancel', maxLength: 255 })
  @Trim()
  @IsString()
  @Length(3, 255)
  reason: string;
}

export class RescheduleAppointmentDto {
  @ApiProperty(START_DOC)
  @IsIsoWithOffset()
  startAt: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Another doctor offering the same service (default: same)',
  })
  @IsOptional()
  @IsUUID()
  doctorId?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(255)
  reason?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  allowOutsideSchedule?: boolean;
}

export class ListAppointmentsQueryDto extends PaginationQueryDto {
  @LocalDateFrom('Starting')
  from?: string;

  @LocalDateTo('Starting')
  to?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  doctorId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional({ enum: AppointmentStatus })
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @ApiPropertyOptional({ enum: AppointmentSource })
  @IsOptional()
  @IsEnum(AppointmentSource)
  source?: AppointmentSource;
}

export class DayListQueryDto {
  @ApiProperty({ example: '2026-11-05', description: 'Clinic local date' })
  @IsLocalDate()
  date: string;

  @ApiPropertyOptional({
    enum: AppointmentStatus,
    isArray: true,
    description:
      'One or more statuses (repeat the parameter or comma-separate). Walk-ins count as ATTENDED.',
  })
  @IsOptional()
  @ToArray()
  @IsEnum(AppointmentStatus, { each: true })
  status?: AppointmentStatus[];

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Ignored for doctors (always their own)',
  })
  @IsOptional()
  @IsUUID()
  doctorId?: string;
}

// ---------- Outputs ----------

export class AppointmentPatientDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Ahmed Hassan' })
  name: string;

  @ApiProperty({ example: '+201012345678' })
  phone: string;
}

export class AppointmentDoctorDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Dr. Mona Adel' })
  name: string;
}

export class AppointmentServiceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Physiotherapy session' })
  name: string;

  @ApiProperty({ example: 45 })
  durationMinutes: number;
}

export class AppointmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'APT-7K3Q9X' })
  referenceCode: string;

  @ApiProperty({ enum: AppointmentStatus })
  status: AppointmentStatus;

  @ApiProperty({ enum: AppointmentSource })
  source: AppointmentSource;

  @ApiProperty({ example: '2026-11-05T17:00:00+02:00' })
  startAt: string;

  @ApiProperty({ example: '2026-11-05T17:45:00+02:00' })
  endAt: string;

  @ApiProperty({ description: 'Name typed at booking time' })
  bookedName: string;

  @ApiProperty({
    description:
      "bookedName differs from the patient's stored name (review at reception)",
  })
  nameMismatch: boolean;

  @ApiProperty({ type: AppointmentPatientDto })
  patient: AppointmentPatientDto;

  @ApiProperty({ type: AppointmentDoctorDto })
  doctor: AppointmentDoctorDto;

  @ApiProperty({ type: AppointmentServiceDto })
  service: AppointmentServiceDto;

  @ApiProperty({
    type: UserRefDto,
    nullable: true,
    description: 'null for online bookings',
  })
  bookedBy: UserRefDto | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  rescheduledFromId: string | null;

  @ApiProperty({ nullable: true, type: String })
  cancelReason: string | null;

  @ApiProperty({ nullable: true, type: String })
  notes: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class StatusHistoryEntryDto {
  @ApiProperty({ enum: AppointmentStatus, nullable: true })
  fromStatus: AppointmentStatus | null;

  @ApiProperty({ enum: AppointmentStatus })
  toStatus: AppointmentStatus;

  @ApiProperty({
    type: UserRefDto,
    nullable: true,
    description: 'null for online (public) actions',
  })
  changedBy: UserRefDto | null;

  @ApiProperty({ nullable: true, type: String })
  reason: string | null;

  @ApiProperty({ example: '2026-11-01T10:00:00+02:00' })
  changedAt: string;
}

export enum DayPaymentStatus {
  NOT_INVOICED = 'NOT_INVOICED',
  UNPAID = 'UNPAID',
  PARTIAL = 'PARTIAL',
  PAID = 'PAID',
}

const BILLING = 'Omitted for doctors.';

// Day list row: an appointment (with its visit, if attended) or a walk-in
// visit (appointment fields null, isWalkIn true).
export class DayListEntryDto {
  @ApiProperty()
  isWalkIn: boolean;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    type: String,
    description: 'Appointment id (null for walk-ins)',
  })
  id: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'APT-7K3Q9X' })
  referenceCode: string | null;

  @ApiProperty({ enum: AppointmentStatus, nullable: true })
  status: AppointmentStatus | null;

  @ApiProperty({ enum: AppointmentSource, nullable: true })
  source: AppointmentSource | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-11-05T17:00:00+02:00',
  })
  startAt: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-11-05T17:45:00+02:00',
  })
  endAt: string | null;

  @ApiProperty({ nullable: true, type: String })
  bookedName: string | null;

  @ApiProperty({ description: 'Always false for walk-ins' })
  nameMismatch: boolean;

  @ApiProperty({ type: AppointmentPatientDto })
  patient: AppointmentPatientDto;

  @ApiProperty({ type: AppointmentDoctorDto })
  doctor: AppointmentDoctorDto;

  @ApiProperty({ type: AppointmentServiceDto })
  service: AppointmentServiceDto;

  @ApiProperty({ nullable: true, type: String })
  notes: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Appointment cancel reason, or the void reason of a walk-in',
  })
  cancelReason: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  visitId: string | null;

  @ApiProperty({ enum: VisitStatus, nullable: true })
  visitStatus: VisitStatus | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-11-05T16:50:00+02:00',
  })
  attendedAt: string | null;

  @ApiProperty({ enum: NoteStatus, nullable: true })
  noteStatus: NoteStatus | null;

  @ApiProperty({
    type: [String],
    example: ['cancel', 'reschedule', 'attend'],
    description:
      'Desk: confirm, cancel, reschedule, noShow, undoNoShow, attend, undoAttend (a walk-in is undone with POST /visits/:visitId/undo-attend). Doctor: writeNote, viewNote.',
  })
  allowedActions: string[];

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    type: String,
    description: BILLING,
  })
  invoiceId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: '320.00',
    description: BILLING,
  })
  invoiceTotal?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: '100.00',
    description: BILLING,
  })
  amountPaid?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: '220.00',
    description: BILLING,
  })
  balance?: string | null;

  @ApiPropertyOptional({ enum: DayPaymentStatus, description: BILLING })
  paymentStatus?: DayPaymentStatus;
}

// What the public website gets back: nothing about the patient record.
export class PublicBookingResponseDto {
  @ApiProperty({ example: 'APT-7K3Q9X' })
  referenceCode: string;

  @ApiProperty({ example: 'Dr. Mona Adel' })
  doctorName: string;

  @ApiProperty({ example: 'Physiotherapy session' })
  serviceName: string;

  @ApiProperty({ example: '2026-11-05T17:00:00+02:00' })
  startAt: string;

  @ApiProperty({ example: '2026-11-05T17:45:00+02:00' })
  endAt: string;

  @ApiProperty({ enum: [AppointmentStatus.PENDING] })
  status: AppointmentStatus;
}
