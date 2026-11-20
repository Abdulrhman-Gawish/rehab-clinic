import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsBirthDate } from '../../../common/decorators/birth-date.decorator.js';
import { EgyptianMobile } from '../../../common/decorators/egyptian-mobile.decorator.js';
import {
  NullableOptional,
  OptionalNotNull,
  TrimOrNull,
} from '../../../common/decorators/transform.decorators.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { UserRefDto } from '../../../common/dto/user-ref.dto.js';
import { Gender } from '../../../common/enums/gender.enum.js';
import { AcquisitionChannel } from '../../acquisition/acquisition.enums.js';
import { AssignReferralDto } from '../../referrals/dto/referrals.dto.js';
import { PersonNameField } from '../../users/dto/user.dto.js';
import { PatientSource, type Patient } from '../entities/patient.entity.js';
import {
  normalizeNationalId,
  normalizePassport,
  PASSPORT_PATTERN,
} from '../patient-identity.js';

const PHONE_DOC = {
  example: '01012345678',
  description:
    'Egyptian mobile in any common format (01x, +20, 0020, 20, spaces, dashes, Arabic digits). Stored as +201XXXXXXXXX.',
};

// Identity document: an Egyptian National ID, or a passport number for a
// non-Egyptian (never both). A blank value clears it (null).
const NationalIdField = () =>
  applyDecorators(
    ApiPropertyOptional({
      nullable: true,
      type: String,
      example: '29001010112348',
      description:
        'Egyptian National ID, 14 digits (Arabic digits, spaces and dashes accepted). Its birth date and gender must match dateOfBirth and gender (filled from it when empty). Not with passportNumber. Once the patient has a code, only the OWNER can change it.',
    }),
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? normalizeNationalId(value) || null : value,
    ),
    NullableOptional(),
    Matches(/^\d{14}$/, { message: 'nationalId must be 14 digits' }),
  );

const PassportField = () =>
  applyDecorators(
    ApiPropertyOptional({
      nullable: true,
      type: String,
      example: 'A12345678',
      description:
        'Passport number of a non-Egyptian (5-20 letters and digits; stored upper case). Not with nationalId.',
    }),
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? normalizePassport(value) || null : value,
    ),
    NullableOptional(),
    Matches(PASSPORT_PATTERN, {
      message: 'passportNumber must be 5 to 20 letters and digits',
    }),
  );

export class CreatePatientDto {
  @PersonNameField()
  name: string;

  @ApiProperty(PHONE_DOC)
  @EgyptianMobile()
  phone: string;

  @NationalIdField()
  nationalId?: string | null;

  @PassportField()
  passportNumber?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, example: '1990-05-17' })
  @IsOptional()
  @IsBirthDate()
  dateOfBirth?: string | null;

  @ApiPropertyOptional({ enum: Gender, nullable: true })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    maxLength: 2000,
    description: 'Administrative notes only, never medical information',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

// PATCH: name/phone may be omitted but not nulled; the rest can be cleared.
export class UpdatePatientDto {
  @PersonNameField({ required: false })
  name?: string;

  @ApiPropertyOptional(PHONE_DOC)
  @OptionalNotNull()
  @EgyptianMobile()
  phone?: string;

  @NationalIdField()
  nationalId?: string | null;

  @PassportField()
  passportNumber?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, example: '1990-05-17' })
  @NullableOptional()
  @IsBirthDate()
  dateOfBirth?: string | null;

  @ApiPropertyOptional({ enum: Gender, nullable: true })
  @NullableOptional()
  @IsEnum(Gender)
  gender?: Gender | null;

  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 2000 })
  @NullableOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

// A doctor referral is recorded with its referring doctor and terms
// (POST /patients/:id/referrals), never as a plain channel at the desk.
const DESK_CHANNELS = Object.values(AcquisitionChannel).filter(
  (c) => c !== AcquisitionChannel.DOCTOR_REFERRAL,
);

export class ReferralSourceInputDto {
  @ApiProperty({
    enum: DESK_CHANNELS,
    description:
      'Not DOCTOR_REFERRAL: a doctor referral is recorded with its referring doctor (POST /patients/:id/referrals)',
  })
  @IsIn(DESK_CHANNELS, {
    message:
      'channel must be one of the desk channels (a doctor referral is recorded with its referring doctor)',
  })
  channel: AcquisitionChannel;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    maxLength: 255,
    example: 'Instagram ad',
  })
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(255)
  details?: string | null;
}

/**
 * What reception collects before the patient enters the doctor (sent with
 * attend or walk-in). Each field given is saved on the patient; the
 * referral source is added to the patient's acquisition sources (primary
 * when the patient had none); a doctor referral is recorded with its
 * referring doctor and terms (`referral`).
 */
export class CheckInDetailsDto {
  @NationalIdField()
  nationalId?: string | null;

  @PassportField()
  passportNumber?: string | null;

  @ApiPropertyOptional({ enum: Gender, nullable: true })
  @NullableOptional()
  @IsEnum(Gender)
  gender?: Gender | null;

  @ApiPropertyOptional({ nullable: true, type: String, example: '1990-05-17' })
  @NullableOptional()
  @IsBirthDate()
  dateOfBirth?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    maxLength: 2000,
    description: 'Administrative notes only, never medical information',
  })
  @NullableOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({ type: ReferralSourceInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ReferralSourceInputDto)
  referralSource?: ReferralSourceInputDto;

  @ApiPropertyOptional({
    type: AssignReferralDto,
    description:
      'Referred by a doctor: the body of POST /patients/:id/referrals (same rules). Recorded before the visit, so its invoice is covered; it adds the DOCTOR_REFERRAL source.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AssignReferralDto)
  referral?: AssignReferralDto;
}

export class ListPatientsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Part of the name, (part of) the phone number in any format, a patient code (RH...), a National ID or a passport number',
    example: 'ahmed',
  })
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  search?: string;
}

export class LookupPatientQueryDto {
  @ApiProperty(PHONE_DOC)
  @EgyptianMobile()
  phone: string;
}

export class PatientResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Ahmed Hassan' })
  name: string;

  @ApiProperty({ example: '+201012345678' })
  phone: string;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'RH29000001',
    description: 'Clinic code; null until the identity document is recorded',
  })
  patientCode: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '29001010112348',
    description: 'null for a DOCTOR (not needed for care)',
  })
  nationalId: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'null for a DOCTOR',
  })
  passportNumber: string | null;

  @ApiProperty({ nullable: true, type: String, example: '1990-05-17' })
  dateOfBirth: string | null;

  @ApiProperty({ enum: Gender, nullable: true })
  gender: Gender | null;

  @ApiProperty({ nullable: true, type: String })
  notes: string | null;

  @ApiProperty({ enum: PatientSource })
  createdSource: PatientSource;

  @ApiProperty({
    type: UserRefDto,
    nullable: true,
    description: 'null for online bookings',
  })
  createdBy: UserRefDto | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  static fromEntity(this: void, patient: Patient): PatientResponseDto {
    return {
      id: patient.id,
      name: patient.name,
      phone: patient.phone,
      patientCode: patient.patientCode,
      nationalId: patient.nationalId,
      passportNumber: patient.passportNumber,
      dateOfBirth: patient.dateOfBirth,
      gender: patient.gender,
      notes: patient.notes,
      createdSource: patient.createdSource,
      createdBy: UserRefDto.fromNullable(patient.createdBy),
      createdAt: patient.createdAt,
      updatedAt: patient.updatedAt,
    };
  }
}

// An unknown phone is the normal case at the desk, not an error.
export class PatientLookupDto {
  @ApiProperty({
    type: PatientResponseDto,
    nullable: true,
    description: 'null when no patient has this phone number',
  })
  patient: PatientResponseDto | null;
}
