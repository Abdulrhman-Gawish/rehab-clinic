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
import {
  CurrentActor,
  CurrentUser,
} from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { ThrottlePublic } from '../../common/decorators/throttle.decorators.js';
import { ErrorResponseDto } from '../../common/dto/error-response.dto.js';
import {
  PaginatedResponse,
  type Paginated,
} from '../../common/dto/pagination.dto.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import type {
  Actor,
  AuthenticatedUser,
} from '../../common/interfaces/authenticated-request.interface.js';
import {
  CreatePackageDto,
  ListPackagesQueryDto,
  PackageReasonDto,
  PackageResponseDto,
  PatientPackageDetailDto,
  PatientPackageDto,
  PublicPackageDto,
  SellPackageDto,
  UpdatePackageDto,
} from './dto/package.dto.js';
import { PackagesService } from './packages.service.js';
import { PatientPackagesService } from './patient-packages.service.js';

const { OWNER, RECEPTIONIST, DOCTOR } = UserRole;
const DESK = [OWNER, RECEPTIONIST];

@ApiTags('Packages')
@Controller('packages')
@ApiBadRequestResponse({ type: ErrorResponseDto })
export class PackagesController {
  constructor(private readonly packages: PackagesService) {}

  @Post()
  @Auth(OWNER)
  @ApiOperation({
    summary: 'Create a package: N sessions of one service for a total price',
    description:
      'doctorIds (each must offer the service) or allDoctors: true. Optional offer (PERCENT or FIXED, optional local start/end dates).',
  })
  @ApiCreatedResponse({ type: PackageResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'SERVICE_NOT_OFFERED, OFFER_EXCEEDS_PRICE',
  })
  create(
    @Body() dto: CreatePackageDto,
    @CurrentActor() actor: Actor,
  ): Promise<PackageResponseDto> {
    return this.packages.create(dto, actor);
  }

  @Get()
  @Auth(...DESK)
  @ApiOperation({
    summary: "The catalog with today's selling price",
  })
  @ApiOkResponse({ type: PaginatedResponse(PackageResponseDto) })
  findAll(
    @Query() query: ListPackagesQueryDto,
  ): Promise<Paginated<PackageResponseDto>> {
    return this.packages.findAll(query);
  }

  @Get(':id')
  @Auth(...DESK)
  @ApiOkResponse({ type: PackageResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<PackageResponseDto> {
    return this.packages.findOne(id);
  }

  @Patch(':id')
  @Auth(OWNER)
  @ApiOperation({
    summary: 'Edit a package (offer: null removes the offer)',
    description:
      'Sold packages keep their name, service, sessions and prices, but follow the current doctor list.',
  })
  @ApiOkResponse({ type: PackageResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'SERVICE_NOT_OFFERED, OFFER_EXCEEDS_PRICE',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePackageDto,
    @CurrentActor() actor: Actor,
  ): Promise<PackageResponseDto> {
    return this.packages.update(id, dto, actor);
  }

  @Delete(':id')
  @Auth(OWNER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete for good (deactivate stops sales only for a while)',
    description:
      'Gone from every list and never sold again; patients who bought it keep their sessions.',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<void> {
    return this.packages.remove(id, actor);
  }

  @Patch(':id/activate')
  @Auth(OWNER)
  @ApiOkResponse({ type: PackageResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<PackageResponseDto> {
    return this.packages.setActive(id, true, actor);
  }

  @Patch(':id/deactivate')
  @Auth(OWNER)
  @ApiOperation({
    summary: 'Stop selling (sold packages stay usable)',
  })
  @ApiOkResponse({ type: PackageResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<PackageResponseDto> {
    return this.packages.setActive(id, false, actor);
  }
}

@ApiTags('Public')
@Controller('public/packages')
@Public()
@ThrottlePublic()
export class PublicPackagesController {
  constructor(private readonly packages: PackagesService) {}

  @Get()
  @ApiOperation({ summary: 'Active, public packages for the website' })
  @ApiOkResponse({ type: [PublicPackageDto] })
  findAll(): Promise<PublicPackageDto[]> {
    return this.packages.findPublic();
  }
}

@ApiTags('Packages')
@Controller()
@ApiBadRequestResponse({ type: ErrorResponseDto })
export class PatientPackagesController {
  constructor(private readonly patientPackages: PatientPackagesService) {}

  @Post('patients/:patientId/packages')
  @Auth(...DESK)
  @ApiOperation({
    summary: 'Sell a package to a patient',
    description:
      "Creates the patient package and its invoice (today's selling price, no visit) in one transaction. Payments and discounts then go through the normal invoice endpoints; sessions are usable before it is paid.",
  })
  @ApiCreatedResponse({ type: PatientPackageDetailDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'PACKAGE_INACTIVE',
  })
  sell(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() dto: SellPackageDto,
    @CurrentActor() actor: Actor,
  ): Promise<PatientPackageDetailDto> {
    return this.patientPackages.sell(patientId, dto, actor);
  }

  @Get('patients/:patientId/packages')
  @Auth(OWNER, RECEPTIONIST, DOCTOR)
  @ApiOperation({
    summary: "A patient's packages, newest first",
    description:
      'A DOCTOR (who treats the patient, else 404) gets sessions without prices.',
  })
  @ApiOkResponse({ type: [PatientPackageDto] })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  forPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PatientPackageDto[]> {
    return this.patientPackages.forPatient(patientId, user);
  }

  @Get('patient-packages/:id')
  @Auth(OWNER, RECEPTIONIST, DOCTOR)
  @ApiOperation({
    summary: 'A sold package with its sessions (usages)',
    description: 'A DOCTOR gets no prices.',
  })
  @ApiOkResponse({ type: PatientPackageDetailDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PatientPackageDetailDto> {
    return this.patientPackages.findOne(id, user);
  }

  @Post('patient-packages/:id/cancel')
  @Auth(OWNER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a sold package (remaining sessions become unusable)',
    description:
      'The invoice is untouched: refund money, if at all, with POST /payments/:id/refund.',
  })
  @ApiOkResponse({ type: PatientPackageDetailDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'PACKAGE_CANCELLED',
  })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PackageReasonDto,
    @CurrentActor() actor: Actor,
  ): Promise<PatientPackageDetailDto> {
    return this.patientPackages.cancel(id, dto.reason, actor);
  }

  @Post('package-usages/:id/restore')
  @Auth(...DESK)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Give back a session used by a no-show',
    description:
      'Only NO_SHOW usages. An attended session comes back by undoing the attendance.',
  })
  @ApiOkResponse({ type: PatientPackageDetailDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'RESTORE_NOT_ALLOWED',
  })
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PackageReasonDto,
    @CurrentActor() actor: Actor,
  ): Promise<PatientPackageDetailDto> {
    return this.patientPackages.restoreUsage(id, dto.reason, actor);
  }
}
