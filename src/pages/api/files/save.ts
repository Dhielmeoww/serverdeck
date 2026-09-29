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
    const { path, content } = body;

    if (!path) {
      return new Response(JSON.stringify({ error: 'File path required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await SSHManager.writeFile(sessionId, path, content ?? '');

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
        error: error.message || 'Failed to write file',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
