import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
} from 'class-validator';
import { IsMoney } from '../../../common/decorators/money.decorator.js';
import { Trim } from '../../../common/decorators/transform.decorators.js';
import { DiscountType } from '../billing.enums.js';

const isRepeat = (dto: ApplyDiscountDto) =>
  dto.repeatFromDiscountId !== undefined;

/**
 * Exactly ONE of:
 *   { type, value, reason }       a new discount
 *   { repeatFromDiscountId }      repeat one of the SAME patient's discounts
 */
export class ApplyDiscountDto {
  @ApiPropertyOptional({ enum: DiscountType })
  @ValidateIf(
    (dto: ApplyDiscountDto) => !isRepeat(dto) || dto.type !== undefined,
  )
  @IsEnum(DiscountType)
  type?: DiscountType;

  @ApiPropertyOptional({
    example: '20',
    description: 'PERCENT: 0 < value <= 100. FIXED: EGP amount (<= subtotal)',
  })
  @ValidateIf(
    (dto: ApplyDiscountDto) => !isRepeat(dto) || dto.value !== undefined,
  )
  @IsMoney()
  value?: string;

  @ApiPropertyOptional({
    example: 'Regular patient',
    minLength: 3,
    maxLength: 255,
  })
  @ValidateIf(
    (dto: ApplyDiscountDto) => !isRepeat(dto) || dto.reason !== undefined,
  )
  @Trim()
  @IsString()
  @Length(3, 255)
  reason?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Copy type, value and reason from a previous discount of the same patient (amount recalculated)',
  })
  @IsOptional()
  @IsUUID()
  repeatFromDiscountId?: string;
}

export class LastDiscountDto {
  @ApiProperty({ format: 'uuid', description: 'Use as repeatFromDiscountId' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  invoiceId: string;

  @ApiProperty({ example: 'INV-2026-000120' })
  invoiceNumber: string;

  @ApiProperty({ enum: DiscountType })
  type: DiscountType;

  @ApiProperty({ example: '20.00' })
  value: string;

  @ApiProperty({
    example: '64.00',
    description: 'EGP discounted on that invoice',
  })
  amount: string;

  @ApiProperty({ example: 'Regular patient' })
  reason: string;

  @ApiProperty({ format: 'uuid' })
  appliedById: string;

  @ApiProperty({ example: '2026-11-01T10:00:00+02:00' })
  appliedAt: string;
}
