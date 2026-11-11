import { UserRefDto } from '../../common/dto/user-ref.dto.js';
import type { Appointment } from '../appointments/entities/appointment.entity.js';
import { CHANNEL_CATEGORY } from './acquisition.enums.js';
import type {
  AcquisitionSourceDto,
  CampaignBookingDto,
} from './dto/acquisition.dto.js';
import type { PatientAcquisitionSource } from './entities/patient-acquisition-source.entity.js';

type ToIso = (instant: Date) => string;

export function toAcquisitionSource(
  source: PatientAcquisitionSource,
  toIso: ToIso,
): AcquisitionSourceDto {
  return {
    id: source.id,
    channel: source.channel,
    category: CHANNEL_CATEGORY[source.channel],
    details: source.details,
    isPrimary: source.isPrimary,
    recordedBy: UserRefDto.fromEntity(source.recordedBy),
    recordedAt: toIso(source.recordedAt),
    removedAt: source.removedAt ? toIso(source.removedAt) : null,
    removedBy: UserRefDto.fromNullable(source.removedBy),
    removalReason: source.removalReason,
  };
}

export function toCampaignBooking(
  appointment: Appointment,
  toIso: ToIso,
): CampaignBookingDto {
  return {
    appointmentId: appointment.id,
    referenceCode: appointment.referenceCode,
    startAt: toIso(appointment.startAt),
    bookedAt: toIso(appointment.createdAt),
    status: appointment.status,
    utm: {
      source: appointment.utmSource,
      medium: appointment.utmMedium,
      campaign: appointment.utmCampaign,
      content: appointment.utmContent,
      term: appointment.utmTerm,
    },
  };
}
