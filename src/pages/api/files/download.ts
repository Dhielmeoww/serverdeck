import type { APIRoute } from 'astro';
import { SSHManager } from '../../../lib/ssh-session';
import { getSessionId } from '../../../lib/auth-cookie';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const sessionId = getSessionId(context);
  if (!sessionId || !SSHManager.getSession(sessionId)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(context.request.url);
  const filePath = url.searchParams.get('path');

  if (!filePath) {
    return new Response('File path parameter required', { status: 400 });
  }

  try {
    const filename = filePath.split('/').filter(Boolean).pop() || 'download';
    const buffer = await SSHManager.readFileBuffer(sessionId, filePath);

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Content-Length': buffer.length.toString(),
      },
    });
  } catch (error: any) {
    return new Response(error.message || 'Failed to download file', {
      status: 500,
    });
  }
};
