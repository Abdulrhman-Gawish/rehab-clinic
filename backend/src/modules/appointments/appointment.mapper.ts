import { UserRefDto } from '../../common/dto/user-ref.dto.js';
import { samePersonName } from '../../common/utils/person-name.util.js';
import type { AppointmentSummaryDto } from './dto/appointment-summary.dto.js';
import {
  compareMoney,
  isZeroMoney,
  subMoney,
} from '../../common/utils/money.util.js';
import type { Invoice } from '../billing/entities/invoice.entity.js';
import type { NoteStatus } from '../clinical/clinical.enums.js';
import type { Visit } from '../visits/entities/visit.entity.js';
import {
  DayPaymentStatus,
  type AppointmentResponseDto,
  type DayListEntryDto,
  type StatusHistoryEntryDto,
} from './dto/appointment.dto.js';
import type { AppointmentStatusHistory } from './entities/appointment-status-history.entity.js';
import type { Appointment } from './entities/appointment.entity.js';

type ToIso = (instant: Date) => string;

// Requires patient, doctor.user, service and bookedBy to be loaded.
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
    bookedBy: UserRefDto.fromNullable(appointment.bookedBy),
    rescheduledFromId: appointment.rescheduledFromId,
    cancelReason: appointment.cancelReason,
    notes: appointment.notes,
    createdAt: appointment.createdAt,
    updatedAt: appointment.updatedAt,
  };
}

// What a day-list row shows about its visit.
export interface DayVisitInfo {
  visit: Visit;
  // The live invoice; null when there is none, and always for a doctor.
  invoice: Invoice | null;
  noteStatus: NoteStatus | null;
  hasPayments: boolean;
}

type BillingColumns = Pick<
  DayListEntryDto,
  'invoiceId' | 'invoiceTotal' | 'amountPaid' | 'balance' | 'paymentStatus'
>;

// Billing columns of a day-list row, from the visit's live invoice.
function billingColumns(invoice: Invoice | null): BillingColumns {
  if (!invoice) {
    return {
      invoiceId: null,
      invoiceTotal: null,
      amountPaid: null,
      balance: null,
      paymentStatus: DayPaymentStatus.NOT_INVOICED,
    };
  }
  const paymentStatus =
    compareMoney(invoice.amountPaid, invoice.total) >= 0
      ? DayPaymentStatus.PAID
      : isZeroMoney(invoice.amountPaid)
        ? DayPaymentStatus.UNPAID
        : DayPaymentStatus.PARTIAL;
  return {
    invoiceId: invoice.id,
    invoiceTotal: invoice.total,
    amountPaid: invoice.amountPaid,
    balance: subMoney(invoice.total, invoice.amountPaid),
    paymentStatus,
  };
}

function visitColumns(
  info: DayVisitInfo | null,
  allowedActions: string[],
  withBilling: boolean,
  toIso: ToIso,
): Pick<
  DayListEntryDto,
  'visitId' | 'visitStatus' | 'attendedAt' | 'noteStatus' | 'allowedActions'
> &
  Partial<BillingColumns> {
  return {
    visitId: info?.visit.id ?? null,
    visitStatus: info?.visit.status ?? null,
    attendedAt: info ? toIso(info.visit.attendedAt) : null,
    noteStatus: info?.noteStatus ?? null,
    allowedActions,
    // Doctors never see billing.
    ...(withBilling && billingColumns(info?.invoice ?? null)),
  };
}

// `info`: the appointment's visit, if it attended.
export function toDayListEntry(
  appointment: Appointment,
  info: DayVisitInfo | null,
  allowedActions: string[],
  withBilling: boolean,
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
    ...visitColumns(info, allowedActions, withBilling, toIso),
  };
}

// Requires patient, doctor.user and service loaded on the visit.
export function toWalkInDayListEntry(
  info: DayVisitInfo,
  allowedActions: string[],
  withBilling: boolean,
  toIso: ToIso,
): DayListEntryDto {
  const { patient, doctor, service } = info.visit;
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
    cancelReason: info.visit.voidReason,
    ...visitColumns(info, allowedActions, withBilling, toIso),
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

// Requires `changedBy` to be loaded.
export function toHistoryEntry(
  entry: AppointmentStatusHistory,
  toIso: ToIso,
): StatusHistoryEntryDto {
  return {
    fromStatus: entry.fromStatus,
    toStatus: entry.toStatus,
    changedBy: UserRefDto.fromNullable(entry.changedBy),
    reason: entry.reason,
    changedAt: toIso(entry.changedAt),
  };
}
