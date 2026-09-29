import { body, dockerRoute } from '../../../lib/docker-api';
import { DockerError } from '../../../lib/docker';
import { attachConsole, closeConsole, openConsole, resizeConsole, writeConsole } from '../../../lib/docker-console';

export const prerender = false;

/** Output konsol sebagai stream byte mentah: ?console=<id> */
export const GET = dockerRoute(async (sessionId, context) => {
  const consoleId = context.url.searchParams.get('console') || '';
  let detach: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      detach = attachConsole(consoleId, sessionId, (chunk) => {
        try {
          if (chunk) controller.enqueue(new Uint8Array(chunk));
          else controller.close();
        } catch {
          // pembaca sudah pergi
        }
      });
    },
    cancel() {
      detach?.();
      closeConsole(consoleId, sessionId);
    },
  });

  // Tab ditutup / pindah halaman: kanal di server ikut ditutup.
  context.request.signal.addEventListener('abort', () => {
    detach?.();
    closeConsole(consoleId, sessionId);
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
});

/**
 *   { action: 'open', container, shell?, user?, cols, rows } → { console }
 *   { action: 'input', console, data }
 *   { action: 'resize', console, cols, rows }
 *   { action: 'close', console }
 */
export const POST = dockerRoute(async (sessionId, context) => {
  const input = await body(context);
  switch (input.action) {
    case 'open':
      return { console: await openConsole(sessionId, input.container, input) };
    case 'input':
      writeConsole(String(input.console), sessionId, String(input.data ?? ''));
      return {};
    case 'resize':
      resizeConsole(String(input.console), sessionId, Number(input.cols), Number(input.rows));
      return {};
    case 'close':
      closeConsole(String(input.console), sessionId);
      return {};
    default:
      throw new DockerError(`Aksi konsol tidak dikenal: ${input.action}`, 400);
  }
});
