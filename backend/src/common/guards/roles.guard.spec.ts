import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { UserRole } from '../enums/user-role.enum.js';
import type { AuthenticatedUser } from '../interfaces/authenticated-request.interface.js';
import { RolesGuard } from './roles.guard.js';

function context(
  metadata: Record<string, unknown>,
  user?: AuthenticatedUser,
): { ctx: ExecutionContext; reflector: Reflector } {
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockImplementation(
    (key: unknown) => metadata[key as string],
  );
  const ctx = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
  return { ctx, reflector };
}

describe('RolesGuard', () => {
  const doctor: AuthenticatedUser = { id: '1', role: UserRole.DOCTOR };

  it('lets public routes through', () => {
    const { ctx, reflector } = context({
      [IS_PUBLIC_KEY]: true,
      [ROLES_KEY]: [UserRole.OWNER],
    });
    expect(new RolesGuard(reflector).canActivate(ctx)).toBe(true);
  });

  it('allows any authenticated user when no roles are required', () => {
    const { ctx, reflector } = context({}, doctor);
    expect(new RolesGuard(reflector).canActivate(ctx)).toBe(true);
  });

  it('allows a matching role', () => {
    const { ctx, reflector } = context(
      { [ROLES_KEY]: [UserRole.OWNER, UserRole.DOCTOR] },
      doctor,
    );
    expect(new RolesGuard(reflector).canActivate(ctx)).toBe(true);
  });

  it('denies other roles and anonymous requests', () => {
    const owners = { [ROLES_KEY]: [UserRole.OWNER] };
    const asDoctor = context(owners, doctor);
    const anonymous = context(owners);
    expect(new RolesGuard(asDoctor.reflector).canActivate(asDoctor.ctx)).toBe(
      false,
    );
    expect(new RolesGuard(anonymous.reflector).canActivate(anonymous.ctx)).toBe(
      false,
    );
  });
});
