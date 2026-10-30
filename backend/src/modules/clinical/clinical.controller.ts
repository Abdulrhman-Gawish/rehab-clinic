import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiProduces,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { Auth } from '../../common/decorators/api-auth.decorator.js';
import {
  CurrentActor,
  CurrentUser,
} from '../../common/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../../common/dto/error-response.dto.js';
import {
  PaginatedResponse,
  PaginationQueryDto,
  type Paginated,
} from '../../common/dto/pagination.dto.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import { orJsonNull } from '../../common/utils/json-null.util.js';
import type {
  Actor,
  AuthenticatedUser,
} from '../../common/interfaces/authenticated-request.interface.js';
import {
  MAX_UPLOAD_BYTES,
  type UploadedFileData,
} from '../../common/storage/file-type.util.js';
import { ClinicalNotesService } from './clinical-notes.service.js';
import {
  AddendumInputDto,
  AttachmentResponseDto,
  AttachmentUploadDto,
  ClinicalHistoryDto,
  ClinicalNoteInputDto,
  ClinicalNoteResponseDto,
  MedicalInfoDto,
  MedicalInfoResponseDto,
  NeedsAttentionEntryDto,
  NeedsAttentionQueryDto,
} from './dto/clinical.dto.js';
import { MedicalInfoService } from './medical-info.service.js';
import { PatientAttachmentsService } from './patient-attachments.service.js';

// Clinical data: RECEPTIONIST never (403). OWNER reads everything (and may
// upload attachments). A DOCTOR reads patients they have an appointment or
// visit with (otherwise 404) and writes notes only on their own visits.
const READERS = [UserRole.OWNER, UserRole.DOCTOR];

@ApiTags('Clinical records')
@Controller('patients/:id')
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({
  type: ErrorResponseDto,
  description: 'Unknown patient, or a doctor without a relationship to them',
})
export class PatientClinicalController {
  constructor(
    private readonly medicalInfo: MedicalInfoService,
    private readonly notes: ClinicalNotesService,
    private readonly attachments: PatientAttachmentsService,
  ) {}

  @Get('medical-info')
  @Auth(...READERS)
  @ApiOperation({ summary: 'Allergies, conditions, surgeries, medications' })
  @ApiOkResponse({ type: MedicalInfoResponseDto })
  getMedicalInfo(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MedicalInfoResponseDto> {
    return this.medicalInfo.get(id, user);
  }

  @Put('medical-info')
  @Auth(UserRole.DOCTOR)
  @ApiOperation({
    summary: 'Replace the medical info (fields left out become null)',
    description: 'Any doctor with access to the patient. Audited.',
  })
  @ApiOkResponse({ type: MedicalInfoResponseDto })
  replaceMedicalInfo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MedicalInfoDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentActor() actor: Actor,
  ): Promise<MedicalInfoResponseDto> {
    return this.medicalInfo.replace(id, dto, user, actor);
  }

  @Get('clinical-history')
  @Auth(...READERS)
  @ApiOperation({
    summary:
      'Medical info + signed notes of every doctor (newest first) + attachments',
  })
  @ApiOkResponse({ type: ClinicalHistoryDto })
  history(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ClinicalHistoryDto> {
    return this.notes.history(id, query, user);
  }

  @Post('attachments')
  @Auth(...READERS)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  @ApiOperation({
    summary:
      'Upload an X-ray, report or lab result (JPG, PNG, WEBP, PDF; 5 MB)',
    description: 'The type is checked from the file content (magic bytes).',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'title'],
      properties: {
        file: { type: 'string', format: 'binary' },
        title: { type: 'string', maxLength: 200 },
        visitId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiCreatedResponse({ type: AttachmentResponseDto })
  @ApiPayloadTooLargeResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'UNSUPPORTED_FILE_TYPE or ATTACHMENT_VISIT_MISMATCH',
  })
  upload(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AttachmentUploadDto,
    @UploadedFile() file: UploadedFileData | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentActor() actor: Actor,
  ): Promise<AttachmentResponseDto> {
    return this.attachments.upload(id, dto, file, user, actor);
  }

  @Get('attachments')
  @Auth(...READERS)
  @ApiOperation({ summary: "The patient's attachments, newest first" })
  @ApiOkResponse({ type: [AttachmentResponseDto] })
  listAttachments(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AttachmentResponseDto[]> {
    return this.attachments.list(id, user);
  }
}

@ApiTags('Clinical records')
@Controller('visits/:id/note')
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({
  type: ErrorResponseDto,
  description:
    "Unknown visit, a visit the doctor can't access, or someone else's draft (NOTE_NOT_VISIBLE)",
})
export class VisitNoteController {
  constructor(private readonly notes: ClinicalNotesService) {}

  @Get()
  @Auth(...READERS)
  @ApiOperation({
    summary: "The visit's note, or null when it has none yet",
    description:
      "Drafts are visible only to their author: another doctor's draft is 404 NOTE_NOT_VISIBLE.",
  })
  @ApiOkResponse({ type: ClinicalNoteResponseDto, description: 'or null' })
  async find(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ClinicalNoteResponseDto | null> {
    return orJsonNull(await this.notes.findForVisit(id, user));
  }

  @Put()
  @Auth(UserRole.DOCTOR)
  @ApiOperation({
    summary: 'Save the DRAFT: created on the first save, replaced after',
    description:
      "The visit's doctor; ACTIVE visits, any day after. A field left out (or blank) becomes null.",
  })
  @ApiOkResponse({ type: ClinicalNoteResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'NOTE_NOT_ALLOWED or NOTE_SIGNED',
  })
  save(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClinicalNoteInputDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentActor() actor: Actor,
  ): Promise<ClinicalNoteResponseDto> {
    return this.notes.saveDraft(id, dto, user, actor);
  }

  @Post('sign')
  @Auth(UserRole.DOCTOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign the note: locked forever (needs assessment or treatment)',
    description:
      'With fields in the body, they are saved first (like PUT) and the note is signed in the same transaction. Without a body, the saved draft is signed.',
  })
  @ApiOkResponse({ type: ClinicalNoteResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'NOTE_INCOMPLETE, NOTE_SIGNED or NOTE_NOT_ALLOWED',
  })
  sign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClinicalNoteInputDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentActor() actor: Actor,
  ): Promise<ClinicalNoteResponseDto> {
    return this.notes.sign(id, dto, user, actor);
  }
}

@ApiTags('Clinical records')
@Controller('clinical-notes')
export class ClinicalNotesController {
  constructor(private readonly notes: ClinicalNotesService) {}

  @Get('needs-attention')
  @Auth(...READERS)
  @ApiOperation({
    summary: 'ACTIVE visits without a SIGNED note (none yet, or a DRAFT)',
    description:
      'Oldest visit first. DOCTOR: own visits only. OWNER: all, optionally filtered by doctorId.',
  })
  @ApiOkResponse({ type: PaginatedResponse(NeedsAttentionEntryDto) })
  needsAttention(
    @Query() query: NeedsAttentionQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Paginated<NeedsAttentionEntryDto>> {
    return this.notes.needsAttention(query, user);
  }

  @Post(':id/addenda')
  @Auth(UserRole.DOCTOR)
  @ApiOperation({
    summary: 'Add to a SIGNED note (any doctor with access to the patient)',
  })
  @ApiCreatedResponse({ type: ClinicalNoteResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'NOTE_NOT_SIGNED',
  })
  addAddendum(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddendumInputDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentActor() actor: Actor,
  ): Promise<ClinicalNoteResponseDto> {
    return this.notes.addAddendum(id, dto, user, actor);
  }
}

@ApiTags('Clinical records')
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: PatientAttachmentsService) {}

  @Get(':id/file')
  @Auth(...READERS)
  @ApiOperation({ summary: 'Download an attachment (authorized users only)' })
  @ApiProduces('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async file(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StreamableFile> {
    const file = await this.attachments.file(id, user);
    return new StreamableFile(file.stream, {
      type: file.mimeType,
      length: file.size,
      disposition: `inline; filename="${file.fileName}"`,
    });
  }
}
