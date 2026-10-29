import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../modules/users/entities/user.entity.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import type {
  AuthenticatedRequest,
  JwtPayload,
} from '../interfaces/authenticated-request.interface.js';

// Global guard: every route needs a valid bearer access token unless it is
// marked @Public(). The user is re-read from the DB so deactivation and role
// changes take effect immediately, not when the token expires.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Missing access token');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    const user = await this.users.findOne({
      where: { id: payload.sub },
      select: { id: true, role: true, isActive: true },
    });
    if (!user?.isActive) {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    request.user = { id: user.id, role: user.role };
    return true;
  }
}
