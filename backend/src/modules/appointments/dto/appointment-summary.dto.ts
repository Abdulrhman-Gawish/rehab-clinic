import { ApiProperty } from '@nestjs/swagger';

// Compact appointment row, e.g. for time-off conflict warnings.
export class AppointmentSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'APT-7K3Q9X' })
  referenceCode: string;

  @ApiProperty({ example: '2026-11-10T10:00:00+02:00' })
  startAt: string;

  @ApiProperty({ example: '2026-11-10T10:45:00+02:00' })
  endAt: string;

  @ApiProperty({ example: 'CONFIRMED' })
  status: string;

  @ApiProperty({ example: 'Ahmed Hassan' })
  patientName: string;
}
