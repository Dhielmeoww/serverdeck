import type { APIContext, APIRoute } from 'astro';
import { SSHManager } from './ssh-session';
import { getSessionId } from './auth-cookie';
import { DockerError } from './docker';

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** Endpoint Docker: wajib sesi SSH, error DockerError diteruskan dengan status & kodenya. */
export function dockerRoute(handler: (sessionId: string, context: APIContext) => Promise<Response | unknown>): APIRoute {
  return async (context) => {
    const sessionId = getSessionId(context);
    if (!sessionId || !SSHManager.getSession(sessionId)) {
      return json({ error: 'Unauthorized: No active SSH session' }, 401);
    }
    try {
      const result = await handler(sessionId, context);
      return result instanceof Response ? result : json({ success: true, ...(result as object) });
    } catch (error: any) {
      if (error instanceof DockerError) return json({ error: error.message, code: error.code }, error.status);
      return json({ error: error?.message || 'Docker request gagal' }, 500);
    }
  };
}

export async function body(context: APIContext): Promise<Record<string, any>> {
  return context.request.json().catch(() => ({}));
}
