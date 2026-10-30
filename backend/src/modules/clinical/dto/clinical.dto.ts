import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { Trim } from '../../../common/decorators/transform.decorators.js';
import {
  PaginatedResponse,
  PaginationQueryDto,
  type Paginated,
} from '../../../common/dto/pagination.dto.js';
import { NoteStatus } from '../clinical.enums.js';

const MAX_TEXT = 5000;

// Optional clinical text: omitted = unchanged (PATCH) / empty (POST, PUT);
// null clears it. Blank strings are rejected.
const ClinicalText = (description?: string) =>
  applyDecorators(
    ApiPropertyOptional({ nullable: true, maxLength: MAX_TEXT, description }),
    IsOptional(),
    Trim(),
    IsString(),
    Length(1, MAX_TEXT),
  );

// ---------- Inputs ----------

// PUT replaces the whole record: a field left out becomes null.
export class MedicalInfoDto {
  @ClinicalText()
  allergies?: string | null;

  @ClinicalText()
  chronicConditions?: string | null;

  @ClinicalText()
  pastSurgeries?: string | null;

  @ClinicalText()
  currentMedications?: string | null;

  @ClinicalText()
  notes?: string | null;
}

export class ClinicalNoteInputDto {
  @ClinicalText()
  chiefComplaint?: string | null;

  @ClinicalText()
  assessment?: string | null;

  @ClinicalText()
  treatmentDone?: string | null;

  @ClinicalText()
  progress?: string | null;

  @ClinicalText('Next steps and home exercises')
  plan?: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  painScore?: number | null;
}

export class AddendumInputDto {
  @ApiProperty({
    maxLength: MAX_TEXT,
    example: 'Patient called: pain is down.',
  })
  @Trim()
  @IsString()
  @Length(1, MAX_TEXT)
  content: string;
}

// Multipart fields sent next to `file`.
export class AttachmentUploadDto {
  @ApiProperty({ maxLength: 200, example: 'Knee X-ray' })
  @Trim()
  @IsString()
  @Length(1, 200)
  title: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: "One of the patient's visits",
  })
  @IsOptional()
  @IsUUID()
  visitId?: string;
}

export class NeedsAttentionQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'OWNER only; ignored for doctors (always their own)',
  })
  @IsOptional()
  @IsUUID()
  doctorId?: string;
}

// ---------- Outputs ----------

export class ClinicalDoctorDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Dr. Mona Adel' })
  name: string;
}

export class MedicalInfoResponseDto {
  @ApiProperty({ format: 'uuid' })
  patientId: string;

  @ApiProperty({ nullable: true, type: String })
  allergies: string | null;

  @ApiProperty({ nullable: true, type: String })
  chronicConditions: string | null;

  @ApiProperty({ nullable: true, type: String })
  pastSurgeries: string | null;

  @ApiProperty({ nullable: true, type: String })
  currentMedications: string | null;

  @ApiProperty({ nullable: true, type: String })
  notes: string | null;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    type: String,
    description: 'null until the first save',
  })
  updatedById: string | null;

  @ApiProperty({ nullable: true, type: String })
  updatedAt: string | null;
}

export class AddendumResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: ClinicalDoctorDto })
  doctor: ClinicalDoctorDto;

  @ApiProperty()
  content: string;

  @ApiProperty({ example: '2026-11-05T12:00:00+02:00' })
  createdAt: string;
}

export class NoteVisitDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    example: '2026-11-05T09:50:00+02:00',
    description: 'When the patient attended',
  })
  date: string;

  @ApiProperty({ example: { id: '…', name: 'Physiotherapy session' } })
  service: { id: string; name: string };
}

export class ClinicalNoteResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  patientId: string;

  @ApiProperty({ type: NoteVisitDto })
  visit: NoteVisitDto;

  @ApiProperty({ type: ClinicalDoctorDto, description: 'Author' })
  doctor: ClinicalDoctorDto;

  @ApiProperty({ nullable: true, type: String })
  chiefComplaint: string | null;

  @ApiProperty({ nullable: true, type: String })
  assessment: string | null;

  @ApiProperty({ nullable: true, type: String })
  treatmentDone: string | null;

  @ApiProperty({ nullable: true, type: String })
  progress: string | null;

  @ApiProperty({ nullable: true, type: String })
  plan: string | null;

  @ApiProperty({ nullable: true, type: Number })
  painScore: number | null;

  @ApiProperty({ enum: NoteStatus })
  status: NoteStatus;

  @ApiProperty({ nullable: true, type: String })
  signedAt: string | null;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  @ApiProperty({ type: [AddendumResponseDto], description: 'Oldest first' })
  addenda: AddendumResponseDto[];
}

export class AttachmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  patientId: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  visitId: string | null;

  @ApiProperty({ example: 'Knee X-ray' })
  title: string;

  @ApiProperty({ example: 'image/jpeg' })
  mimeType: string;

  @ApiProperty({ example: 182044 })
  sizeBytes: number;

  @ApiProperty({ format: 'uuid' })
  uploadedById: string;

  @ApiProperty()
  createdAt: string;
}

const PaginatedNotes = PaginatedResponse(ClinicalNoteResponseDto);

export class ClinicalHistoryDto {
  @ApiProperty({ type: MedicalInfoResponseDto })
  medicalInfo: MedicalInfoResponseDto;

  @ApiProperty({
    type: PaginatedNotes,
    description: 'SIGNED notes only, newest visit first',
  })
  notes: Paginated<ClinicalNoteResponseDto>;

  @ApiProperty({
    type: [AttachmentResponseDto],
    description: "All of the patient's attachments, newest first",
  })
  attachments: AttachmentResponseDto[];
}

export class NeedsAttentionEntryDto {
  @ApiProperty({ format: 'uuid' })
  visitId: string;

  @ApiProperty({
    example: '2026-11-05T09:50:00+02:00',
    description: 'When the patient attended',
  })
  visitDate: string;

  @ApiProperty({ example: { id: '…', name: 'Ahmed Hassan' } })
  patient: { id: string; name: string };

  @ApiProperty({ example: { id: '…', name: 'Physiotherapy session' } })
  service: { id: string; name: string };

  @ApiProperty({ type: ClinicalDoctorDto })
  doctor: ClinicalDoctorDto;

  @ApiProperty({
    enum: [NoteStatus.DRAFT],
    nullable: true,
    description: 'null = no note yet',
  })
  noteStatus: NoteStatus | null;
}
