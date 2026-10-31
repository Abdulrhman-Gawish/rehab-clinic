import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { conflict, ErrorCode } from '../../common/errors/app.exception.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import {
  isExclusionViolation,
  isUniqueViolation,
} from '../../common/utils/pg-errors.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import {
  AppointmentTrigger,
  assertTransition,
} from './appointment-state-machine.js';
import { AppointmentSource, AppointmentStatus } from './appointment.enums.js';
import { AppointmentStatusHistory } from './entities/appointment-status-history.entity.js';
import {
  Appointment,
  APPOINTMENT_REFERENCE_UNIQUE,
  DOCTOR_OVERLAP_EXCLUSION,
  PATIENT_OVERLAP_EXCLUSION,
} from './entities/appointment.entity.js';
import { generateReferenceCode } from './reference-code.util.js';

const MINUTE_MS = 60_000;
const REFERENCE_ATTEMPTS = 3;

const STATUS_AUDIT_ACTION: Partial<Record<AppointmentStatus, AuditAction>> = {
  [AppointmentStatus.CONFIRMED]: AuditAction.APPOINTMENT_CONFIRMED,
  [AppointmentStatus.CANCELLED]: AuditAction.APPOINTMENT_CANCELLED,
  [AppointmentStatus.NO_SHOW]: AuditAction.APPOINTMENT_NO_SHOW,
  [AppointmentStatus.RESCHEDULED]: AuditAction.APPOINTMENT_RESCHEDULED,
  [AppointmentStatus.ATTENDED]: AuditAction.APPOINTMENT_ATTENDED,
};

function auditActionFor(
  to: AppointmentStatus,
  trigger: AppointmentTrigger,
): AuditAction {
  if (trigger === AppointmentTrigger.UNDO_ATTEND) {
    return AuditAction.APPOINTMENT_ATTEND_UNDONE;
  }
  if (trigger === AppointmentTrigger.UNDO_NO_SHOW) {
    return AuditAction.APPOINTMENT_NO_SHOW_UNDONE;
  }
  const action = STATUS_AUDIT_ACTION[to];
  if (!action) throw new Error(`No audit action defined for status ${to}`);
  return action;
}

export interface ChangeStatusOptions {
  reason?: string | null;
  // Which operation performs the change (see the state machine).
  trigger?: AppointmentTrigger;
}

export interface NewAppointment {
  patientId: string;
  doctorId: string;
  serviceId: string;
  startAt: Date;
  durationMinutes: number;
  status: AppointmentStatus;
  source: AppointmentSource;
  bookedName: string;
  bookedById: string | null;
  rescheduledFromId?: string | null;
  notes?: string | null;
  requestedPackageId?: string | null;
}

/**
 * Every appointment write goes through here so that the row, its status
 * history entry and its audit entry are always written in the caller's
 * transaction (all or nothing).
 */
@Injectable()
export class AppointmentWriter {
  constructor(private readonly auditService: AuditService) {}

  async insert(
    manager: EntityManager,
    data: NewAppointment,
    actor: Actor,
  ): Promise<Appointment> {
    const repository = manager.getRepository(Appointment);
    const appointment = await repository.save(
      repository.create({
        referenceCode: generateReferenceCode(),
        patientId: data.patientId,
        doctorId: data.doctorId,
        serviceId: data.serviceId,
        startAt: data.startAt,
        // Never taken from the client.
        endAt: new Date(
          data.startAt.getTime() + data.durationMinutes * MINUTE_MS,
        ),
        status: data.status,
        source: data.source,
        bookedName: data.bookedName,
        bookedById: data.bookedById,
        rescheduledFromId: data.rescheduledFromId ?? null,
        cancelReason: null,
        notes: data.notes ?? null,
        requestedPackageId: data.requestedPackageId ?? null,
      }),
    );

    await this.recordHistory(
      manager,
      appointment.id,
      null,
      data.status,
      actor,
      null,
    );
    await this.auditService.logAction(
      actor,
      AuditAction.APPOINTMENT_CREATED,
      AuditEntityType.APPOINTMENT,
      appointment.id,
      {
        newValues: {
          referenceCode: appointment.referenceCode,
          patientId: appointment.patientId,
          doctorId: appointment.doctorId,
          serviceId: appointment.serviceId,
          startAt: appointment.startAt.toISOString(),
          endAt: appointment.endAt.toISOString(),
          status: appointment.status,
          source: appointment.source,
          bookedName: appointment.bookedName,
          rescheduledFromId: appointment.rescheduledFromId,
          requestedPackageId: appointment.requestedPackageId,
        },
      },
      manager,
    );
    return appointment;
  }

  /**
   * Validates the transition with the state machine, then updates the row,
   * appends status history and writes the audit entry (same transaction).
   * The caller must have locked the row (SELECT ... FOR UPDATE).
   */
  async changeStatus(
    manager: EntityManager,
    appointment: Appointment,
    to: AppointmentStatus,
    actor: Actor,
    options: ChangeStatusOptions = {},
  ): Promise<Appointment> {
    const from = appointment.status;
    const trigger = options.trigger ?? AppointmentTrigger.APPOINTMENT;
    const reason = options.reason ?? null;
    assertTransition(from, to, trigger);
    const action = auditActionFor(to, trigger);

    appointment.status = to;
    if (to === AppointmentStatus.CANCELLED) appointment.cancelReason = reason;
    await manager.getRepository(Appointment).update(appointment.id, {
      status: to,
      cancelReason: appointment.cancelReason,
    });

    await this.recordHistory(manager, appointment.id, from, to, actor, reason);
    await this.auditService.logAction(
      actor,
      action,
      AuditEntityType.APPOINTMENT,
      appointment.id,
      {
        oldValues: { status: from },
        newValues: {
          status: to,
          ...(reason && { reason }),
          ...(trigger !== AppointmentTrigger.APPOINTMENT && { trigger }),
        },
      },
      manager,
    );
    return appointment;
  }

  /**
   * Runs a booking transaction, retrying on the (very unlikely) reference
   * code collision, and maps exclusion violations to 409s.
   */
  async runBooking<T>(work: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await work();
      } catch (error) {
        if (
          attempt < REFERENCE_ATTEMPTS &&
          isUniqueViolation(error, APPOINTMENT_REFERENCE_UNIQUE)
        ) {
          continue;
        }
        throw mapBookingError(error);
      }
    }
  }

  private async recordHistory(
    manager: EntityManager,
    appointmentId: string,
    fromStatus: AppointmentStatus | null,
    toStatus: AppointmentStatus,
    actor: Actor,
    reason: string | null,
  ): Promise<void> {
    await manager.getRepository(AppointmentStatusHistory).insert({
      appointmentId,
      fromStatus,
      toStatus,
      changedById: actor.userId,
      reason,
    });
  }
}

// 23P01 from the exclusion constraints -> 409 with a stable code.
export function mapBookingError(error: unknown): unknown {
  if (isExclusionViolation(error, DOCTOR_OVERLAP_EXCLUSION)) {
    return conflict(
      ErrorCode.SLOT_UNAVAILABLE,
      'This time slot is no longer available for the doctor',
    );
  }
  if (isExclusionViolation(error, PATIENT_OVERLAP_EXCLUSION)) {
    return conflict(
      ErrorCode.PATIENT_OVERLAP,
      'The patient already has an appointment at this time',
    );
  }
  return error;
}
