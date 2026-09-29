import { dockerRoute } from '../../../lib/docker-api';
import { assertId, dockerAccess } from '../../../lib/docker';
import { SSHManager, shellQuote } from '../../../lib/ssh-session';

export const prerender = false;

/**
 * Log container sebagai stream teks: ?id=...&tail=200&timestamps=1&follow=1
 * Dengan follow, respons tetap terbuka dan log baru langsung dikirim;
 * menutup request di browser menutup kanal SSH-nya.
 */
export const GET = dockerRoute(async (sessionId, context) => {
  const params = context.url.searchParams;
  const id = assertId(params.get('id'));
  const tailParam = params.get('tail') || '200';
  const tail = tailParam === 'all' ? 'all' : String(Math.min(100_000, Math.max(1, Number(tailParam) || 200)));
  const args = ['logs', '--tail', tail];
  if (params.get('timestamps') === '1') args.push('--timestamps');
  if (params.get('follow') === '1') args.push('--follow');
  args.push(id);

  const { prefix } = await dockerAccess(sessionId);
  const channel = await SSHManager.openChannel(sessionId, `${prefix} ${args.map(shellQuote).join(' ')}`);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (chunk: Buffer) => {
        try {
          controller.enqueue(new Uint8Array(chunk));
        } catch {
          // stream sudah ditutup pembaca
        }
      };
      channel.on('data', push);
      channel.stderr.on('data', push);
      channel.on('close', () => {
        try {
          controller.close();
        } catch {
          // sudah tertutup
        }
      });
    },
    cancel() {
      channel.close();
    },
  });

  context.request.signal.addEventListener('abort', () => channel.close());

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      // Nginx: jangan tahan stream di buffer.
      'X-Accel-Buffering': 'no',
    },
  });
});
