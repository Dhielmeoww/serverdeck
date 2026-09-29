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
    const formData = await context.request.formData();
    const file = formData.get('file') as File | null;
    const targetDir = (formData.get('directory') as string) || '/';

    if (!file || typeof file === 'string') {
      return new Response(JSON.stringify({ error: 'No valid file uploaded' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const filename = file.name;
    const cleanDir = targetDir.replace(/\\/g, '/');
    const remoteFilePath = cleanDir === '/' ? `/${filename}` : `${cleanDir}/${filename}`.replace(/\/+/g, '/');

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await SSHManager.writeFile(sessionId, remoteFilePath, buffer);

    return new Response(
      JSON.stringify({
        success: true,
        filename,
        path: remoteFilePath,
        size: buffer.length,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        error: error.message || 'Failed to upload file',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
