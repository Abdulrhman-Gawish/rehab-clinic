import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AuthenticatedRequest } from '../interfaces/authenticated-request.interface.js';

/**
 * The whole clinic usually sits behind one router (one IP), so limits are
 * counted per user once authenticated. Registered after JwtAuthGuard, so
 * `req.user` is set on protected routes. Public routes fall back to the IP;
 * login counts per email + IP (see ThrottleLogin).
 */
@Injectable()
export class ClinicThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const { user, ip } = req as unknown as AuthenticatedRequest;
    return Promise.resolve(user ? `user:${user.id}` : `ip:${ip}`);
  }
}
