import { Injectable } from '@nestjs/common';

/**
 * Hook for anti-abuse checks on public bookings (e.g. CAPTCHA). To add one,
 * implement BookingVerifier and bind it to BOOKING_VERIFIER in
 * AppointmentsModule; `verify` throws (e.g. 400/403) to reject a request.
 */
export const BOOKING_VERIFIER = Symbol('BOOKING_VERIFIER');

export interface BookingVerificationContext {
  ip: string | null;
  // Client token from the website widget (PublicBookingDto.captchaToken).
  token?: string;
}

export interface BookingVerifier {
  verify(context: BookingVerificationContext): Promise<void>;
}

// Default: no CAPTCHA yet. Throttling, the honeypot and the per-phone limit
// still apply.
@Injectable()
export class NoopBookingVerifier implements BookingVerifier {
  verify(): Promise<void> {
    return Promise.resolve();
  }
}
