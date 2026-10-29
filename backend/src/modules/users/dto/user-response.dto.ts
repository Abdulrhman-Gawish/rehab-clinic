import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../../common/enums/user-role.enum.js';
import type { User } from '../entities/user.entity.js';

// Public shape of a user. Built field by field so password_hash can never leak.
export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Mona Adel' })
  name: string;

  @ApiProperty({ example: 'mona@clinic.com' })
  email: string;

  @ApiProperty({ nullable: true, type: String, example: '+201012345678' })
  phone: string | null;

  @ApiProperty({ enum: UserRole, enumName: 'UserRole' })
  role: UserRole;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ nullable: true, type: Date })
  lastLoginAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  static fromEntity(this: void, user: User): UserResponseDto {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
