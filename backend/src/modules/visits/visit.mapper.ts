import type {
  QueueEntryDto,
  VisitHistoryEntryDto,
  VisitResponseDto,
} from './dto/visit.dto.js';
import type { VisitStatusHistory } from './entities/visit-status-history.entity.js';
import type { Visit } from './entities/visit.entity.js';
import { UserRefDto } from '../../common/dto/user-ref.dto.js';
import type { NoteStatus } from '../clinical/clinical.enums.js';

type ToIso = (instant: Date) => string;

function refs(visit: Visit) {
  const { patient, doctor, service } = visit;
  if (!patient || !doctor?.user || !service) {
    throw new Error('Visit relations are not loaded');
  }
  return {
    patient: { id: patient.id, name: patient.name, phone: patient.phone },
    doctor: { id: doctor.id, name: doctor.user.name },
    service: {
      id: service.id,
      name: service.name,
      durationMinutes: service.durationMinutes,
    },
  };
}

const isoOrNull = (instant: Date | null, toIso: ToIso) =>
  instant ? toIso(instant) : null;

// Requires patient, doctor.user, service, attendedBy, voidedBy (and the
// appointment, if any) loaded.
export function toVisitResponse(visit: Visit, toIso: ToIso): VisitResponseDto {
  return {
    id: visit.id,
    status: visit.status,
    isWalkIn: visit.appointmentId === null,
    appointmentId: visit.appointmentId,
    appointmentReferenceCode: visit.appointment?.referenceCode ?? null,
    appointmentStartAt: isoOrNull(visit.appointment?.startAt ?? null, toIso),
    ...refs(visit),
    attendedAt: toIso(visit.attendedAt),
    attendedBy: UserRefDto.fromEntity(visit.attendedBy),
    voidedAt: isoOrNull(visit.voidedAt, toIso),
    voidedBy: UserRefDto.fromNullable(visit.voidedBy),
    voidReason: visit.voidReason,
    createdAt: visit.createdAt,
    updatedAt: visit.updatedAt,
  };
}

export function toQueueEntry(
  visit: Visit,
  noteStatus: NoteStatus | null,
  toIso: ToIso,
): QueueEntryDto {
  return {
    visitId: visit.id,
    isWalkIn: visit.appointmentId === null,
    appointmentId: visit.appointmentId,
    appointmentStartAt: isoOrNull(visit.appointment?.startAt ?? null, toIso),
    ...refs(visit),
    attendedAt: toIso(visit.attendedAt),
    hasNote: noteStatus !== null,
    noteStatus,
  };
}

// Requires `changedBy` to be loaded.
export function toVisitHistoryEntry(
  entry: VisitStatusHistory,
  toIso: ToIso,
): VisitHistoryEntryDto {
  return {
    fromStatus: entry.fromStatus,
    toStatus: entry.toStatus,
    changedBy: UserRefDto.fromEntity(entry.changedBy),
    reason: entry.reason,
    changedAt: toIso(entry.changedAt),
  };
}
