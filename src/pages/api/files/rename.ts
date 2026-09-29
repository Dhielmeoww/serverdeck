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
    const { oldPath, newPath } = body;

    if (!oldPath || !newPath) {
      return new Response(JSON.stringify({ error: 'Both oldPath and newPath are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await SSHManager.renamePath(sessionId, oldPath, newPath);

    return new Response(
      JSON.stringify({
        success: true,
        oldPath,
        newPath,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        error: error.message || 'Failed to rename item',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
