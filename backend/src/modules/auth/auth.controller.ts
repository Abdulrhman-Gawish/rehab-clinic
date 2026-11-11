import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Patch,
  Post,
  Req,
  Res,
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
import type { Request, Response } from 'express';
import { CurrentActor } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { ThrottleLogin } from '../../common/decorators/throttle.decorators.js';
import { ErrorResponseDto } from '../../common/dto/error-response.dto.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import {
  clearAuthCookies,
  readAuthCookie,
  REFRESH_TOKEN_COOKIE,
  setAuthCookies,
} from '../../common/utils/auth-cookies.util.js';
import { AuthService } from './auth.service.js';
import {
  AuthSessionDto,
  AuthUserDto,
  LoginDto,
  LoginResponseDto,
  UpdateMeDto,
} from './dto/auth.dto.js';

const COOKIE_NOTE =
  'The tokens are set as HttpOnly cookies (access_token, refresh_token) and never appear in the body. Browser requests must send the X-Requested-With header for the cookies to count.';

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
  @ApiOperation({
    summary: 'Log in with email + password',
    description: COOKIE_NOTE,
  })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Account deactivated',
  })
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const { accessToken, refreshToken, ...session } =
      await this.authService.login(dto, ip);
    setAuthCookies(res, { accessToken, refreshToken, ...session });
    return session;
  }

  @Post('refresh')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Exchange the refresh_token cookie for a new token pair (rotation)',
    description:
      'The presented refresh token is revoked and new cookies are set (refresh token valid 7 days). A token rotated less than 30 s ago answers 401 REFRESH_RACE: another tab already refreshed, so just retry the request. Re-using an older revoked token revokes every session of that user.',
  })
  @ApiOkResponse({ type: AuthSessionDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async refresh(
    @Req() req: Request,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionDto> {
    const { accessToken, refreshToken, ...session } =
      await this.authService.refresh(
        readAuthCookie(req, REFRESH_TOKEN_COOKIE),
        ip,
      );
    setAuthCookies(res, { accessToken, refreshToken, ...session });
    return session;
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Revoke the refresh_token cookie and clear both cookies (idempotent)',
  })
  @ApiNoContentResponse()
  async logout(
    @Req() req: Request,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logout(
      readAuthCookie(req, REFRESH_TOKEN_COOKIE),
      ip,
    );
    clearAuthCookies(res);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The logged in user' })
  @ApiOkResponse({ type: AuthUserDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  me(@CurrentActor() actor: Actor): Promise<AuthUserDto> {
    return this.authService.me(actor);
  }

  @Patch('me')
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Change the logged in user's own settings (UI language)",
    description:
      'Any logged in user, for their own account only (the id comes from the token). The language is stored on the account, so every device gets it from GET /auth/me or the login response.',
  })
  @ApiOkResponse({ type: AuthUserDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  updateMe(
    @CurrentActor() actor: Actor,
    @Body() dto: UpdateMeDto,
  ): Promise<AuthUserDto> {
    return this.authService.updateMe(actor, dto);
  }
}
