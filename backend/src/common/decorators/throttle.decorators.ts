import { Throttle } from '@nestjs/throttler';

// Stricter limits than the global default (THROTTLE_LIMIT per THROTTLE_TTL_MS).
// Both are per client IP.
export const LOGIN_THROTTLE = { limit: 5, ttl: 60_000 };
export const PUBLIC_THROTTLE = { limit: 30, ttl: 60_000 };

export const ThrottleLogin = () => Throttle({ default: LOGIN_THROTTLE });
export const ThrottlePublic = () => Throttle({ default: PUBLIC_THROTTLE });
