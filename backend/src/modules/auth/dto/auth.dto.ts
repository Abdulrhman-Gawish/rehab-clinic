import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsString, Length, MaxLength } from 'class-validator';
import { ToLowerCaseTrimmed } from '../../../common/decorators/transform.decorators.js';
import { Language } from '../../../common/enums/language.enum.js';
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

// The tokens themselves travel only in HttpOnly cookies (auth-cookies.util.ts).
export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export class AuthSessionDto {
  @ApiProperty({
    example: 900,
    description: 'Access token (access_token cookie) lifetime in seconds',
  })
  accessTokenExpiresIn: number;

  @ApiProperty({
    description:
      'When the refresh token (refresh_token cookie, single use) expires',
  })
  refreshTokenExpiresAt: Date;
}

// The logged-in user, plus the doctor profile id a doctor UI needs.
export class AuthUserDto extends UserResponseDto {
  @ApiProperty({
    format: 'uuid',
    nullable: true,
    type: String,
    description: 'The doctor profile id (DOCTOR accounts); null otherwise',
  })
  doctorId: string | null;
}

// The logged-in user's own settings; nobody can change another user's.
export class UpdateMeDto {
  @ApiProperty({ enum: Language, enumName: 'Language', example: Language.EN })
  @IsEnum(Language)
  preferredLanguage: Language;
}

export class LoginResponseDto extends AuthSessionDto {
  @ApiProperty({ type: AuthUserDto })
  user: AuthUserDto;
}
