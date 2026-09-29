import type { APIRoute } from 'astro';
import { clearAppCookie } from '../../../lib/app-auth';
import { SSHManager } from '../../../lib/ssh-session';
import { clearSessionCookie, getSessionId } from '../../../lib/auth-cookie';

export const prerender = false;

/** Keluar dari aplikasi sekaligus menutup sesi SSH milik browser ini. */
export const POST: APIRoute = async (context) => {
  const sessionId = getSessionId(context);
  if (sessionId) SSHManager.closeSession(sessionId);
  clearSessionCookie(context);
  clearAppCookie(context.cookies);
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
