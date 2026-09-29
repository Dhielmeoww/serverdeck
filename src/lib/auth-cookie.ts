import type { APIContext } from 'astro';
import { isSecureRequest } from './app-auth';

export const SESSION_COOKIE_NAME = 'ssh_session_token';

export function getSessionId(context: APIContext): string | null {
  const cookie = context.cookies.get(SESSION_COOKIE_NAME);
  if (cookie && cookie.value) {
    return cookie.value;
  }
  // Also support Authorization header
  const authHeader = context.request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  return null;
}

export function setSessionCookie(context: APIContext, sessionId: string) {
  context.cookies.set(SESSION_COOKIE_NAME, sessionId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    // Secure otomatis bila diakses lewat HTTPS; tetap jalan di http://localhost.
    secure: isSecureRequest(context),
    maxAge: 60 * 60 * 24, // 24 hours
  });
}

export function clearSessionCookie(context: APIContext) {
  context.cookies.delete(SESSION_COOKIE_NAME, {
    path: '/',
  });
}
