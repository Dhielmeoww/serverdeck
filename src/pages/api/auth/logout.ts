import type { APIRoute } from 'astro';
import { SSHManager } from '../../../lib/ssh-session';
import { getSessionId, clearSessionCookie } from '../../../lib/auth-cookie';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const sessionId = getSessionId(context);
  if (sessionId) {
    SSHManager.closeSession(sessionId);
  }
  clearSessionCookie(context);

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
