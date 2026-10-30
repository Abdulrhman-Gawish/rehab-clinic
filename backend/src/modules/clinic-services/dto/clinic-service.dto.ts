import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { IsMoney } from '../../../common/decorators/money.decorator.js';
import {
  OptionalNotNull,
  ToBoolean,
  TrimAndCollapse,
  TrimOrNull,
} from '../../../common/decorators/transform.decorators.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { UserRefDto } from '../../../common/dto/user-ref.dto.js';
import type { ClinicService } from '../entities/clinic-service.entity.js';

// Who offers the service: a list of doctors, or every active doctor at this
// moment. Exactly one of the two on PUT; optional on create/PATCH.
export class ServiceDoctorsDto {
  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  doctorIds?: string[];

  @ApiPropertyOptional({
    enum: [true],
    description:
      'Every doctor active right now. Doctors added later are not included.',
  })
  @IsOptional()
  @Equals(true)
  allDoctors?: true;
}

export class CreateClinicServiceDto extends ServiceDoctorsDto {
  @ApiProperty({ example: 'Physiotherapy session', maxLength: 120 })
  @TrimAndCollapse()
  @IsString()
  @Length(2, 120)
  name: string;

  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 2000 })
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiProperty({ example: 45, minimum: 1, maximum: 1440 })
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes: number;

  @ApiProperty({ example: '350.00', description: 'Decimal string' })
  @IsMoney()
  basePrice: string;
}

export class UpdateClinicServiceDto extends ServiceDoctorsDto {
  @ApiPropertyOptional({ example: 'Physiotherapy session', maxLength: 120 })
  @OptionalNotNull()
  @TrimAndCollapse()
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 2000 })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @TrimOrNull()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ example: 45, minimum: 1, maximum: 1440 })
  @OptionalNotNull()
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes?: number;

  @ApiPropertyOptional({
    example: '400.00',
    description:
      'Changing the price never rewrites history: invoices snapshot prices.',
  })
  @OptionalNotNull()
  @IsMoney()
  basePrice?: string;
}

export class ListClinicServicesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Part of the name' })
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class ClinicServiceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Physiotherapy session' })
  name: string;

  @ApiProperty({ nullable: true, type: String })
  description: string | null;

  @ApiProperty({ example: 45 })
  durationMinutes: number;

  @ApiProperty({ example: '350.00' })
  basePrice: string;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({
    type: [UserRefDto],
    description: 'Doctors offering the service ({ id: doctor id, name })',
  })
  doctors: UserRefDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  static fromEntity(
    this: void,
    service: ClinicService,
    doctors: UserRefDto[],
  ): ClinicServiceResponseDto {
    return {
      id: service.id,
      name: service.name,
      description: service.description,
      durationMinutes: service.durationMinutes,
      basePrice: service.basePrice,
      isActive: service.isActive,
      doctors,
      createdAt: service.createdAt,
      updatedAt: service.updatedAt,
    };
  }
}

// Safe for the public website.
export class PublicClinicServiceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Physiotherapy session' })
  name: string;

  @ApiProperty({ nullable: true, type: String })
  description: string | null;

  @ApiProperty({ example: 45 })
  durationMinutes: number;

  @ApiProperty({ example: '350.00' })
  basePrice: string;

  static fromEntity(
    this: void,
    service: ClinicService,
  ): PublicClinicServiceDto {
    return {
      id: service.id,
      name: service.name,
      description: service.description,
      durationMinutes: service.durationMinutes,
      basePrice: service.basePrice,
    };
  }
}
