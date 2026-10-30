import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import type {
  Actor,
  JwtPayload,
} from '../../common/interfaces/authenticated-request.interface.js';
import {
  hashPassword,
  verifyPassword,
} from '../../common/utils/password.util.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { UserResponseDto } from '../users/dto/user.dto.js';
import { User } from '../users/entities/user.entity.js';
import type {
  AuthTokensDto,
  LoginDto,
  LoginResponseDto,
} from './dto/auth.dto.js';
import { ACCESS_TOKEN_TTL_SECONDS } from './auth.constants.js';
import { RefreshTokensService } from './refresh-tokens.service.js';

const INVALID_CREDENTIALS = 'Invalid email or password';
const INVALID_REFRESH_TOKEN = 'Invalid or expired refresh token';

type RefreshOutcome =
  | { kind: 'ok'; tokens: AuthTokensDto }
  | { kind: 'invalid' }
  | { kind: 'reused'; userId: string };

@Injectable()
export class AuthService {
  // Hash verified when the email is unknown, so response time doesn't reveal
  // which emails exist.
  private dummyHash?: Promise<string>;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
    private readonly refreshTokens: RefreshTokensService,
    private readonly auditService: AuditService,
  ) {}

  async login(dto: LoginDto, ip: string | null): Promise<LoginResponseDto> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .getOne();

    const passwordOk = user
      ? await verifyPassword(user.passwordHash, dto.password)
      : await this.burnPasswordCheck(dto.password);

    if (!user || !passwordOk) {
      await this.logLoginFailure(
        user?.id ?? null,
        email,
        'INVALID_CREDENTIALS',
        ip,
      );
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (!user.isActive) {
      await this.logLoginFailure(user.id, email, 'ACCOUNT_INACTIVE', ip);
      throw new ForbiddenException('This account is deactivated');
    }

    return this.dataSource.transaction(async (manager) => {
      user.lastLoginAt = new Date();
      await manager.getRepository(User).update(user.id, {
        lastLoginAt: user.lastLoginAt,
      });
      const tokens = await this.issueTokens(user, manager);
      await this.auditService.log(
        {
          userId: user.id,
          action: AuditAction.LOGIN,
          entityType: AuditEntityType.USER,
          entityId: user.id,
          ip,
        },
        manager,
      );
      return { ...tokens, user: UserResponseDto.fromEntity(user) };
    });
  }

  /**
   * Rotates a refresh token: the presented token is revoked and replaced.
   * Presenting an already-revoked token means it was stolen or replayed, so
   * every token of that user is revoked (forcing a fresh login).
   */
  async refresh(token: string, ip: string | null): Promise<AuthTokensDto> {
    const outcome = await this.dataSource.transaction(
      async (manager): Promise<RefreshOutcome> => {
        const stored = await this.refreshTokens.findByTokenForUpdate(
          token,
          manager,
        );
        if (!stored) return { kind: 'invalid' };

        if (stored.revokedAt) {
          await this.refreshTokens.revokeAllForUser(stored.userId, manager);
          await this.auditService.log(
            {
              userId: stored.userId,
              action: AuditAction.REFRESH_TOKEN_REUSE_DETECTED,
              entityType: AuditEntityType.USER,
              entityId: stored.userId,
              newValues: { refreshTokenId: stored.id },
              ip,
            },
            manager,
          );
          return { kind: 'reused', userId: stored.userId };
        }

        if (stored.expiresAt.getTime() <= Date.now()) {
          return { kind: 'invalid' };
        }

        const user = await manager
          .getRepository(User)
          .findOneBy({ id: stored.userId });
        if (!user?.isActive) {
          await this.refreshTokens.revokeAllForUser(stored.userId, manager);
          return { kind: 'invalid' };
        }

        const tokens = await this.issueTokens(user, manager, stored.id);
        return { kind: 'ok', tokens };
      },
    );

    // Thrown after commit so revocations above are persisted.
    if (outcome.kind !== 'ok') {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
    }
    return outcome.tokens;
  }

  // Idempotent: unknown or already revoked tokens are silently ignored.
  async logout(token: string, ip: string | null): Promise<void> {
    const userId = await this.refreshTokens.revokeToken(token);
    if (userId) {
      await this.auditService.log({
        userId,
        action: AuditAction.LOGOUT,
        entityType: AuditEntityType.USER,
        entityId: userId,
        ip,
      });
    }
  }

  async me(actor: Actor): Promise<UserResponseDto> {
    const user = actor.userId
      ? await this.users.findOneBy({ id: actor.userId })
      : null;
    if (!user) throw new NotFoundException('User not found');
    return UserResponseDto.fromEntity(user);
  }

  private async issueTokens(
    user: User,
    manager: EntityManager,
    rotatedTokenId?: string,
  ): Promise<AuthTokensDto> {
    const payload: JwtPayload = { sub: user.id, role: user.role };
    const accessToken = await this.jwtService.signAsync(payload);
    const refresh = await this.refreshTokens.issue(user.id, manager);
    if (rotatedTokenId) {
      await this.refreshTokens.markRotated(
        rotatedTokenId,
        refresh.entity.id,
        manager,
      );
    }
    return {
      tokenType: 'Bearer',
      accessToken,
      accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: refresh.token,
      refreshTokenExpiresAt: refresh.entity.expiresAt,
    };
  }

  private async burnPasswordCheck(password: string): Promise<false> {
    this.dummyHash ??= hashPassword('timing-equalizer-not-a-real-password');
    await verifyPassword(await this.dummyHash, password);
    return false;
  }

  private logLoginFailure(
    userId: string | null,
    email: string,
    reason: 'INVALID_CREDENTIALS' | 'ACCOUNT_INACTIVE',
    ip: string | null,
  ): Promise<void> {
    // userId stays null: the caller is not authenticated. entityId points to
    // the targeted account when it exists.
    return this.auditService.log({
      userId: null,
      action: AuditAction.LOGIN_FAILED,
      entityType: AuditEntityType.USER,
      entityId: userId,
      newValues: { email, reason },
      ip,
    });
  }
}
