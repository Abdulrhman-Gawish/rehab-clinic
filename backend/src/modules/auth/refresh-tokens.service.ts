import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { REFRESH_TOKEN_TTL_DAYS } from './auth.constants.js';
import { RefreshToken } from './entities/refresh-token.entity.js';

const TTL_MS = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface IssuedRefreshToken {
  token: string;
  entity: RefreshToken;
}

// Storage and revocation of opaque refresh tokens. Raw tokens are only ever
// returned to the client; the DB keeps their SHA-256.
@Injectable()
export class RefreshTokensService {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
  ) {}

  static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async issue(
    userId: string,
    manager: EntityManager,
  ): Promise<IssuedRefreshToken> {
    const token = randomBytes(48).toString('base64url');
    const entity = await manager.getRepository(RefreshToken).save(
      manager.getRepository(RefreshToken).create({
        userId,
        tokenHash: RefreshTokensService.hash(token),
        expiresAt: new Date(Date.now() + TTL_MS),
        revokedAt: null,
        replacedById: null,
      }),
    );
    return { token, entity };
  }

  // Locks the token row so concurrent refreshes of the same token serialize.
  findByTokenForUpdate(
    token: string,
    manager: EntityManager,
  ): Promise<RefreshToken | null> {
    return manager.findOne(RefreshToken, {
      where: { tokenHash: RefreshTokensService.hash(token) },
      lock: { mode: 'pessimistic_write' },
    });
  }

  async markRotated(
    tokenId: string,
    replacedById: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager
      .getRepository(RefreshToken)
      .update(tokenId, { revokedAt: new Date(), replacedById });
  }

  // Revokes one token; returns its owner if it was still active.
  async revokeToken(token: string): Promise<string | null> {
    const result = await this.refreshTokens
      .createQueryBuilder()
      .update()
      .set({ revokedAt: () => 'now()' })
      .where('token_hash = :hash AND revoked_at IS NULL', {
        hash: RefreshTokensService.hash(token),
      })
      .returning(['userId'])
      .execute();
    const rows = result.raw as { user_id: string }[];
    return rows[0]?.user_id ?? null;
  }

  async revokeAllForUser(
    userId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const repository = manager
      ? manager.getRepository(RefreshToken)
      : this.refreshTokens;
    await repository.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }
}
