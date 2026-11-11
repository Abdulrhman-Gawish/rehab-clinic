import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Auth } from '../../common/decorators/api-auth.decorator.js';
import { CurrentActor } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { ThrottlePublic } from '../../common/decorators/throttle.decorators.js';
import { ErrorResponseDto } from '../../common/dto/error-response.dto.js';
import {
  PaginatedResponse,
  type Paginated,
} from '../../common/dto/pagination.dto.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { ClinicServicesService } from './clinic-services.service.js';
import {
  ClinicServiceResponseDto,
  CreateClinicServiceDto,
  ListClinicServicesQueryDto,
  PublicClinicServiceDto,
  ServiceDoctorsDto,
  UpdateClinicServiceDto,
} from './dto/clinic-service.dto.js';

const READERS = [UserRole.OWNER, UserRole.RECEPTIONIST, UserRole.DOCTOR];

@ApiTags('Clinic services')
@Controller('clinic-services')
@ApiBadRequestResponse({ type: ErrorResponseDto })
export class ClinicServicesController {
  constructor(private readonly clinicServices: ClinicServicesService) {}

  @Post()
  @Auth(UserRole.OWNER)
  @ApiCreatedResponse({ type: ClinicServiceResponseDto })
  create(
    @Body() dto: CreateClinicServiceDto,
    @CurrentActor() actor: Actor,
  ): Promise<ClinicServiceResponseDto> {
    return this.clinicServices.create(dto, actor);
  }

  @Get()
  @Auth(...READERS)
  @ApiOkResponse({ type: PaginatedResponse(ClinicServiceResponseDto) })
  findAll(
    @Query() query: ListClinicServicesQueryDto,
  ): Promise<Paginated<ClinicServiceResponseDto>> {
    return this.clinicServices.findAll(query);
  }

  @Get(':id')
  @Auth(...READERS)
  @ApiOkResponse({ type: ClinicServiceResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ClinicServiceResponseDto> {
    return this.clinicServices.findOne(id);
  }

  @Patch(':id')
  @Auth(UserRole.OWNER)
  @ApiOkResponse({ type: ClinicServiceResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClinicServiceDto,
    @CurrentActor() actor: Actor,
  ): Promise<ClinicServiceResponseDto> {
    return this.clinicServices.update(id, dto, actor);
  }

  @Put(':id/doctors')
  @Auth(UserRole.OWNER)
  @ApiOperation({
    summary: 'Replace the doctors offering the service',
    description:
      'doctorIds, or allDoctors: true (every doctor active now). Doctors that stay keep their price override.',
  })
  @ApiOkResponse({ type: ClinicServiceResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  setDoctors(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ServiceDoctorsDto,
    @CurrentActor() actor: Actor,
  ): Promise<ClinicServiceResponseDto> {
    return this.clinicServices.setDoctors(id, dto, actor);
  }

  @Delete(':id')
  @Auth(UserRole.OWNER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete for good (deactivate hides it only for a while)',
    description:
      'The row stays for history (visits, invoices), but it is gone from every list and can never be activated again. Its doctor assignments are removed. 422 SERVICE_HAS_PACKAGES while packages of it exist.',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'SERVICE_HAS_PACKAGES',
  })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<void> {
    return this.clinicServices.remove(id, actor);
  }

  @Patch(':id/activate')
  @Auth(UserRole.OWNER)
  @ApiOkResponse({ type: ClinicServiceResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<ClinicServiceResponseDto> {
    return this.clinicServices.setActive(id, true, actor);
  }

  @Patch(':id/deactivate')
  @Auth(UserRole.OWNER)
  @ApiOperation({ summary: 'Deactivate (services are never hard deleted)' })
  @ApiOkResponse({ type: ClinicServiceResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<ClinicServiceResponseDto> {
    return this.clinicServices.setActive(id, false, actor);
  }
}

@ApiTags('Public')
@Controller('public/services')
@Public()
@ThrottlePublic()
export class PublicClinicServicesController {
  constructor(private readonly clinicServices: ClinicServicesService) {}

  @Get()
  @ApiOperation({ summary: 'Active services for the public website' })
  @ApiOkResponse({ type: [PublicClinicServiceDto] })
  findAll(): Promise<PublicClinicServiceDto[]> {
    return this.clinicServices.findPublic();
  }
}
