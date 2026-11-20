import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmpty,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateNested,
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
import { InvoiceStatus } from '../../billing/billing.enums.js';
import { NoteStatus } from '../../clinical/clinical.enums.js';
import { PackageSessionDto } from '../../packages/dto/package.dto.js';
import { PersonNameField } from '../../users/dto/user.dto.js';
import { VisitStatus } from '../../visits/visit.enums.js';
import {
  AppointmentSource,
  AppointmentStatus,
  AppointmentType,
} from '../appointment.enums.js';

/** GET /appointments/day with `to`: the longest range, in days (a week). */
export const DAY_LIST_MAX_DAYS = 7;

const START_DOC = {
  example: '2026-11-05T17:00:00+02:00',
  description:
    'ISO 8601 with offset. The end time is always computed from the service duration.',
};
const PHONE_DOC = {
  example: '01012345678',
  description: 'Egyptian mobile, any common format',
};

// Required wherever a booking (or a walk-in) is made; there is no default.
export const AppointmentTypeField = () => (target: object, key: string) => {
  ApiProperty({
    enum: AppointmentType,
    enumName: 'AppointmentType',
    description:
      "What the visit is for. Only a classification (never changes the price, duration, slots, packages or invoices); it decides which fields the visit's clinical note has.",
  })(target, key);
  IsEnum(AppointmentType)(target, key);
};

// The type as returned: null = not set (booked before types existed).
const TYPE_OUT = {
  enum: AppointmentType,
  enumName: 'AppointmentType',
  nullable: true,
  description: 'null = not set (booked before appointment types existed)',
} as const;

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

  @AppointmentTypeField()
  type: AppointmentType;

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

// utm_* of the booking link, kept as received (trimmed, blank = absent).
// Nothing else about the visitor is collected.
export class UtmTagsDto {
  @ApiPropertyOptional({ example: 'facebook', maxLength: 100 })
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(100)
  source?: string | null;

  @ApiPropertyOptional({ example: 'cpc', maxLength: 100 })
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(100)
  medium?: string | null;

  @ApiPropertyOptional({ example: 'back-pain-nov', maxLength: 100 })
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(100)
  campaign?: string | null;

  @ApiPropertyOptional({ example: 'video-ad', maxLength: 100 })
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(100)
  content?: string | null;

  @ApiPropertyOptional({ example: 'physiotherapy cairo', maxLength: 100 })
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(100)
  term?: string | null;
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

  @AppointmentTypeField()
  type: AppointmentType;

  @ApiProperty(START_DOC)
  @IsIsoWithOffset()
  startAt: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'A package the patient wants (GET /public/packages: same service, offered by this doctor). Only a request: it is sold and paid at the clinic.',
  })
  @IsOptional()
  @IsUUID()
  packageId?: string;

  @ApiPropertyOptional({
    type: UtmTagsDto,
    description:
      'utm_source / utm_medium / utm_campaign / utm_content / utm_term of the link the patient came from. Stored on the appointment for campaign reports; never changes the acquisition sources reception records.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UtmTagsDto)
  utm?: UtmTagsDto;

  // Honeypot: hidden in the website form, so humans leave it empty.
  @ApiPropertyOptional({
    description: 'Anti-bot honeypot. Must be omitted or empty.',
  })
  @IsOptional()
  @IsEmpty({ message: 'Invalid request' })
  website?: string;
}

// PATCH /appointments/:id/type and PATCH /visits/:id/type (RECEPTIONIST).
export class ChangeAppointmentTypeDto {
  @AppointmentTypeField()
  type: AppointmentType;
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
  @ApiProperty({
    example: '2026-11-05',
    description: 'Clinic local date (the first day when `to` is given)',
  })
  @IsLocalDate()
  date: string;

  @ApiPropertyOptional({
    example: '2026-11-11',
    description: `Last clinic local date, inclusive (a week view in one request). At most ${DAY_LIST_MAX_DAYS} days from \`date\`; else DATE_OUT_OF_RANGE.`,
  })
  @IsOptional()
  @IsLocalDate()
  to?: string;

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

export class RequestedPackageDto {
  @ApiProperty({ format: 'uuid', description: 'The package (catalog) id' })
  id: string;

  @ApiProperty({ example: '10 physio sessions' })
  name: string;
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

  @ApiProperty(TYPE_OUT)
  type: AppointmentType | null;

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

  @ApiProperty({
    type: RequestedPackageDto,
    nullable: true,
    description:
      'Package picked when booking online: sell it at the desk (POST /patients/:id/packages)',
  })
  requestedPackage: RequestedPackageDto | null;

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
    ...TYPE_OUT,
    description:
      "The appointment's type, or the walk-in's own. null = not set (from before appointment types existed)",
  })
  type: AppointmentType | null;

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

  @ApiProperty({
    type: RequestedPackageDto,
    nullable: true,
    description: 'Package the patient asked for when booking online',
  })
  requestedPackage: RequestedPackageDto | null;

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
    type: PackageSessionDto,
    nullable: true,
    description:
      'The package session this visit (or this no-show) used; no prices',
  })
  package: PackageSessionDto | null;

  @ApiProperty({
    type: [String],
    example: ['cancel', 'reschedule', 'attend'],
    description:
      'Desk: confirm, cancel, reschedule, noShow, undoNoShow, attend, undoAttend (a walk-in is undone with POST /visits/:visitId/undo-attend), restoreSession (a no-show that used a package session: POST /package-usages/:package.usageId/restore), createInvoice (the invoice of the visit was cancelled: POST /invoices/:cancelledInvoiceId/reissue). Doctor: writeNote, viewNote.',
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

  @ApiPropertyOptional({
    enum: InvoiceStatus,
    nullable: true,
    description: `${BILLING} Status of the visit's live invoice; CANCELLED when its invoice was cancelled and can be created again (allowedActions createInvoice); else null.`,
  })
  invoiceStatus?: InvoiceStatus | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    type: String,
    description: `${BILLING} The cancelled invoice to create again (allowedActions createInvoice: POST /invoices/:cancelledInvoiceId/reissue), else null.`,
  })
  cancelledInvoiceId?: string | null;
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

  @ApiProperty({ enum: AppointmentType, enumName: 'AppointmentType' })
  type: AppointmentType;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '10 physio sessions',
    description: 'The package requested (bought and paid at the clinic)',
  })
  packageName: string | null;
}
