import type {
  QueueEntryDto,
  VisitHistoryEntryDto,
  VisitResponseDto,
} from './dto/visit.dto.js';
import type { VisitStatusHistory } from './entities/visit-status-history.entity.js';
import type { Visit } from './entities/visit.entity.js';
import type { NoteStatus } from '../clinical/clinical.enums.js';
import { VisitStatus } from './visit.enums.js';
import type { VisitEventPayload } from './visit.events.js';

type ToIso = (instant: Date) => string;

const MINUTE_MS = 60_000;

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

// Requires patient, doctor.user, service (and appointment, if any) loaded.
export function toVisitResponse(visit: Visit, toIso: ToIso): VisitResponseDto {
  return {
    id: visit.id,
    status: visit.status,
    isWalkIn: visit.appointmentId === null,
    appointmentId: visit.appointmentId,
    appointmentReferenceCode: visit.appointment?.referenceCode ?? null,
    appointmentStartAt: isoOrNull(visit.appointment?.startAt ?? null, toIso),
    ...refs(visit),
    checkedInAt: toIso(visit.checkedInAt),
    checkedInById: visit.checkedInById,
    startedAt: isoOrNull(visit.startedAt, toIso),
    completedAt: isoOrNull(visit.completedAt, toIso),
    completedById: visit.completedById,
    cancelledAt: isoOrNull(visit.cancelledAt, toIso),
    cancelledById: visit.cancelledById,
    cancelReason: visit.cancelReason,
    createdAt: visit.createdAt,
    updatedAt: visit.updatedAt,
  };
}

export function toQueueEntry(
  visit: Visit,
  noteStatus: NoteStatus | null,
  now: Date,
  toIso: ToIso,
): QueueEntryDto {
  // IN_SESSION: the wait ended when the session started.
  const waitEnd =
    visit.status === VisitStatus.IN_SESSION && visit.startedAt
      ? visit.startedAt
      : now;
  return {
    visitId: visit.id,
    status: visit.status,
    isWalkIn: visit.appointmentId === null,
    appointmentId: visit.appointmentId,
    appointmentStartAt: isoOrNull(visit.appointment?.startAt ?? null, toIso),
    ...refs(visit),
    checkedInAt: toIso(visit.checkedInAt),
    startedAt: isoOrNull(visit.startedAt, toIso),
    waitingMinutes: Math.max(
      0,
      Math.floor((waitEnd.getTime() - visit.checkedInAt.getTime()) / MINUTE_MS),
    ),
    hasNote: noteStatus !== null,
    noteStatus,
  };
}

export function toVisitHistoryEntry(
  entry: VisitStatusHistory,
  toIso: ToIso,
): VisitHistoryEntryDto {
  return {
    fromStatus: entry.fromStatus,
    toStatus: entry.toStatus,
    changedById: entry.changedById,
    reason: entry.reason,
    changedAt: toIso(entry.changedAt),
  };
}

export function toEventPayload(visit: Visit, at: Date): VisitEventPayload {
  return {
    visitId: visit.id,
    appointmentId: visit.appointmentId,
    patientId: visit.patientId,
    doctorId: visit.doctorId,
    serviceId: visit.serviceId,
    at,
  };
}
