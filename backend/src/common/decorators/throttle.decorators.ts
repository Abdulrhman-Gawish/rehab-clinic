import { Throttle } from '@nestjs/throttler';

// Rate limits. DEFAULT_THROTTLE applies to every route, counted per user
// when authenticated and per IP on public routes (ClinicThrottlerGuard).
// Login and public endpoints are stricter.
export const DEFAULT_THROTTLE = { limit: 120, ttl: 60_000 };
export const LOGIN_THROTTLE = { limit: 5, ttl: 60_000 };
export const PUBLIC_THROTTLE = { limit: 30, ttl: 60_000 };
// Creating appointments anonymously: a real person needs one or two.
export const PUBLIC_BOOKING_THROTTLE = { limit: 5, ttl: 15 * 60_000 };

// Per email + IP: staff logging in at shift start share the clinic's IP,
// and one mistyped password must not lock everyone out.
function loginTracker(req: Record<string, unknown>): string {
  const body = req.body as { email?: unknown } | undefined;
  const email =
    typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  return `login:${email}:${String(req.ip)}`;
}

export const ThrottleLogin = () =>
  Throttle({ default: { ...LOGIN_THROTTLE, getTracker: loginTracker } });
export const ThrottlePublic = () => Throttle({ default: PUBLIC_THROTTLE });
export const ThrottlePublicBooking = () =>
  Throttle({ default: PUBLIC_BOOKING_THROTTLE });
