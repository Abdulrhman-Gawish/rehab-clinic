import type { CookieOptions, Request, Response } from 'express';
import { API_PREFIX } from '../../app.setup.js';

// Browsers keep the tokens in HttpOnly cookies, so page scripts never see them.
// Secure: sent over https only (browsers treat http://localhost as secure).
// SameSite=Strict + a required X-Requested-With header stop CSRF: a page on
// another origin can't send that header without a CORS preflight, and CORS
// never allows credentials.
export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';
export const CSRF_HEADER = 'x-requested-with';

const BASE: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
};
const ACCESS_PATH = `/${API_PREFIX}`;
// The refresh token only travels to /auth (refresh, logout).
const REFRESH_PATH = `/${API_PREFIX}/auth`;

export function setAuthCookies(
  res: Response,
  tokens: {
    accessToken: string;
    accessTokenExpiresIn: number;
    refreshToken: string;
    refreshTokenExpiresAt: Date;
  },
): void {
  res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...BASE,
    path: ACCESS_PATH,
    maxAge: tokens.accessTokenExpiresIn * 1000,
  });
  res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...BASE,
    path: REFRESH_PATH,
    expires: tokens.refreshTokenExpiresAt,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_TOKEN_COOKIE, { ...BASE, path: ACCESS_PATH });
  res.clearCookie(REFRESH_TOKEN_COOKIE, { ...BASE, path: REFRESH_PATH });
}

/** A cookie's value, only when the request carries the CSRF header. */
export function readAuthCookie(req: Request, name: string): string | null {
  if (!req.headers[CSRF_HEADER]) return null;
  for (const part of req.headers.cookie?.split(';') ?? []) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim()) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}
