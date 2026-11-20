import type { AppointmentType } from '../appointments/appointment.enums.js';
import type { Visit } from './entities/visit.entity.js';

/**
 * A visit's appointment type: its appointment's (reception can change it at
 * any time), or its own for a walk-in. null = not set (from before types
 * existed). Requires `appointment` loaded when the visit has one.
 */
export function visitType(visit: Visit): AppointmentType | null {
  if (visit.appointmentId === null) return visit.type;
  if (!visit.appointment) {
    throw new Error(`Visit ${visit.id}: appointment is not loaded`);
  }
  return visit.appointment.type;
}
