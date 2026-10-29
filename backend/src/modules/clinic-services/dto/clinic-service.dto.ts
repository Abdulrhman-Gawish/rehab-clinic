import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
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
  Trim,
  TrimAndCollapse,
} from '../../../common/decorators/transform.decorators.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import type { ClinicService } from '../entities/clinic-service.entity.js';

export class CreateClinicServiceDto {
  @ApiProperty({ example: 'Physiotherapy session', maxLength: 120 })
  @TrimAndCollapse()
  @IsString()
  @Length(2, 120)
  name: string;

  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 2000 })
  @IsOptional()
  @Trim()
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

export class UpdateClinicServiceDto {
  @ApiPropertyOptional({ example: 'Physiotherapy session', maxLength: 120 })
  @OptionalNotNull()
  @TrimAndCollapse()
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 2000 })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @Trim()
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
  @Trim()
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

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  static fromEntity(
    this: void,
    service: ClinicService,
  ): ClinicServiceResponseDto {
    return {
      id: service.id,
      name: service.name,
      description: service.description,
      durationMinutes: service.durationMinutes,
      basePrice: service.basePrice,
      isActive: service.isActive,
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
