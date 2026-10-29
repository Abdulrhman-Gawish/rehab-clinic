import type { Type } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type as ToType } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const MAX_PAGE_SIZE = 100;

export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @ToType(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: 20 })
  @IsOptional()
  @ToType(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = 20;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

export class PaginationMetaDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 57 })
  total: number;

  @ApiProperty({ example: 3 })
  totalPages: number;
}

export interface Paginated<T> {
  items: T[];
  meta: PaginationMetaDto;
}

export function toPaginated<T>(
  items: T[],
  total: number,
  { page, limit }: Pick<PaginationQueryDto, 'page' | 'limit'>,
): Paginated<T> {
  return {
    items,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

// Swagger needs a concrete class per item type: PaginatedResponse(UserResponseDto).
export function PaginatedResponse<T>(item: Type<T>): Type<Paginated<T>> {
  class PaginatedResponseDto implements Paginated<T> {
    @ApiProperty({ type: [item] })
    items: T[];

    @ApiProperty({ type: PaginationMetaDto })
    meta: PaginationMetaDto;
  }
  Object.defineProperty(PaginatedResponseDto, 'name', {
    value: `Paginated${item.name}`,
  });
  return PaginatedResponseDto;
}
