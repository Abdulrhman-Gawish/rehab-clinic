import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  Actor,
  AuthenticatedRequest,
  AuthenticatedUser,
} from '../interfaces/authenticated-request.interface.js';

// The authenticated user (only on non-public routes).
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const { user } = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) throw new UnauthorizedException();
    return user;
  },
);

// Who is acting + from where, for audit logging. Works on public routes too.
export const CurrentActor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Actor => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return {
      userId: request.user?.id ?? null,
      ip: request.ip ?? null,
      role: request.user?.role,
    };
  },
);
