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
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
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
import { DoctorsService } from './doctors.service.js';
import {
  AssignServiceDto,
  CreateDoctorDto,
  DoctorResponseDto,
  ListDoctorsQueryDto,
  PublicDoctorDto,
  UpdateDoctorDto,
} from './dto/doctor.dto.js';

const READERS = [UserRole.OWNER, UserRole.RECEPTIONIST, UserRole.DOCTOR];

@ApiTags('Doctors')
@Controller('doctors')
@ApiBadRequestResponse({ type: ErrorResponseDto })
export class DoctorsController {
  constructor(private readonly doctorsService: DoctorsService) {}

  @Post()
  @Auth(UserRole.OWNER)
  @ApiOperation({
    summary: 'Create a doctor (DOCTOR login + profile in one transaction)',
  })
  @ApiCreatedResponse({ type: DoctorResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Email taken' })
  create(
    @Body() dto: CreateDoctorDto,
    @CurrentActor() actor: Actor,
  ): Promise<DoctorResponseDto> {
    return this.doctorsService.create(dto, actor);
  }

  @Get()
  @Auth(...READERS)
  @ApiOkResponse({ type: PaginatedResponse(DoctorResponseDto) })
  findAll(
    @Query() query: ListDoctorsQueryDto,
  ): Promise<Paginated<DoctorResponseDto>> {
    return this.doctorsService.findAll(query);
  }

  @Get(':id')
  @Auth(...READERS)
  @ApiOkResponse({ type: DoctorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<DoctorResponseDto> {
    return this.doctorsService.findOne(id);
  }

  @Patch(':id')
  @Auth(UserRole.OWNER)
  @ApiOperation({ summary: 'Update profile and account details' })
  @ApiOkResponse({ type: DoctorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Email taken' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDoctorDto,
    @CurrentActor() actor: Actor,
  ): Promise<DoctorResponseDto> {
    return this.doctorsService.update(id, dto, actor);
  }

  @Patch(':id/activate')
  @Auth(UserRole.OWNER)
  @ApiOperation({ summary: 'Activate the profile and the login account' })
  @ApiOkResponse({ type: DoctorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<DoctorResponseDto> {
    return this.doctorsService.setActive(id, true, actor);
  }

  @Patch(':id/deactivate')
  @Auth(UserRole.OWNER)
  @ApiOperation({
    summary: 'Deactivate the profile and the login account (signs out)',
  })
  @ApiOkResponse({ type: DoctorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<DoctorResponseDto> {
    return this.doctorsService.setActive(id, false, actor);
  }

  @Put(':id/services/:serviceId')
  @Auth(UserRole.OWNER)
  @ApiOperation({
    summary: 'Assign a service (or change its price override)',
  })
  @ApiOkResponse({ type: DoctorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Service is inactive',
  })
  assignService(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Body() dto: AssignServiceDto,
    @CurrentActor() actor: Actor,
  ): Promise<DoctorResponseDto> {
    return this.doctorsService.assignService(id, serviceId, dto, actor);
  }

  @Delete(':id/services/:serviceId')
  @Auth(UserRole.OWNER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unassign a service' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  unassignService(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @CurrentActor() actor: Actor,
  ): Promise<void> {
    return this.doctorsService.unassignService(id, serviceId, actor);
  }
}

@ApiTags('Public')
@Controller('public/doctors')
@Public()
@ThrottlePublic()
export class PublicDoctorsController {
  constructor(private readonly doctorsService: DoctorsService) {}

  @Get()
  @ApiOperation({ summary: 'Active doctors shown on the website' })
  @ApiOkResponse({ type: [PublicDoctorDto] })
  findAll(): Promise<PublicDoctorDto[]> {
    return this.doctorsService.findPublic();
  }

  @Get(':id')
  @ApiOkResponse({ type: PublicDoctorDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<PublicDoctorDto> {
    return this.doctorsService.findPublicOne(id);
  }
}
