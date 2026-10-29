import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
} from '@nestjs/swagger';
import { Auth } from '../../common/decorators/api-auth.decorator.js';
import { CurrentActor } from '../../common/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../../common/dto/error-response.dto.js';
import {
  PaginatedResponse,
  type Paginated,
} from '../../common/dto/pagination.dto.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import {
  CreatePatientDto,
  ListPatientsQueryDto,
  LookupPatientQueryDto,
  PatientResponseDto,
  UpdatePatientDto,
} from './dto/patient.dto.js';
import { PatientsService } from './patients.service.js';

const READERS = [UserRole.OWNER, UserRole.RECEPTIONIST, UserRole.DOCTOR];
const WRITERS = [UserRole.OWNER, UserRole.RECEPTIONIST];

// Staff only. There is deliberately no public patient endpoint.
@ApiTags('Patients')
@Controller('patients')
@ApiBadRequestResponse({ type: ErrorResponseDto })
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Post()
  @Auth(...WRITERS)
  @ApiOperation({ summary: 'Register a patient at reception' })
  @ApiCreatedResponse({ type: PatientResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'Phone already registered; details.patientId is the existing patient',
  })
  create(
    @Body() dto: CreatePatientDto,
    @CurrentActor() actor: Actor,
  ): Promise<PatientResponseDto> {
    return this.patientsService.create(dto, actor);
  }

  @Get()
  @Auth(...READERS)
  @ApiOperation({ summary: 'Search patients by name or phone' })
  @ApiOkResponse({ type: PaginatedResponse(PatientResponseDto) })
  findAll(
    @Query() query: ListPatientsQueryDto,
  ): Promise<Paginated<PatientResponseDto>> {
    return this.patientsService.findAll(query);
  }

  @Get('lookup')
  @Auth(...READERS)
  @ApiOperation({ summary: 'Find the patient owning an exact phone number' })
  @ApiOkResponse({ type: PatientResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  lookup(@Query() query: LookupPatientQueryDto): Promise<PatientResponseDto> {
    return this.patientsService.findByPhone(query.phone);
  }

  @Get(':id')
  @Auth(...READERS)
  @ApiOkResponse({ type: PatientResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<PatientResponseDto> {
    return this.patientsService.findOne(id);
  }

  @Patch(':id')
  @Auth(...WRITERS)
  @ApiOperation({
    summary: 'Update a patient',
    description:
      'Changing the phone respects uniqueness (409). Old and new values are audited.',
  })
  @ApiOkResponse({ type: PatientResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePatientDto,
    @CurrentActor() actor: Actor,
  ): Promise<PatientResponseDto> {
    return this.patientsService.update(id, dto, actor);
  }
}
