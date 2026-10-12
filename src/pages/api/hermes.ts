import type { APIContext, APIRoute } from 'astro';
import { SSHManager } from '../../lib/ssh-session';
import { getSessionId } from '../../lib/auth-cookie';
import { channelResponse, chatStream, HermesError, hermesAction, hermesEnvKeys, hermesInfo, hermesPaths, logStream } from '../../lib/hermes';

export const prerender = false;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

function route(handler: (sessionId: string, context: APIContext) => Promise<Response | unknown>): APIRoute {
  return async (context) => {
    const sessionId = getSessionId(context);
    if (!sessionId || !SSHManager.getSession(sessionId)) return json({ error: 'Unauthorized: No active SSH session' }, 401);
    try {
      const result = await handler(sessionId, context);
      return result instanceof Response ? result : json({ success: true, ...(result as object) });
    } catch (error: any) {
      if (error instanceof HermesError) return json({ error: error.message, code: error.code }, error.status);
      return json({ error: error?.message || 'Permintaan Hermes gagal' }, 500);
    }
  };
}

/**
 *   ?view=info                        terpasang?, versi, lokasi data, file log
 *   ?view=env                         nama variabel di .env (nilai disamarkan)
 *   ?view=paths                       path absolut config.yaml / .env / logs
 *   ?view=logs&file=gateway.log&tail=300&follow=1   stream log
 */
export const GET = route(async (sessionId, context) => {
  const p = context.url.searchParams;
  const view = p.get('view') || 'info';
  if (view === 'info') return { info: await hermesInfo(sessionId) };
  if (view === 'env') return { env: await hermesEnvKeys(sessionId) };
  if (view === 'paths') return { paths: await hermesPaths(sessionId) };
  if (view === 'logs') {
    const channel = await logStream(sessionId, p.get('file') || '', Number(p.get('tail') || 300), p.get('follow') === '1');
    return channelResponse(channel, context.request.signal);
  }
  throw new HermesError(`View tidak dikenal: ${view}`, 400);
});

/**
 *   { action: 'status' | 'doctor' | 'gateway-restart' | ... }   perintah tetap, hasil JSON
 *   { action: 'chat', prompt, resume?, yolo?, streamJson?, maxTurns? }   stream output Hermes
 */
export const POST = route(async (sessionId, context) => {
  const body = await context.request.json().catch(() => ({}));
  if (body.action === 'chat') {
    const channel = await chatStream(sessionId, {
      prompt: String(body.prompt ?? ''),
      resume: body.resume ? String(body.resume) : undefined,
      yolo: Boolean(body.yolo),
      streamJson: Boolean(body.streamJson),
      maxTurns: Number(body.maxTurns) || undefined,
    });
    return channelResponse(channel, context.request.signal);
  }
  return { result: await hermesAction(sessionId, String(body.action ?? '')) };
});
