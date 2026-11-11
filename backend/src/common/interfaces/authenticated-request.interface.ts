import type { Request } from 'express';
import type { UserRole } from '../enums/user-role.enum.js';

// Claims carried by the access token.
export interface JwtPayload {
  sub: string;
  role: UserRole;
}

// Set on request.user by JwtAuthGuard after re-checking the user in the DB.
export interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

// Who performs an action, as recorded in the audit log.
// userId is null for public (anonymous) actions.
export interface Actor {
  userId: string | null;
  ip: string | null;
  // Role of the acting user, for role-dependent business rules.
  role?: UserRole;
}
