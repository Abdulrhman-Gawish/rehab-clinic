import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { EgyptianMobile } from '../../../common/decorators/egyptian-mobile.decorator.js';
import {
  IsLocalDate,
  LocalDateFrom,
  LocalDateTo,
} from '../../../common/decorators/date-time.decorators.js';
import {
  ToBoolean,
  Trim,
  TrimOrNull,
} from '../../../common/decorators/transform.decorators.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { UserRefDto } from '../../../common/dto/user-ref.dto.js';
import {
  AppointmentDoctorDto,
  AppointmentPatientDto,
  AppointmentServiceDto,
} from '../../appointments/dto/appointment.dto.js';
import { NoteStatus } from '../../clinical/clinical.enums.js';
import { VisitStatus } from '../visit.enums.js';

const AT = (example: string) => ({
  example,
  description: 'ISO 8601 with offset',
});

// ---------- Inputs ----------

export class WalkInDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Existing patient. Either patientId OR name + phone.',
  })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional({ example: 'Ahmed Hassan' })
  @IsOptional()
  @TrimOrNull({ collapse: true })
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional({ example: '01012345678' })
  @IsOptional()
  @EgyptianMobile()
  phone?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  doctorId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  serviceId: string;
}

export class VisitReasonDto {
  @ApiProperty({ example: 'Sent in the wrong patient', maxLength: 255 })
  @Trim()
  @IsString()
  @Length(3, 255)
  reason: string;
}

export class ListVisitsQueryDto extends PaginationQueryDto {
  @LocalDateFrom('Attended')
  from?: string;

  @LocalDateTo('Attended')
  to?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  doctorId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional({ enum: VisitStatus })
  @IsOptional()
  @IsEnum(VisitStatus)
  status?: VisitStatus;

  @ApiPropertyOptional({
    description: 'true = walk-ins only, false = from appointments only',
  })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  walkIn?: boolean;
}

export class QueueQueryDto {
  @ApiPropertyOptional({
    example: '2026-11-05',
    description: 'Clinic local date (default: today)',
  })
  @IsOptional()
  @IsLocalDate()
  date?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Ignored for doctors (always their own)',
  })
  @IsOptional()
  @IsUUID()
  doctorId?: string;
}

// ---------- Outputs ----------

export class VisitResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: VisitStatus })
  status: VisitStatus;

  @ApiProperty()
  isWalkIn: boolean;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  appointmentId: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'APT-7K3Q9X' })
  appointmentReferenceCode: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-11-05T10:00:00+02:00',
  })
  appointmentStartAt: string | null;

  @ApiProperty({ type: AppointmentPatientDto })
  patient: AppointmentPatientDto;

  @ApiProperty({ type: AppointmentDoctorDto })
  doctor: AppointmentDoctorDto;

  @ApiProperty({ type: AppointmentServiceDto })
  service: AppointmentServiceDto;

  @ApiProperty(AT('2026-11-05T09:50:00+02:00'))
  attendedAt: string;

  @ApiProperty({ type: UserRefDto })
  attendedBy: UserRefDto;

  @ApiProperty({ nullable: true, type: String })
  voidedAt: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  voidedBy: UserRefDto | null;

  @ApiProperty({ nullable: true, type: String })
  voidReason: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

// Attend and walk-in: the visit plus the invoice created with it.
export class AttendResponseDto extends VisitResponseDto {
  @ApiProperty({ format: 'uuid' })
  invoiceId: string;
}

export class QueueEntryDto {
  @ApiProperty({ format: 'uuid' })
  visitId: string;

  @ApiProperty()
  isWalkIn: boolean;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  appointmentId: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-11-05T10:00:00+02:00',
    description: 'Booked start time; null for walk-ins',
  })
  appointmentStartAt: string | null;

  @ApiProperty({ type: AppointmentPatientDto })
  patient: AppointmentPatientDto;

  @ApiProperty({ type: AppointmentDoctorDto })
  doctor: AppointmentDoctorDto;

  @ApiProperty({ type: AppointmentServiceDto })
  service: AppointmentServiceDto;

  @ApiProperty(AT('2026-11-05T09:50:00+02:00'))
  attendedAt: string;

  @ApiProperty({
    description: 'The visit has a clinical note (draft or signed)',
  })
  hasNote: boolean;

  @ApiProperty({ enum: NoteStatus, nullable: true })
  noteStatus: NoteStatus | null;
}

export class VisitHistoryEntryDto {
  @ApiProperty({ enum: VisitStatus, nullable: true })
  fromStatus: VisitStatus | null;

  @ApiProperty({ enum: VisitStatus })
  toStatus: VisitStatus;

  @ApiProperty({ type: UserRefDto })
  changedBy: UserRefDto;

  @ApiProperty({ nullable: true, type: String })
  reason: string | null;

  @ApiProperty(AT('2026-11-05T09:50:00+02:00'))
  changedAt: string;
}
