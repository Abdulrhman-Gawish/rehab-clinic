import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { IsBirthDate } from '../../../common/decorators/birth-date.decorator.js';
import { EgyptianMobile } from '../../../common/decorators/egyptian-mobile.decorator.js';
import {
  OptionalNotNull,
  Trim,
} from '../../../common/decorators/transform.decorators.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { Gender } from '../../../common/enums/gender.enum.js';
import { PersonNameField } from '../../users/dto/user-fields.js';
import { PatientSource, type Patient } from '../entities/patient.entity.js';

const PHONE_DOC = {
  example: '01012345678',
  description:
    'Egyptian mobile in any common format (01x, +20, 0020, 20, spaces, dashes, Arabic digits). Stored as +201XXXXXXXXX.',
};

const NullableOptional = () =>
  ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  );

export class CreatePatientDto {
  @PersonNameField()
  name: string;

  @ApiProperty(PHONE_DOC)
  @EgyptianMobile()
  phone: string;

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

export class ListPatientsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Part of the name, or (part of) the phone number in any format',
    example: 'ahmed',
  })
  @IsOptional()
  @Trim()
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

  @ApiProperty({ nullable: true, type: String, example: '1990-05-17' })
  dateOfBirth: string | null;

  @ApiProperty({ enum: Gender, nullable: true })
  gender: Gender | null;

  @ApiProperty({ nullable: true, type: String })
  notes: string | null;

  @ApiProperty({ enum: PatientSource })
  createdSource: PatientSource;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  createdById: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  static fromEntity(this: void, patient: Patient): PatientResponseDto {
    return {
      id: patient.id,
      name: patient.name,
      phone: patient.phone,
      dateOfBirth: patient.dateOfBirth,
      gender: patient.gender,
      notes: patient.notes,
      createdSource: patient.createdSource,
      createdById: patient.createdById,
      createdAt: patient.createdAt,
      updatedAt: patient.updatedAt,
    };
  }
}
