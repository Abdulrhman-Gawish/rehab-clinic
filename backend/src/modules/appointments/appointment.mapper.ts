import { samePersonName } from '../../common/utils/person-name.util.js';
import type { AppointmentSummaryDto } from './dto/appointment-summary.dto.js';
import type {
  AppointmentResponseDto,
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
