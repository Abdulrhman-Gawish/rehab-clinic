import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { ClinicalAccessService } from '../clinical/clinical-access.service.js';
import type {
  TimelinePageDto,
  TimelineQueryDto,
} from './dto/patient-history.dto.js';
import {
  TimelineEventType as T,
  visibleEventTypes,
} from './patient-history.enums.js';
import { toTimelineEvent, type TimelineRow } from './patient-history.mapper.js';

/**
 * One source query per event type. Every branch selects the same columns;
 * `$1` is always the patient id. Ids are `TYPE:<source row id>`, so they
 * are unique even when one row yields two events (a payment and its void).
 */
interface Columns {
  id: string;
  at: string;
  actor?: string;
  doctor?: string;
  appointment?: string;
  visit?: string;
  invoice?: string;
  payment?: string;
  note?: string;
  data: string;
}

function branch(type: T, from: string, c: Columns): string {
  const uuid = (column?: string) => column ?? 'NULL::uuid';
  return `SELECT '${type}:' || ${c.id} AS id, '${type}'::text AS type, ${c.at} AS at,
    ${uuid(c.actor)} AS actor_id, ${uuid(c.doctor)} AS doctor_id,
    ${uuid(c.appointment)} AS appointment_id, ${uuid(c.visit)} AS visit_id,
    ${uuid(c.invoice)} AS invoice_id, ${uuid(c.payment)} AS payment_id,
    ${uuid(c.note)} AS note_id, ${c.data} AS data
    FROM ${from}`;
}

const SERVICE = `jsonb_build_object('id', s.id, 'name', s.name)`;

const PATIENT_AUDIT = (action: AuditAction, join = '') =>
  `audit_logs a ${join} WHERE a.entity_type = '${AuditEntityType.PATIENT}' AND a.entity_id = $1 AND a.action = '${action}'`;

const NAME_PHONE = (values: string) =>
  `jsonb_strip_nulls(jsonb_build_object('name', ${values}->'name', 'phone', ${values}->'phone'))`;

const APPOINTMENT_HISTORY = (condition: string) =>
  `appointment_status_history h JOIN appointments ap ON ap.id = h.appointment_id
    WHERE ap.patient_id = $1 AND ${condition}`;

const HISTORY_COLUMNS = (data: string): Columns => ({
  id: 'h.id',
  at: 'h.changed_at',
  actor: 'h.changed_by',
  doctor: 'ap.doctor_id',
  appointment: 'ap.id',
  data,
});

const VISITS = `visits v JOIN clinic_services s ON s.id = v.service_id WHERE v.patient_id = $1`;
const INVOICES = `invoices i LEFT JOIN visits v ON v.id = i.visit_id WHERE i.patient_id = $1`;
const DISCOUNTS = `invoice_discounts d JOIN invoices i ON i.id = d.invoice_id
  LEFT JOIN visits v ON v.id = i.visit_id WHERE d.patient_id = $1`;
const PAYMENTS = `payments p JOIN invoices i ON i.id = p.invoice_id
  LEFT JOIN visits v ON v.id = i.visit_id WHERE i.patient_id = $1`;
const PAYMENT_COLUMNS = (at: string, actor: string, data: string) => ({
  id: 'p.id',
  at,
  actor,
  doctor: 'v.doctor_id',
  visit: 'i.visit_id',
  invoice: 'i.id',
  payment: 'p.id',
  data,
});

const BRANCHES: Record<T, string> = {
  [T.PATIENT_CREATED]: branch(T.PATIENT_CREATED, 'patients p WHERE p.id = $1', {
    id: 'p.id',
    at: 'p.created_at',
    actor: 'p.created_by',
    data: `jsonb_build_object('source', p.created_source)`,
  }),
  // Only changes of the name or the phone.
  [T.PATIENT_UPDATED]: branch(
    T.PATIENT_UPDATED,
    `${PATIENT_AUDIT(AuditAction.PATIENT_UPDATED)} AND a.new_values ?| array['name', 'phone']`,
    {
      id: 'a.id',
      at: 'a.created_at',
      actor: 'a.user_id',
      data: `jsonb_build_object('oldValues', ${NAME_PHONE('a.old_values')}, 'newValues', ${NAME_PHONE('a.new_values')})`,
    },
  ),
  // The target of a reschedule is part of APPOINTMENT_RESCHEDULED.
  [T.APPOINTMENT_BOOKED]: branch(
    T.APPOINTMENT_BOOKED,
    `appointments ap JOIN clinic_services s ON s.id = ap.service_id
      WHERE ap.patient_id = $1 AND ap.rescheduled_from_id IS NULL`,
    {
      id: 'ap.id',
      at: 'ap.created_at',
      actor: 'ap.booked_by',
      doctor: 'ap.doctor_id',
      appointment: 'ap.id',
      data: `jsonb_build_object('source', ap.source, 'service', ${SERVICE}, 'startAt', ap.start_at,
        'bookedName', ap.booked_name, 'referenceCode', ap.reference_code)`,
    },
  ),
  [T.APPOINTMENT_CONFIRMED]: branch(
    T.APPOINTMENT_CONFIRMED,
    APPOINTMENT_HISTORY(
      `h.from_status = 'PENDING' AND h.to_status = 'CONFIRMED'`,
    ),
    HISTORY_COLUMNS(`jsonb_build_object('startAt', ap.start_at)`),
  ),
  // Refs point at the new appointment; the old one is previousAppointmentId.
  [T.APPOINTMENT_RESCHEDULED]: branch(
    T.APPOINTMENT_RESCHEDULED,
    `appointment_status_history h JOIN appointments ap ON ap.id = h.appointment_id
      JOIN appointments nw ON nw.rescheduled_from_id = ap.id
      WHERE ap.patient_id = $1 AND h.to_status = 'RESCHEDULED'`,
    {
      ...HISTORY_COLUMNS(
        `jsonb_build_object('previousAppointmentId', ap.id, 'oldStartAt', ap.start_at,
          'newStartAt', nw.start_at, 'reason', h.reason)`,
      ),
      doctor: 'nw.doctor_id',
      appointment: 'nw.id',
    },
  ),
  [T.APPOINTMENT_CANCELLED]: branch(
    T.APPOINTMENT_CANCELLED,
    APPOINTMENT_HISTORY(`h.to_status = 'CANCELLED'`),
    HISTORY_COLUMNS(
      `jsonb_build_object('startAt', ap.start_at, 'reason', h.reason)`,
    ),
  ),
  [T.APPOINTMENT_NO_SHOW]: branch(
    T.APPOINTMENT_NO_SHOW,
    APPOINTMENT_HISTORY(`h.to_status = 'NO_SHOW'`),
    HISTORY_COLUMNS(`jsonb_build_object('startAt', ap.start_at)`),
  ),
  [T.NO_SHOW_UNDONE]: branch(
    T.NO_SHOW_UNDONE,
    APPOINTMENT_HISTORY(
      `h.from_status = 'NO_SHOW' AND h.to_status = 'CONFIRMED'`,
    ),
    HISTORY_COLUMNS(`jsonb_build_object('startAt', ap.start_at)`),
  ),
  // Voided visits too: they were attended, then undone (ATTEND_UNDONE).
  [T.VISIT_ATTENDED]: branch(T.VISIT_ATTENDED, VISITS, {
    id: 'v.id',
    at: 'v.attended_at',
    actor: 'v.attended_by',
    doctor: 'v.doctor_id',
    appointment: 'v.appointment_id',
    visit: 'v.id',
    data: `jsonb_build_object('isWalkIn', v.appointment_id IS NULL, 'service', ${SERVICE})`,
  }),
  [T.ATTEND_UNDONE]: branch(
    T.ATTEND_UNDONE,
    `${VISITS} AND v.voided_at IS NOT NULL`,
    {
      id: 'v.id',
      at: 'v.voided_at',
      actor: 'v.voided_by',
      doctor: 'v.doctor_id',
      appointment: 'v.appointment_id',
      visit: 'v.id',
      data: `jsonb_build_object('isWalkIn', v.appointment_id IS NULL, 'service', ${SERVICE}, 'reason', v.void_reason)`,
    },
  ),
  // Visit invoices are created by attend (issued_by NULL): its receptionist.
  [T.INVOICE_ISSUED]: branch(T.INVOICE_ISSUED, INVOICES, {
    id: 'i.id',
    at: 'i.issued_at',
    actor: 'COALESCE(i.issued_by, v.attended_by)',
    doctor: 'v.doctor_id',
    visit: 'i.visit_id',
    invoice: 'i.id',
    data: `jsonb_build_object('invoiceNumber', i.invoice_number, 'total', i.total::text)`,
  }),
  [T.INVOICE_CANCELLED]: branch(
    T.INVOICE_CANCELLED,
    `${INVOICES} AND i.cancelled_at IS NOT NULL`,
    {
      id: 'i.id',
      at: 'i.cancelled_at',
      actor: 'i.cancelled_by',
      doctor: 'v.doctor_id',
      visit: 'i.visit_id',
      invoice: 'i.id',
      data: `jsonb_build_object('invoiceNumber', i.invoice_number, 'reason', i.cancel_reason)`,
    },
  ),
  [T.DISCOUNT_APPLIED]: branch(T.DISCOUNT_APPLIED, DISCOUNTS, {
    id: 'd.id',
    at: 'd.applied_at',
    actor: 'd.applied_by',
    doctor: 'v.doctor_id',
    visit: 'i.visit_id',
    invoice: 'i.id',
    data: `jsonb_build_object('invoiceNumber', i.invoice_number, 'type', d.type, 'value', d.value::text,
      'amount', d.amount::text, 'reason', d.reason, 'isRepeat', d.repeated_from_id IS NOT NULL)`,
  }),
  // Also when replaced by another discount (reason "Replaced").
  [T.DISCOUNT_REMOVED]: branch(
    T.DISCOUNT_REMOVED,
    `${DISCOUNTS} AND d.removed_at IS NOT NULL`,
    {
      id: 'd.id',
      at: 'd.removed_at',
      actor: 'd.removed_by',
      doctor: 'v.doctor_id',
      visit: 'i.visit_id',
      invoice: 'i.id',
      data: `jsonb_build_object('invoiceNumber', i.invoice_number, 'amount', d.amount::text, 'reason', d.removal_reason)`,
    },
  ),
  // Voided payments too: they were recorded, then voided (PAYMENT_VOIDED).
  [T.PAYMENT_RECORDED]: branch(
    T.PAYMENT_RECORDED,
    `${PAYMENTS} AND p.type = 'PAYMENT'`,
    PAYMENT_COLUMNS(
      'p.received_at',
      'p.received_by',
      `jsonb_build_object('receiptNumber', p.receipt_number, 'amount', p.amount::text,
        'method', p.method, 'reference', p.reference)`,
    ),
  ),
  // A voided payment or refund.
  [T.PAYMENT_VOIDED]: branch(
    T.PAYMENT_VOIDED,
    `${PAYMENTS} AND p.voided_at IS NOT NULL`,
    PAYMENT_COLUMNS(
      'p.voided_at',
      'p.voided_by',
      `jsonb_build_object('receiptNumber', p.receipt_number, 'paymentType', p.type,
        'amount', p.amount::text, 'method', p.method, 'reason', p.void_reason)`,
    ),
  ),
  [T.PAYMENT_REFUNDED]: branch(
    T.PAYMENT_REFUNDED,
    `${PAYMENTS} AND p.type = 'REFUND'`,
    PAYMENT_COLUMNS(
      'p.received_at',
      'p.received_by',
      `jsonb_build_object('receiptNumber', p.receipt_number, 'amount', p.amount::text,
        'method', p.method, 'reason', p.reason, 'refundOfPaymentId', p.refund_of_id)`,
    ),
  ),
  // Drafts never appear: only SIGNED notes (and their addenda).
  [T.NOTE_SIGNED]: branch(
    T.NOTE_SIGNED,
    `clinical_notes n JOIN doctors dr ON dr.id = n.doctor_id
      WHERE n.patient_id = $1 AND n.status = 'SIGNED'`,
    {
      id: 'n.id',
      at: 'n.signed_at',
      actor: 'dr.user_id',
      doctor: 'n.doctor_id',
      visit: 'n.visit_id',
      note: 'n.id',
      data: `jsonb_build_object('assessment', left(n.assessment, 200))`,
    },
  ),
  [T.ADDENDUM_ADDED]: branch(
    T.ADDENDUM_ADDED,
    `clinical_note_addenda ad JOIN clinical_notes n ON n.id = ad.note_id
      JOIN doctors dr ON dr.id = ad.doctor_id
      WHERE n.patient_id = $1 AND n.status = 'SIGNED'`,
    {
      id: 'ad.id',
      at: 'ad.created_at',
      actor: 'dr.user_id',
      doctor: 'ad.doctor_id',
      visit: 'n.visit_id',
      note: 'n.id',
      data: `jsonb_build_object('content', left(ad.content, 200))`,
    },
  ),
  [T.MEDICAL_INFO_UPDATED]: branch(
    T.MEDICAL_INFO_UPDATED,
    PATIENT_AUDIT(
      AuditAction.PATIENT_MEDICAL_INFO_UPDATED,
      'LEFT JOIN doctors dr ON dr.user_id = a.user_id',
    ),
    {
      id: 'a.id',
      at: 'a.created_at',
      actor: 'a.user_id',
      doctor: 'dr.id',
      data: `jsonb_build_object('fields', COALESCE(
        (SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(a.new_values) AS k), '[]'::jsonb))`,
    },
  ),
  // `doctor` is the uploader when a doctor uploaded it (null for the OWNER).
  [T.ATTACHMENT_UPLOADED]: branch(
    T.ATTACHMENT_UPLOADED,
    `patient_attachments pa LEFT JOIN doctors dr ON dr.user_id = pa.uploaded_by
      WHERE pa.patient_id = $1`,
    {
      id: 'pa.id',
      at: 'pa.created_at',
      actor: 'pa.uploaded_by',
      doctor: 'dr.id',
      visit: 'pa.visit_id',
      data: `jsonb_build_object('attachmentId', pa.id, 'title', pa.title, 'mimeType', pa.mime_type)`,
    },
  ),
};

// The event time with full (microsecond) precision: JS Dates stop at
// milliseconds, which would break the keyset comparison.
const CURSOR_AT = `to_char(e.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const CURSOR_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

function encodeCursor(row: TimelineRow): string {
  return Buffer.from(JSON.stringify([row.cursor_at, row.id])).toString(
    'base64url',
  );
}

function decodeCursor(cursor: string): { at: string; id: string } {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    value = null;
  }
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== 'string' ||
    typeof value[1] !== 'string' ||
    !CURSOR_AT_PATTERN.test(value[0]) ||
    value[1].length > 100
  ) {
    throw new BadRequestException('Invalid cursor');
  }
  return { at: value[0], id: value[1] };
}

/**
 * Everything that happened with a patient, newest first, from one
 * UNION ALL query. Only the branches the caller's role may see are part of
 * the query, so hidden events are never fetched. Keyset pagination on
 * (at, id).
 */
@Injectable()
export class PatientTimelineService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ClinicalAccessService,
    private readonly time: ClinicTimeService,
  ) {}

  async timeline(
    patientId: string,
    query: TimelineQueryDto,
    user: AuthenticatedUser,
  ): Promise<TimelinePageDto> {
    await this.access.assertCanAccessPatient(user, patientId);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const types = visibleEventTypes(user.role).filter(
      (type) => !query.types || query.types.includes(type),
    );
    if (types.length === 0) return { items: [], nextCursor: null };

    const params: unknown[] = [patientId];
    const param = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const conditions: string[] = [];
    const { start, end } = this.time.dateRange(query.from, query.to);
    if (start) conditions.push(`e.at >= ${param(start)}`);
    if (end) conditions.push(`e.at < ${param(end)}`);
    if (cursor) {
      const at = `${param(cursor.at)}::timestamptz`;
      conditions.push(
        `(e.at < ${at} OR (e.at = ${at} AND e.id COLLATE "C" < ${param(cursor.id)}))`,
      );
    }

    const rows: TimelineRow[] = await this.dataSource.query(
      `SELECT e.*, au.name AS actor_name, du.name AS doctor_name, ${CURSOR_AT} AS cursor_at
         FROM (${types.map((type) => BRANCHES[type]).join('\nUNION ALL\n')}) e
         LEFT JOIN users au ON au.id = e.actor_id
         LEFT JOIN doctors ed ON ed.id = e.doctor_id
         LEFT JOIN users du ON du.id = ed.user_id
        ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
        ORDER BY e.at DESC, e.id COLLATE "C" DESC
        LIMIT ${param(query.limit + 1)}`,
      params,
    );

    const page = rows.slice(0, query.limit);
    const toIso = (d: Date) => this.time.toIso(d);
    return {
      items: page.map((row) => toTimelineEvent(row, toIso)),
      nextCursor:
        rows.length > query.limit ? encodeCursor(page[page.length - 1]) : null,
    };
  }
}
