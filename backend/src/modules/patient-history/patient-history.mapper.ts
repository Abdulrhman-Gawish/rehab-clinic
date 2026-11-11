import type {
  TimelineEventDto,
  TimelineRefsDto,
} from './dto/patient-history.dto.js';
import type { TimelineEventType } from './patient-history.enums.js';

type ToIso = (instant: Date) => string;

// One row of the timeline UNION ALL query.
export interface TimelineRow {
  id: string;
  type: TimelineEventType;
  at: Date;
  actor_id: string | null;
  actor_name: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
  appointment_id: string | null;
  visit_id: string | null;
  invoice_id: string | null;
  payment_id: string | null;
  note_id: string | null;
  data: Record<string, unknown>;
  cursor_at: string;
}

// jsonb renders instants in UTC: every `…At` key is re-rendered in the
// clinic zone like the rest of the API.
function toData(
  data: Record<string, unknown>,
  toIso: ToIso,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      key.endsWith('At') && typeof value === 'string'
        ? toIso(new Date(value))
        : value,
    ]),
  );
}

export function toTimelineEvent(
  row: TimelineRow,
  toIso: ToIso,
): TimelineEventDto {
  const refs: TimelineRefsDto = {};
  if (row.appointment_id) refs.appointmentId = row.appointment_id;
  if (row.visit_id) refs.visitId = row.visit_id;
  if (row.invoice_id) refs.invoiceId = row.invoice_id;
  if (row.payment_id) refs.paymentId = row.payment_id;
  if (row.note_id) refs.noteId = row.note_id;
  return {
    id: row.id,
    type: row.type,
    at: toIso(row.at),
    actor:
      row.actor_id && row.actor_name
        ? { id: row.actor_id, name: row.actor_name }
        : null,
    doctor:
      row.doctor_id && row.doctor_name
        ? { id: row.doctor_id, name: row.doctor_name }
        : null,
    refs,
    data: toData(row.data, toIso),
  };
}
