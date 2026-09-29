import type { APIRoute } from 'astro';
import { SSHManager } from '../../../lib/ssh-session';
import { getSessionId } from '../../../lib/auth-cookie';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const sessionId = getSessionId(context);
  if (!sessionId) {
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const session = SSHManager.getSession(sessionId);
  if (!session) {
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const system = await SSHManager.getSystemInfo(sessionId);

  return new Response(
    JSON.stringify({
      authenticated: true,
      user: {
        host: session.host,
        port: session.port,
        username: session.username,
        connectedAt: session.connectedAt,
      },
      system,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};
