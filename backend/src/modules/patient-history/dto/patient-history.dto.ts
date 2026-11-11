import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  LocalDateFrom,
  LocalDateTo,
} from '../../../common/decorators/date-time.decorators.js';
import { ToArray } from '../../../common/decorators/transform.decorators.js';
import { UserRefDto } from '../../../common/dto/user-ref.dto.js';
import { AppointmentStatus } from '../../appointments/appointment.enums.js';
import { PatientBalanceDto } from '../../billing/dto/invoice.dto.js';
import { NoteStatus } from '../../clinical/clinical.enums.js';
import { PatientSource } from '../../patients/entities/patient.entity.js';
import { TimelineEventType } from '../patient-history.enums.js';

export const TIMELINE_DEFAULT_LIMIT = 50;
export const TIMELINE_MAX_LIMIT = 200;

const AT = (example: string) => ({
  example,
  description: 'ISO 8601 with offset',
});

// ---------- Inputs ----------

export class TimelineQueryDto {
  @LocalDateFrom('Events')
  from?: string;

  @LocalDateTo('Events')
  to?: string;

  @ApiPropertyOptional({
    enum: TimelineEventType,
    isArray: true,
    description:
      '?types=A&types=B or ?types=A,B. Types your role cannot see are ignored.',
  })
  @IsOptional()
  @ToArray()
  @IsEnum(TimelineEventType, { each: true })
  types?: TimelineEventType[];

  @ApiPropertyOptional({
    description: '`nextCursor` of the previous page (opaque)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: TIMELINE_MAX_LIMIT,
    default: TIMELINE_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TIMELINE_MAX_LIMIT)
  limit: number = TIMELINE_DEFAULT_LIMIT;
}

// ---------- Outputs ----------

export class NamedRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Dr. Mona Adel' })
  name: string;
}

export class TimelineRefsDto {
  @ApiPropertyOptional({ format: 'uuid' })
  appointmentId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  visitId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  invoiceId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  paymentId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  noteId?: string;
}

export class TimelineEventDto {
  @ApiProperty({
    example: 'PAYMENT_RECORDED:3f0c…',
    description: 'Stable and unique: the type and the source row id',
  })
  id: string;

  @ApiProperty({ enum: TimelineEventType })
  type: TimelineEventType;

  @ApiProperty(AT('2026-11-03T10:15:00+02:00'))
  at: string;

  @ApiProperty({
    type: UserRefDto,
    nullable: true,
    description: 'Who did it; null for online bookings',
  })
  actor: UserRefDto | null;

  @ApiProperty({
    type: NamedRefDto,
    nullable: true,
    description: 'The doctor the event is about; null when none',
  })
  doctor: NamedRefDto | null;

  @ApiProperty({
    type: TimelineRefsDto,
    description: 'Only the ids that apply',
  })
  refs: TimelineRefsDto;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Type-specific fields (see the README). Money is a decimal string, instants are ISO with offset.',
  })
  data: Record<string, unknown>;
}

export class TimelinePageDto {
  @ApiProperty({ type: [TimelineEventDto] })
  items: TimelineEventDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as `cursor` for the next (older) page; null at the end',
  })
  nextCursor: string | null;
}

export class OverviewPatientDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Ahmed Hassan' })
  name: string;

  @ApiProperty({ example: '+201012345678' })
  phone: string;

  @ApiProperty({ enum: PatientSource })
  createdSource: PatientSource;

  @ApiProperty(AT('2026-10-01T12:00:00+03:00'))
  createdAt: string;
}

export class OverviewAppointmentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty(AT('2026-11-05T17:00:00+02:00'))
  startAt: string;

  @ApiProperty({ enum: AppointmentStatus })
  status: AppointmentStatus;

  @ApiProperty({ type: NamedRefDto })
  doctor: NamedRefDto;

  @ApiProperty({ type: NamedRefDto })
  service: NamedRefDto;
}

export class OverviewVisitDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty(AT('2026-11-03T10:15:00+02:00'))
  attendedAt: string;

  @ApiProperty()
  isWalkIn: boolean;

  @ApiProperty({ type: NamedRefDto })
  doctor: NamedRefDto;

  @ApiProperty({ type: NamedRefDto })
  service: NamedRefDto;
}

export class OverviewCountsDto {
  @ApiProperty({ example: 7, description: 'ACTIVE visits, walk-ins included' })
  attended: number;

  @ApiProperty({ example: 1 })
  noShow: number;

  @ApiProperty({ example: 2 })
  cancelled: number;
}

export class OverviewDoctorDto extends NamedRefDto {
  @ApiProperty(AT('2026-11-03T10:15:00+02:00'))
  lastVisitAt: string;
}

export class OverviewNoteDto {
  @ApiProperty({ format: 'uuid' })
  visitId: string;

  @ApiProperty(AT('2026-11-03T10:15:00+02:00'))
  attendedAt: string;

  @ApiProperty({ type: NamedRefDto })
  doctor: NamedRefDto;

  @ApiProperty({ type: NamedRefDto })
  service: NamedRefDto;

  @ApiProperty({
    enum: NoteStatus,
    nullable: true,
    description: 'DRAFT, or null when there is no note yet',
  })
  noteStatus: NoteStatus | null;
}

export class PatientOverviewDto {
  @ApiProperty({ type: OverviewPatientDto })
  patient: OverviewPatientDto;

  @ApiProperty({
    type: OverviewAppointmentDto,
    nullable: true,
    description: 'Earliest PENDING/CONFIRMED appointment starting from now',
  })
  nextAppointment: OverviewAppointmentDto | null;

  @ApiProperty({ type: OverviewVisitDto, nullable: true })
  lastVisit: OverviewVisitDto | null;

  @ApiProperty({ type: OverviewCountsDto })
  counts: OverviewCountsDto;

  @ApiProperty({
    type: [OverviewDoctorDto],
    description: 'Doctors with an ACTIVE visit, most recent first',
  })
  doctors: OverviewDoctorDto[];

  @ApiProperty({
    type: PatientBalanceDto,
    nullable: true,
    description: 'null for DOCTOR (no billing access)',
  })
  balance: PatientBalanceDto | null;

  @ApiProperty({
    type: [OverviewNoteDto],
    nullable: true,
    description:
      'ACTIVE visits without a signed note, oldest first: a DOCTOR gets their own, the OWNER all. null for RECEPTIONIST.',
  })
  notesNeedingAttention: OverviewNoteDto[] | null;
}
