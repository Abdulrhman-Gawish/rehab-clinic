import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Shape of every error response (see AllExceptionsFilter).
export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({ example: 'Bad Request' })
  error: string;

  @ApiPropertyOptional({
    description: 'Stable machine-readable code for business errors',
    example: 'SLOT_UNAVAILABLE',
  })
  code?: string;

  @ApiProperty({ example: 'Validation failed' })
  message: string;

  @ApiPropertyOptional({
    description: 'Extra machine readable information, e.g. field errors',
    example: [{ field: 'phone', errors: ['phone must be a valid mobile'] }],
  })
  details?: unknown;

  @ApiProperty({ example: '/api/v1/patients' })
  path: string;

  @ApiProperty({ example: '2026-01-01T10:00:00.000Z' })
  timestamp: string;
}
