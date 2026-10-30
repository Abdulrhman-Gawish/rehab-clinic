import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MaxLength,
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
import {
  EmailField,
  OptionalStaffPhoneField,
  PasswordField,
  PersonNameField,
} from '../../users/dto/user.dto.js';
import type { DoctorClinicService } from '../entities/doctor-clinic-service.entity.js';
import type { Doctor } from '../entities/doctor.entity.js';

const NullableOptional = () =>
  ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  );

const PHOTO_URL_OPTIONS = {
  protocols: ['https'],
  require_protocol: true,
};

export class CreateDoctorDto {
  @PersonNameField()
  name: string;

  @EmailField()
  email: string;

  @OptionalStaffPhoneField()
  phone?: string | null;

  @PasswordField()
  password: string;

  @ApiProperty({ example: 'Sports physiotherapy', maxLength: 120 })
  @TrimAndCollapse()
  @IsString()
  @Length(2, 120)
  specialty: string;

  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 4000 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(4000)
  bio?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: 'https://cdn.clinic.com/doctors/mona.jpg',
  })
  @IsOptional()
  @IsUrl(PHOTO_URL_OPTIONS)
  @MaxLength(500)
  photoUrl?: string | null;

  @ApiPropertyOptional({ default: true, description: 'Show on the website' })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

export class UpdateDoctorDto {
  @PersonNameField({ required: false })
  name?: string;

  @EmailField({ required: false })
  email?: string;

  @OptionalStaffPhoneField()
  phone?: string | null;

  @ApiPropertyOptional({ example: 'Sports physiotherapy', maxLength: 120 })
  @OptionalNotNull()
  @TrimAndCollapse()
  @IsString()
  @Length(2, 120)
  specialty?: string;

  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 4000 })
  @NullableOptional()
  @Trim()
  @IsString()
  @MaxLength(4000)
  bio?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @NullableOptional()
  @IsUrl(PHOTO_URL_OPTIONS)
  @MaxLength(500)
  photoUrl?: string | null;

  @ApiPropertyOptional()
  @OptionalNotNull()
  @IsBoolean()
  isPublic?: boolean;
}

export class AssignServiceDto {
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: '400.00',
    description: 'Doctor specific price; null/omitted = service base price',
  })
  @NullableOptional()
  @IsMoney()
  priceOverride?: string | null;
}

export class ListDoctorsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional({ description: 'Part of the name or specialty' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class DoctorServiceResponseDto {
  @ApiProperty({ format: 'uuid' })
  serviceId: string;

  @ApiProperty({ example: 'Physiotherapy session' })
  name: string;

  @ApiProperty({ example: 45 })
  durationMinutes: number;

  @ApiProperty({ example: '350.00' })
  basePrice: string;

  @ApiProperty({ nullable: true, type: String, example: '400.00' })
  priceOverride: string | null;

  @ApiProperty({ example: '400.00', description: 'priceOverride ?? basePrice' })
  price: string;

  @ApiProperty({ description: 'Whether the service itself is active' })
  isActive: boolean;

  static fromEntity(
    this: void,
    assignment: DoctorClinicService,
  ): DoctorServiceResponseDto {
    const service = assignment.service!;
    return {
      serviceId: assignment.serviceId,
      name: service.name,
      durationMinutes: service.durationMinutes,
      basePrice: service.basePrice,
      priceOverride: assignment.priceOverride,
      price: assignment.priceOverride ?? service.basePrice,
      isActive: service.isActive,
    };
  }
}

export class DoctorResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({ example: 'Dr. Mona Adel' })
  name: string;

  @ApiProperty({ example: 'mona@clinic.com' })
  email: string;

  @ApiProperty({ nullable: true, type: String })
  phone: string | null;

  @ApiProperty({ example: 'Sports physiotherapy' })
  specialty: string;

  @ApiProperty({ nullable: true, type: String })
  bio: string | null;

  @ApiProperty({ nullable: true, type: String })
  photoUrl: string | null;

  @ApiProperty()
  isPublic: boolean;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ type: [DoctorServiceResponseDto] })
  services: DoctorServiceResponseDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  static fromEntity(this: void, doctor: Doctor): DoctorResponseDto {
    return {
      id: doctor.id,
      userId: doctor.userId,
      name: doctor.user.name,
      email: doctor.user.email,
      phone: doctor.user.phone,
      specialty: doctor.specialty,
      bio: doctor.bio,
      photoUrl: doctor.photoUrl,
      isPublic: doctor.isPublic,
      isActive: doctor.isActive,
      services: (doctor.services ?? [])
        .filter((assignment) => assignment.service)
        .map(DoctorServiceResponseDto.fromEntity)
        .sort((a, b) => a.name.localeCompare(b.name)),
      createdAt: doctor.createdAt,
      updatedAt: doctor.updatedAt,
    };
  }
}

// --- Public website DTOs: no email, phone, user id or internal flags. ---

export class PublicDoctorServiceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Physiotherapy session' })
  name: string;

  @ApiProperty({ nullable: true, type: String })
  description: string | null;

  @ApiProperty({ example: 45 })
  durationMinutes: number;

  @ApiProperty({ example: '400.00' })
  price: string;
}

export class PublicDoctorDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Dr. Mona Adel' })
  name: string;

  @ApiProperty({ example: 'Sports physiotherapy' })
  specialty: string;

  @ApiProperty({ nullable: true, type: String })
  bio: string | null;

  @ApiProperty({ nullable: true, type: String })
  photoUrl: string | null;

  @ApiProperty({ type: [PublicDoctorServiceDto] })
  services: PublicDoctorServiceDto[];

  static fromEntity(this: void, doctor: Doctor): PublicDoctorDto {
    return {
      id: doctor.id,
      name: doctor.user.name,
      specialty: doctor.specialty,
      bio: doctor.bio,
      photoUrl: doctor.photoUrl,
      services: (doctor.services ?? [])
        .filter((assignment) => assignment.service?.isActive)
        .map((assignment) => {
          const service = assignment.service!;
          return {
            id: service.id,
            name: service.name,
            description: service.description,
            durationMinutes: service.durationMinutes,
            price: assignment.priceOverride ?? service.basePrice,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
}
