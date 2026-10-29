import { samePersonName } from '../../common/utils/person-name.util.js';
import type { AppointmentSummaryDto } from './dto/appointment-summary.dto.js';
import type { Visit } from '../visits/entities/visit.entity.js';
import type {
  AppointmentResponseDto,
  DayListEntryDto,
  StatusHistoryEntryDto,
} from './dto/appointment.dto.js';
import type { AppointmentStatusHistory } from './entities/appointment-status-history.entity.js';
import type { Appointment } from './entities/appointment.entity.js';

type ToIso = (instant: Date) => string;

// Requires patient, doctor.user and service to be loaded.
export function toAppointmentResponse(
  appointment: Appointment,
  toIso: ToIso,
): AppointmentResponseDto {
  const { patient, doctor, service } = appointment;
  if (!patient || !doctor?.user || !service) {
    throw new Error('Appointment relations are not loaded');
  }
  return {
    id: appointment.id,
    referenceCode: appointment.referenceCode,
    status: appointment.status,
    source: appointment.source,
    startAt: toIso(appointment.startAt),
    endAt: toIso(appointment.endAt),
    bookedName: appointment.bookedName,
    nameMismatch: !samePersonName(appointment.bookedName, patient.name),
    patient: { id: patient.id, name: patient.name, phone: patient.phone },
    doctor: { id: doctor.id, name: doctor.user.name },
    service: {
      id: service.id,
      name: service.name,
      durationMinutes: service.durationMinutes,
    },
    bookedById: appointment.bookedById,
    rescheduledFromId: appointment.rescheduledFromId,
    cancelReason: appointment.cancelReason,
    notes: appointment.notes,
    createdAt: appointment.createdAt,
    updatedAt: appointment.updatedAt,
  };
}

// `visit`: the appointment's visit, if it was checked in.
export function toDayListEntry(
  appointment: Appointment,
  visit: Visit | null,
  toIso: ToIso,
): DayListEntryDto {
  const dto = toAppointmentResponse(appointment, toIso);
  return {
    isWalkIn: false,
    id: dto.id,
    referenceCode: dto.referenceCode,
    status: dto.status,
    source: dto.source,
    startAt: dto.startAt,
    endAt: dto.endAt,
    bookedName: dto.bookedName,
    nameMismatch: dto.nameMismatch,
    patient: dto.patient,
    doctor: dto.doctor,
    service: dto.service,
    notes: dto.notes,
    cancelReason: dto.cancelReason,
    visitId: visit?.id ?? null,
    visitStatus: visit?.status ?? null,
    checkedInAt: visit ? toIso(visit.checkedInAt) : null,
  };
}

// Requires patient, doctor.user and service loaded on the visit.
export function toWalkInDayListEntry(
  visit: Visit,
  toIso: ToIso,
): DayListEntryDto {
  const { patient, doctor, service } = visit;
  if (!patient || !doctor?.user || !service) {
    throw new Error('Visit relations are not loaded');
  }
  return {
    isWalkIn: true,
    id: null,
    referenceCode: null,
    status: null,
    source: null,
    startAt: null,
    endAt: null,
    bookedName: null,
    nameMismatch: false,
    patient: { id: patient.id, name: patient.name, phone: patient.phone },
    doctor: { id: doctor.id, name: doctor.user.name },
    service: {
      id: service.id,
      name: service.name,
      durationMinutes: service.durationMinutes,
    },
    notes: null,
    cancelReason: visit.cancelReason,
    visitId: visit.id,
    visitStatus: visit.status,
    checkedInAt: toIso(visit.checkedInAt),
  };
}

// Requires patient to be loaded.
export function toAppointmentSummary(
  appointment: Appointment,
  toIso: ToIso,
): AppointmentSummaryDto {
  return {
    id: appointment.id,
    referenceCode: appointment.referenceCode,
    startAt: toIso(appointment.startAt),
    endAt: toIso(appointment.endAt),
    status: appointment.status,
    patientName: appointment.patient?.name ?? appointment.bookedName,
  };
}

export function toHistoryEntry(
  entry: AppointmentStatusHistory,
  toIso: ToIso,
): StatusHistoryEntryDto {
  return {
    fromStatus: entry.fromStatus,
    toStatus: entry.toStatus,
    changedById: entry.changedById,
    reason: entry.reason,
    changedAt: toIso(entry.changedAt),
  };
}
