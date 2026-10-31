import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsLocalDate } from '../../../common/decorators/date-time.decorators.js';
import {
  IsMoney,
  IsPositiveMoney,
} from '../../../common/decorators/money.decorator.js';
import {
  OptionalNotNull,
  ToBoolean,
  Trim,
  TrimAndCollapse,
} from '../../../common/decorators/transform.decorators.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { UserRefDto } from '../../../common/dto/user-ref.dto.js';
import { DiscountType } from '../../billing/billing.enums.js';
import { PackageUsageReason, PatientPackageStatus } from '../packages.enums.js';

const DESK = 'OWNER and RECEPTIONIST only (absent for a doctor)';

// ---------- Inputs ----------

export class PackageOfferDto {
  @ApiProperty({ enum: DiscountType })
  @IsEnum(DiscountType)
  type: DiscountType;

  @ApiProperty({
    example: '20.00',
    description: 'PERCENT: 0 < value <= 100. FIXED: EGP, at most the price.',
  })
  @IsPositiveMoney()
  value: string;

  @ApiPropertyOptional({
    example: '2026-11-01',
    nullable: true,
    type: String,
    description: 'First local day of the offer (null = already started)',
  })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsLocalDate()
  startsOn?: string | null;

  @ApiPropertyOptional({
    example: '2026-11-30',
    nullable: true,
    type: String,
    description: 'Last local day of the offer, inclusive (null = no end)',
  })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsLocalDate()
  endsOn?: string | null;
}

// Who offers the package: a list of doctors, or every doctor (including
// doctors added later). Exactly one of the two on create.
class PackageDoctorsDto {
  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'Each doctor must offer the package service',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  doctorIds?: string[];

  @ApiPropertyOptional({
    enum: [true],
    description: 'Every doctor, including doctors added later',
  })
  @IsOptional()
  @Equals(true)
  allDoctors?: true;
}

export class CreatePackageDto extends PackageDoctorsDto {
  @ApiProperty({ example: '10 physio sessions', maxLength: 120 })
  @TrimAndCollapse()
  @IsString()
  @Length(2, 120)
  name: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  serviceId: string;

  @ApiProperty({ example: 10, minimum: 1, maximum: 200 })
  @IsInt()
  @Min(1)
  @Max(200)
  sessionsCount: number;

  @ApiProperty({
    example: '3000.00',
    description: 'Total price of the whole package',
  })
  @IsMoney()
  price: string;

  @ApiPropertyOptional({ type: PackageOfferDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => PackageOfferDto)
  offer?: PackageOfferDto | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

export class UpdatePackageDto extends PackageDoctorsDto {
  @ApiPropertyOptional({ example: '10 physio sessions', maxLength: 120 })
  @OptionalNotNull()
  @TrimAndCollapse()
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @OptionalNotNull()
  @IsUUID()
  serviceId?: string;

  @ApiPropertyOptional({ example: 10, minimum: 1, maximum: 200 })
  @OptionalNotNull()
  @IsInt()
  @Min(1)
  @Max(200)
  sessionsCount?: number;

  @ApiPropertyOptional({
    example: '3000.00',
    description: 'Sold packages keep the price they were sold at',
  })
  @OptionalNotNull()
  @IsMoney()
  price?: string;

  @ApiPropertyOptional({
    type: PackageOfferDto,
    nullable: true,
    description: 'null removes the offer',
  })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @ValidateNested()
  @Type(() => PackageOfferDto)
  offer?: PackageOfferDto | null;

  @ApiPropertyOptional()
  @OptionalNotNull()
  @IsBoolean()
  isPublic?: boolean;
}

export class ListPackagesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;
}

export class SellPackageDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  packageId: string;
}

export class PackageReasonDto {
  @ApiProperty({ example: 'Patient moved to another city', maxLength: 255 })
  @Trim()
  @IsString()
  @Length(3, 255)
  reason: string;
}

/**
 * Attend and walk-in: which package pays the session. Default: the oldest
 * usable package of the patient (same service, the visit's doctor allowed,
 * sessions left, not cancelled), or none.
 */
export class PackageChoiceDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Use this package (422 PACKAGE_NOT_USABLE if it cannot pay)',
  })
  @IsOptional()
  @IsUUID()
  patientPackageId?: string;

  @ApiPropertyOptional({
    description: 'false = bill the visit normally, even with a package',
  })
  @IsOptional()
  @IsBoolean()
  usePackage?: boolean;
}

// ---------- Outputs ----------

export class PackageServiceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Physiotherapy session' })
  name: string;
}

export class PackageOfferResponseDto {
  @ApiProperty({ enum: DiscountType })
  type: DiscountType;

  @ApiProperty({ example: '20.00' })
  value: string;

  @ApiProperty({ nullable: true, type: String, example: '2026-11-01' })
  startsOn: string | null;

  @ApiProperty({ nullable: true, type: String, example: '2026-11-30' })
  endsOn: string | null;
}

export class PackageResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: '10 physio sessions' })
  name: string;

  @ApiProperty({ type: PackageServiceDto })
  service: PackageServiceDto;

  @ApiProperty({ example: 10 })
  sessionsCount: number;

  @ApiProperty({ example: '3000.00' })
  price: string;

  @ApiProperty({ type: PackageOfferResponseDto, nullable: true })
  offer: PackageOfferResponseDto | null;

  @ApiProperty({ description: 'The offer applies today' })
  offerActive: boolean;

  @ApiProperty({
    example: '2400.00',
    description: 'What a sale costs today (price minus the active offer)',
  })
  sellingPrice: string;

  @ApiProperty()
  allDoctors: boolean;

  @ApiProperty({
    type: [UserRefDto],
    description:
      'Listed doctors ({ id: doctor id, name }); empty when allDoctors',
  })
  doctors: UserRefDto[];

  @ApiProperty()
  isPublic: boolean;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

// Safe for the public website.
export class PublicPackageDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: '10 physio sessions' })
  name: string;

  @ApiProperty({ type: PackageServiceDto })
  service: PackageServiceDto;

  @ApiProperty({ example: 10 })
  sessionsCount: number;

  @ApiProperty({ example: '3000.00' })
  price: string;

  @ApiProperty({ example: '2400.00' })
  sellingPrice: string;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-11-30',
    description: 'Last day of the active offer (null: no offer or no end)',
  })
  offerEndsOn: string | null;

  @ApiProperty({ description: 'Every doctor offers it' })
  allDoctors: boolean;

  @ApiProperty({
    type: [UserRefDto],
    description:
      'The public doctors offering it ({ id: doctor id, name }); empty when allDoctors',
  })
  doctors: UserRefDto[];
}

export class PatientPackageDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  packageId: string;

  @ApiProperty({ example: '10 physio sessions', description: 'At sale time' })
  name: string;

  @ApiProperty({ type: PackageServiceDto })
  service: PackageServiceDto;

  @ApiProperty({ example: 10 })
  totalSessions: number;

  @ApiProperty({ example: 3 })
  usedSessions: number;

  @ApiProperty({ example: 7 })
  sessionsLeft: number;

  @ApiProperty({ enum: PatientPackageStatus })
  status: PatientPackageStatus;

  @ApiProperty({
    description: "The package's current doctors: every doctor",
  })
  allDoctors: boolean;

  @ApiProperty({
    type: [UserRefDto],
    description: "The package's current doctors (empty when allDoctors)",
  })
  doctors: UserRefDto[];

  @ApiProperty({ example: '2026-11-03T10:00:00+02:00' })
  soldAt: string;

  @ApiProperty({ type: UserRefDto })
  soldBy: UserRefDto;

  @ApiProperty({ nullable: true, type: String })
  cancelledAt: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  cancelledBy: UserRefDto | null;

  @ApiProperty({ nullable: true, type: String })
  cancelReason: string | null;

  @ApiPropertyOptional({ example: '3000.00', description: DESK })
  listPrice?: string;

  @ApiPropertyOptional({ example: '600.00', description: DESK })
  offerAmount?: string;

  @ApiPropertyOptional({
    example: '2400.00',
    description: `Selling price. ${DESK}`,
  })
  price?: string;

  @ApiPropertyOptional({ format: 'uuid', description: DESK })
  invoiceId?: string;

  @ApiPropertyOptional({
    example: '2400.00',
    description: `After any invoice discount. ${DESK}`,
  })
  invoiceTotal?: string;

  @ApiPropertyOptional({ example: '1000.00', description: DESK })
  amountPaid?: string;

  @ApiPropertyOptional({
    example: '1400.00',
    description: `Still to pay (0.00 for a cancelled invoice). ${DESK}`,
  })
  balance?: string;
}

export class PackageUsageDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: PackageUsageReason })
  reason: PackageUsageReason;

  @ApiProperty({ example: '2026-11-03T10:00:00+02:00' })
  usedAt: string;

  @ApiProperty({ type: UserRefDto })
  usedBy: UserRefDto;

  @ApiProperty({
    type: UserRefDto,
    description: "The visit's or appointment's doctor ({ id: doctor id })",
  })
  doctor: UserRefDto;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  visitId: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  appointmentId: string | null;

  @ApiProperty()
  restored: boolean;

  @ApiProperty({ nullable: true, type: String })
  restoredAt: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  restoredBy: UserRefDto | null;

  @ApiProperty({ nullable: true, type: String })
  restoreReason: string | null;
}

export class PatientPackageDetailDto extends PatientPackageDto {
  @ApiProperty({ type: [PackageUsageDto], description: 'Oldest first' })
  usages: PackageUsageDto[];
}

// The session a visit or a no-show used (day list rows, attend response).
export class PackageSessionDto {
  @ApiProperty({
    format: 'uuid',
    description: 'POST /package-usages/:id/restore',
  })
  usageId: string;

  @ApiProperty({ format: 'uuid' })
  patientPackageId: string;

  @ApiProperty({ example: '10 physio sessions' })
  name: string;

  @ApiProperty({ example: 3, description: 'Sessions used so far' })
  used: number;

  @ApiProperty({ example: 10 })
  total: number;
}
