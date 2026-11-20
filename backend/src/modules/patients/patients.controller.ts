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
  PatientLookupDto,
  PatientResponseDto,
  UpdatePatientDto,
} from './dto/patient.dto.js';
import { PatientsService } from './patients.service.js';

const READERS = [UserRole.OWNER, UserRole.RECEPTIONIST, UserRole.DOCTOR];
const WRITERS = [UserRole.OWNER, UserRole.RECEPTIONIST];

// A doctor reads patients without their identity document (not needed for
// care); the patient code stays visible to everyone.
function forReader(
  patient: PatientResponseDto,
  actor: Actor,
): PatientResponseDto {
  return actor.role === UserRole.DOCTOR
    ? { ...patient, nationalId: null, passportNumber: null }
    : patient;
}

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
  @ApiOperation({
    summary:
      'Search patients by name, phone or code (OWNER, RECEPTIONIST: also National ID, passport)',
  })
  @ApiOkResponse({ type: PaginatedResponse(PatientResponseDto) })
  async findAll(
    @Query() query: ListPatientsQueryDto,
    @CurrentActor() actor: Actor,
  ): Promise<Paginated<PatientResponseDto>> {
    const page = await this.patientsService.findAll(
      query,
      actor.role !== UserRole.DOCTOR,
    );
    return { ...page, items: page.items.map((p) => forReader(p, actor)) };
  }

  @Get('lookup')
  @Auth(...READERS)
  @ApiOperation({
    summary: 'Find the patient owning an exact phone number',
    description: '`{ patient: null }` when the phone is unknown.',
  })
  @ApiOkResponse({ type: PatientLookupDto })
  async lookup(
    @Query() query: LookupPatientQueryDto,
    @CurrentActor() actor: Actor,
  ): Promise<PatientLookupDto> {
    const { patient } = await this.patientsService.findByPhone(query.phone);
    return { patient: patient && forReader(patient, actor) };
  }

  @Get(':id')
  @Auth(...READERS)
  @ApiOkResponse({ type: PatientResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<PatientResponseDto> {
    return forReader(await this.patientsService.findOne(id), actor);
  }

  @Patch(':id')
  @Auth(...WRITERS)
  @ApiOperation({
    summary: 'Update a patient',
    description:
      'Changing the phone, National ID or passport respects uniqueness (409). The first identity document gives the patient its code (RH...); once it has one, only the OWNER can change the document (403 PATIENT_IDENTITY_LOCKED). A National ID must be valid (422 NATIONAL_ID_INVALID) and match the birth date and gender (422 NATIONAL_ID_MISMATCH; they are filled from it when empty). Old and new values are audited.',
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
