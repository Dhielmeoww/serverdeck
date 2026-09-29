import type { APIRoute } from 'astro';
import { SSHManager } from '../../../lib/ssh-session';
import { getSessionId } from '../../../lib/auth-cookie';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const sessionId = getSessionId(context);
  if (!sessionId || !SSHManager.getSession(sessionId)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await context.request.json();
    const { path, isDirectory } = body;

    if (!path || path === '/' || path === '/root' || path === '/etc') {
      return new Response(JSON.stringify({ error: 'Invalid or protected path for deletion' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await SSHManager.deletePath(sessionId, path, Boolean(isDirectory));

    return new Response(
      JSON.stringify({
        success: true,
        path,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        error: error.message || 'Failed to delete item',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
