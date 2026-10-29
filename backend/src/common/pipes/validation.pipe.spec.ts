import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsString, ValidateNested } from 'class-validator';
import { createValidationPipe } from './validation.pipe.js';

class ItemDto {
  @IsInt()
  quantity: number;
}

class OrderDto {
  @IsString()
  name: string;

  @ValidateNested({ each: true })
  @Type(() => ItemDto)
  items: ItemDto[];
}

describe('createValidationPipe', () => {
  const pipe = createValidationPipe();
  const metadata = { type: 'body' as const, metatype: OrderDto };

  it('reports flattened field errors with nested paths', async () => {
    const error = await pipe
      .transform({ name: 5, items: [{ quantity: 'x' }] }, metadata)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toEqual({
      message: 'Validation failed',
      details: [
        { field: 'name', errors: ['name must be a string'] },
        {
          field: 'items.0.quantity',
          errors: ['quantity must be an integer number'],
        },
      ],
    });
  });

  it('rejects unknown properties', async () => {
    const error = await pipe
      .transform({ name: 'a', items: [], isAdmin: true }, metadata)
      .catch((e: unknown) => e);

    expect((error as BadRequestException).getResponse()).toMatchObject({
      details: [
        { field: 'isAdmin', errors: ['property isAdmin should not exist'] },
      ],
    });
  });
});
