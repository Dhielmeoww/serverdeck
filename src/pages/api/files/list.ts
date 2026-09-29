import type { APIRoute } from 'astro';
import { SSHManager } from '../../../lib/ssh-session';
import { getSessionId } from '../../../lib/auth-cookie';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const sessionId = getSessionId(context);
  if (!sessionId || !SSHManager.getSession(sessionId)) {
    return new Response(JSON.stringify({ error: 'Unauthorized: Session expired or invalid' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(context.request.url);
  const targetPath = url.searchParams.get('path') || '/';

  try {
    const items = await SSHManager.listDirectory(sessionId, targetPath);
    return new Response(
      JSON.stringify({
        path: targetPath,
        items,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        error: error.message || 'Failed to list directory',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
