import { ApiProperty } from '@nestjs/swagger';
import type { User } from '../../modules/users/entities/user.entity.js';

type UserLike = Pick<User, 'id' | 'name'>;

// "Who did it" in responses, so clients without access to /users (e.g. a
// RECEPTIONIST) can show a name.
export class UserRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Mona Adel' })
  name: string;

  // The relation must be loaded.
  static fromEntity(this: void, user: UserLike | null | undefined): UserRefDto {
    if (!user) throw new Error('User relation is not loaded');
    return { id: user.id, name: user.name };
  }

  // Optional relations (not voided yet, public or system actions).
  static fromNullable(
    this: void,
    user: UserLike | null | undefined,
  ): UserRefDto | null {
    return user ? { id: user.id, name: user.name } : null;
  }
}
