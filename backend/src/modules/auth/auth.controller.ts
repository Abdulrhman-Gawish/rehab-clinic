import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentActor } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { ThrottleLogin } from '../../common/decorators/throttle.decorators.js';
import { ErrorResponseDto } from '../../common/dto/error-response.dto.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { AuthService } from './auth.service.js';
import {
  AuthTokensDto,
  AuthUserDto,
  LoginDto,
  LoginResponseDto,
  RefreshTokenDto,
} from './dto/auth.dto.js';

@ApiTags('Auth')
@Controller('auth')
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiTooManyRequestsResponse({ type: ErrorResponseDto })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @Public()
  @ThrottleLogin()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with email + password' })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Account deactivated',
  })
  login(@Body() dto: LoginDto, @Ip() ip: string): Promise<LoginResponseDto> {
    return this.authService.login(dto, ip);
  }

  @Post('refresh')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange a refresh token for a new token pair (rotation)',
    description:
      'The presented refresh token is revoked. Re-using a revoked token revokes every session of that user.',
  })
  @ApiOkResponse({ type: AuthTokensDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  refresh(
    @Body() dto: RefreshTokenDto,
    @Ip() ip: string,
  ): Promise<AuthTokensDto> {
    return this.authService.refresh(dto.refreshToken, ip);
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a refresh token (idempotent)' })
  @ApiNoContentResponse()
  logout(@Body() dto: RefreshTokenDto, @Ip() ip: string): Promise<void> {
    return this.authService.logout(dto.refreshToken, ip);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The logged in user' })
  @ApiOkResponse({ type: AuthUserDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  me(@CurrentActor() actor: Actor): Promise<AuthUserDto> {
    return this.authService.me(actor);
  }
}
