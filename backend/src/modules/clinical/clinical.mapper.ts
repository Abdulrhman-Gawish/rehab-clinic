import { UserRefDto } from '../../common/dto/user-ref.dto.js';
import type { Doctor } from '../doctors/entities/doctor.entity.js';
import type { Visit } from '../visits/entities/visit.entity.js';
import type { NoteStatus } from './clinical.enums.js';
import type {
  AddendumResponseDto,
  AttachmentResponseDto,
  ClinicalDoctorDto,
  ClinicalNoteResponseDto,
  MedicalInfoResponseDto,
  NeedsAttentionEntryDto,
} from './dto/clinical.dto.js';
import type { ClinicalNoteAddendum } from './entities/clinical-note-addendum.entity.js';
import type { ClinicalNote } from './entities/clinical-note.entity.js';
import type { PatientAttachment } from './entities/patient-attachment.entity.js';
import type { PatientMedicalInfo } from './entities/patient-medical-info.entity.js';

type ToIso = (instant: Date) => string;

// Requires `user` to be loaded.
function toDoctor(doctor: Doctor | undefined): ClinicalDoctorDto {
  if (!doctor?.user) throw new Error('Doctor user is not loaded');
  return { id: doctor.id, name: doctor.user.name };
}

// `info` is null until the first save: every field is then empty.
// Requires `updatedBy` to be loaded.
export function toMedicalInfo(
  patientId: string,
  info: PatientMedicalInfo | null,
  toIso: ToIso,
): MedicalInfoResponseDto {
  return {
    patientId,
    allergies: info?.allergies ?? null,
    chronicConditions: info?.chronicConditions ?? null,
    pastSurgeries: info?.pastSurgeries ?? null,
    currentMedications: info?.currentMedications ?? null,
    notes: info?.notes ?? null,
    updatedBy: UserRefDto.fromNullable(info?.updatedBy),
    updatedAt: info ? toIso(info.updatedAt) : null,
  };
}

// Requires `doctor.user` to be loaded.
export function toAddendum(
  addendum: ClinicalNoteAddendum,
  toIso: ToIso,
): AddendumResponseDto {
  return {
    id: addendum.id,
    doctor: toDoctor(addendum.doctor),
    content: addendum.content,
    createdAt: toIso(addendum.createdAt),
  };
}

// Requires `visit.service` and `doctor.user` to be loaded.
export function toClinicalNote(
  note: ClinicalNote,
  addenda: ClinicalNoteAddendum[],
  toIso: ToIso,
): ClinicalNoteResponseDto {
  const { visit } = note;
  if (!visit?.service) throw new Error('Note visit is not loaded');
  return {
    id: note.id,
    patientId: note.patientId,
    visit: {
      id: visit.id,
      date: toIso(visit.attendedAt),
      service: { id: visit.service.id, name: visit.service.name },
    },
    doctor: toDoctor(note.doctor),
    chiefComplaint: note.chiefComplaint,
    assessment: note.assessment,
    treatmentDone: note.treatmentDone,
    progress: note.progress,
    plan: note.plan,
    painScore: note.painScore,
    status: note.status,
    signedAt: note.signedAt ? toIso(note.signedAt) : null,
    createdAt: toIso(note.createdAt),
    updatedAt: toIso(note.updatedAt),
    addenda: addenda.map((addendum) => toAddendum(addendum, toIso)),
  };
}

// Requires `uploadedBy` to be loaded.
export function toAttachment(
  attachment: PatientAttachment,
  toIso: ToIso,
): AttachmentResponseDto {
  return {
    id: attachment.id,
    patientId: attachment.patientId,
    visitId: attachment.visitId,
    title: attachment.title,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    uploadedBy: UserRefDto.fromEntity(attachment.uploadedBy),
    createdAt: toIso(attachment.createdAt),
  };
}

// Requires patient, service and doctor.user loaded on the visit.
export function toNeedsAttentionEntry(
  visit: Visit,
  noteStatus: NoteStatus | null,
  toIso: ToIso,
): NeedsAttentionEntryDto {
  const { patient, service } = visit;
  if (!patient || !service) throw new Error('Visit relations are not loaded');
  return {
    visitId: visit.id,
    visitDate: toIso(visit.attendedAt),
    patient: { id: patient.id, name: patient.name },
    service: { id: service.id, name: service.name },
    doctor: toDoctor(visit.doctor),
    noteStatus,
  };
}
