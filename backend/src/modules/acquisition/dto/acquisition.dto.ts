import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Equals,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { IsLocalDate } from '../../../common/decorators/date-time.decorators.js';
import {
  Trim,
  TrimOrNull,
} from '../../../common/decorators/transform.decorators.js';
import { UserRefDto } from '../../../common/dto/user-ref.dto.js';
import { AppointmentStatus } from '../../appointments/appointment.enums.js';
import {
  AcquisitionCategory,
  AcquisitionChannel,
} from '../acquisition.enums.js';

// ---------- Inputs ----------

export class AddAcquisitionSourceDto {
  @ApiProperty({ enum: AcquisitionChannel })
  @IsEnum(AcquisitionChannel)
  channel: AcquisitionChannel;

  @ApiPropertyOptional({
    example: 'Back pain video ad',
    maxLength: 255,
    nullable: true,
    type: String,
  })
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(255)
  details?: string | null;

  @ApiPropertyOptional({
    description:
      'Make it the primary source. The first source of a patient is always primary.',
  })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class UpdateAcquisitionSourceDto {
  @ApiPropertyOptional({ maxLength: 255, nullable: true, type: String })
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(255)
  details?: string | null;

  @ApiPropertyOptional({
    enum: [true],
    description:
      'Make it the primary source (the previous primary stops being one). To change the primary, mark another source.',
  })
  @IsOptional()
  @Equals(true)
  isPrimary?: true;
}

export class RemoveAcquisitionSourceDto {
  @ApiProperty({ example: 'Recorded by mistake', maxLength: 255 })
  @Trim()
  @IsString()
  @Length(3, 255)
  reason: string;
}

const ReportDate = (example: string, description: string) =>
  ApiProperty({ example, description });

export class AcquisitionReportQueryDto {
  @ReportDate('2026-11-01', 'Patients created on or after this local date')
  @IsLocalDate()
  from: string;

  @ReportDate('2026-11-30', 'Patients created on or before this local date')
  @IsLocalDate()
  to: string;

  @ApiPropertyOptional({ enum: AcquisitionChannel })
  @IsOptional()
  @IsEnum(AcquisitionChannel)
  channel?: AcquisitionChannel;
}

export class CampaignReportQueryDto {
  @ReportDate('2026-11-01', 'Appointments starting on or after this date')
  @IsLocalDate()
  from: string;

  @ReportDate('2026-11-30', 'Appointments starting on or before this date')
  @IsLocalDate()
  to: string;
}

// ---------- Outputs ----------

export class AcquisitionSourceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: AcquisitionChannel })
  channel: AcquisitionChannel;

  @ApiProperty({ enum: AcquisitionCategory })
  category: AcquisitionCategory;

  @ApiProperty({ nullable: true, type: String })
  details: string | null;

  @ApiProperty()
  isPrimary: boolean;

  @ApiProperty({ type: UserRefDto })
  recordedBy: UserRefDto;

  @ApiProperty({ example: '2026-11-03T10:00:00+02:00' })
  recordedAt: string;

  @ApiProperty({ nullable: true, type: String })
  removedAt: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  removedBy: UserRefDto | null;

  @ApiProperty({ nullable: true, type: String })
  removalReason: string | null;
}

export class UtmDto {
  @ApiProperty({ nullable: true, type: String })
  source: string | null;

  @ApiProperty({ nullable: true, type: String })
  medium: string | null;

  @ApiProperty({ nullable: true, type: String })
  campaign: string | null;

  @ApiProperty({ nullable: true, type: String })
  content: string | null;

  @ApiProperty({ nullable: true, type: String })
  term: string | null;
}

export class CampaignBookingDto {
  @ApiProperty({ format: 'uuid' })
  appointmentId: string;

  @ApiProperty({ example: 'APT-7K3Q9X' })
  referenceCode: string;

  @ApiProperty({ example: '2026-11-05T17:00:00+02:00' })
  startAt: string;

  @ApiProperty({ example: '2026-11-01T21:14:00+02:00' })
  bookedAt: string;

  @ApiProperty({ enum: AppointmentStatus })
  status: AppointmentStatus;

  @ApiProperty({ type: UtmDto })
  utm: UtmDto;
}

export class PatientAcquisitionDto {
  @ApiProperty({
    type: [AcquisitionSourceDto],
    description: 'Current sources, primary first',
  })
  sources: AcquisitionSourceDto[];

  @ApiProperty({
    type: [AcquisitionSourceDto],
    description: 'Removed sources (history), newest first',
  })
  removed: AcquisitionSourceDto[];

  @ApiProperty({
    type: [CampaignBookingDto],
    description:
      'Online bookings that came with utm_* tags (automatic, separate from the sources above), newest first',
  })
  campaignBookings: CampaignBookingDto[];
}

export class ChannelRowDto {
  @ApiProperty({ enum: AcquisitionChannel })
  channel: AcquisitionChannel;

  @ApiProperty({ enum: AcquisitionCategory })
  category: AcquisitionCategory;

  @ApiProperty({
    description: 'Patients whose PRIMARY source is this channel',
  })
  patients: number;

  @ApiProperty({
    description: 'Patients naming this channel at all (primary or not)',
  })
  mentions: number;

  @ApiProperty({
    description: 'Of `patients`: attended at least one visit (any date)',
  })
  attendedPatients: number;

  @ApiProperty({
    description: 'Of `patients`: paid something (net of refunds, any date)',
  })
  payingPatients: number;

  @ApiProperty({
    example: '4500.00',
    description: 'Net money collected from `patients` so far',
  })
  collected: string;
}

export class CategoryRowDto {
  @ApiProperty({ enum: AcquisitionCategory })
  category: AcquisitionCategory;

  @ApiProperty({ description: 'Patients whose primary source is in it' })
  patients: number;
}

export class MonthRowDto {
  @ApiProperty({ example: '2026-11', description: 'Clinic local month' })
  month: string;

  @ApiProperty({
    enum: AcquisitionChannel,
    nullable: true,
    description: 'Primary channel; null = no source recorded',
  })
  channel: AcquisitionChannel | null;

  @ApiProperty()
  patients: number;
}

export class AcquisitionReportDto {
  @ApiProperty({ example: '2026-11-01' })
  from: string;

  @ApiProperty({ example: '2026-11-30' })
  to: string;

  @ApiProperty({ description: 'Patients created in the range' })
  newPatients: number;

  @ApiProperty({ description: 'Of them: no source recorded yet' })
  withoutSource: number;

  @ApiProperty({
    type: [ChannelRowDto],
    description: 'Most patients first',
  })
  channels: ChannelRowDto[];

  @ApiProperty({ type: [CategoryRowDto] })
  categories: CategoryRowDto[];

  @ApiProperty({
    type: [MonthRowDto],
    description: 'New patients per month and primary channel',
  })
  byMonth: MonthRowDto[];
}

export class CampaignRowDto {
  @ApiProperty({ nullable: true, type: String })
  source: string | null;

  @ApiProperty({ nullable: true, type: String })
  medium: string | null;

  @ApiProperty({ nullable: true, type: String })
  campaign: string | null;

  @ApiProperty({
    description: 'Tagged appointments (RESCHEDULED ones excluded)',
  })
  bookings: number;

  @ApiProperty({ description: 'Of them: now ATTENDED' })
  attended: number;

  @ApiProperty({ description: 'Distinct patients who booked' })
  patients: number;

  @ApiProperty({
    description:
      'Patients whose very first appointment was a booking of this campaign (the booking created them)',
  })
  newPatients: number;

  @ApiProperty({
    description: 'Patients who paid for the visit of such a booking',
  })
  payingPatients: number;

  @ApiProperty({
    example: '900.00',
    description: 'Net collected on the invoices of those visits',
  })
  collected: string;
}

export class CampaignReportDto {
  @ApiProperty({ example: '2026-11-01' })
  from: string;

  @ApiProperty({ example: '2026-11-30' })
  to: string;

  @ApiProperty({
    type: [CampaignRowDto],
    description: 'Most bookings first',
  })
  rows: CampaignRowDto[];
}
