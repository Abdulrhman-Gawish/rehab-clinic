import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import { ToLowerCaseTrimmed } from '../../../common/decorators/transform.decorators.js';
import { UserResponseDto } from '../../users/dto/user.dto.js';

export class LoginDto {
  @ApiProperty({ example: 'owner@clinic.local' })
  @ToLowerCaseTrimmed()
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'change-me-please' })
  @IsString()
  @Length(1, 128)
  password: string;
}

export class RefreshTokenDto {
  @ApiProperty({ description: 'Refresh token returned by login/refresh' })
  @IsString()
  @Length(20, 200)
  refreshToken: string;
}

export class AuthTokensDto {
  @ApiProperty({ example: 'Bearer' })
  tokenType: 'Bearer';

  @ApiProperty({ description: 'JWT, send as "Authorization: Bearer <token>"' })
  accessToken: string;

  @ApiProperty({
    example: 900,
    description: 'Access token lifetime in seconds',
  })
  accessTokenExpiresIn: number;

  @ApiProperty({
    description: 'Opaque, single use. Each refresh returns a new one.',
  })
  refreshToken: string;

  @ApiProperty()
  refreshTokenExpiresAt: Date;
}

export class LoginResponseDto extends AuthTokensDto {
  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;
}
