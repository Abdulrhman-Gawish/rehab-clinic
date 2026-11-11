import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import {
  ThrottlePublic,
  ThrottlePublicBooking,
} from '../../common/decorators/throttle.decorators.js';
import { ErrorResponseDto } from '../../common/dto/error-response.dto.js';
import { AvailabilityService } from './availability/availability.service.js';
import {
  PublicBookingDto,
  PublicBookingResponseDto,
} from './dto/appointment.dto.js';
import { PublicSlotsQueryDto, SlotDto } from './dto/availability.dto.js';
import { PublicBookingService } from './public-booking.service.js';

@ApiTags('Public')
@Controller('public/doctors')
@Public()
@ThrottlePublic()
@ApiBadRequestResponse({ type: ErrorResponseDto })
export class PublicSlotsController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get(':doctorId/slots')
  @ApiOperation({ summary: 'Free slots for the public booking page' })
  @ApiOkResponse({ type: [SlotDto] })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'SERVICE_NOT_OFFERED or DATE_OUT_OF_RANGE',
  })
  slots(
    @Param('doctorId', ParseUUIDPipe) doctorId: string,
    @Query() query: PublicSlotsQueryDto,
  ): Promise<SlotDto[]> {
    return this.availability.getSlots(doctorId, query.serviceId, query.date, {
      publicOnly: true,
    });
  }
}

// No public cancel/lookup: changes go through reception by phone.
@ApiTags('Public')
@Controller('public/appointments')
@Public()
@ThrottlePublicBooking()
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiTooManyRequestsResponse({ type: ErrorResponseDto })
export class PublicBookingController {
  constructor(private readonly booking: PublicBookingService) {}

  @Post()
  @ApiOperation({
    summary: 'Book online (PENDING until reception confirms)',
    description:
      'The response contains only the booking itself, never patient data.',
  })
  @ApiCreatedResponse({ type: PublicBookingResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'SLOT_UNAVAILABLE, PATIENT_OVERLAP or BOOKING_LIMIT_REACHED',
  })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'OUTSIDE_SCHEDULE, DATE_OUT_OF_RANGE or SERVICE_NOT_OFFERED',
  })
  book(
    @Body() dto: PublicBookingDto,
    @Ip() ip: string,
  ): Promise<PublicBookingResponseDto> {
    return this.booking.book(dto, ip);
  }
}
