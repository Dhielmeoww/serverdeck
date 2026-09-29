import type { APIRoute } from 'astro';
import { SSHManager } from '../../lib/ssh-session';
import { getSessionId } from '../../lib/auth-cookie';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const sessionId = getSessionId(context);
  if (!sessionId || !SSHManager.getSession(sessionId)) {
    return new Response(JSON.stringify({ error: 'Unauthorized: No active SSH session' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await context.request.json();
    const { command } = body;
    // Default 10 menit, maksimum 1 jam. 0 dari klien tetap dibatasi default.
    const requested = Number(body.timeoutSec);
    const timeoutSec = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 3600) : 600;

    if (command === undefined || command === null) {
      return new Response(JSON.stringify({ error: 'Command is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Folder kerja dan sudo dibungkus di server karena sintaksnya berbeda per shell
    // (sh, cmd.exe, PowerShell). Password sudo hanya lewat stdin, tidak dicatat.
    const sudo = ['none', 'nonInteractive', 'password'].includes(body.sudo) ? body.sudo : 'none';
    const result = await SSHManager.run(sessionId, String(command), {
      timeoutMs: timeoutSec * 1000,
      cwd: typeof body.cwd === 'string' && body.cwd.startsWith('/') ? body.cwd : undefined,
      sudo,
      sudoPassword: sudo === 'password' ? String(body.sudoPassword ?? '') : undefined,
      trackCwd: Boolean(body.trackCwd),
    });

    return new Response(
      JSON.stringify({
        success: true,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        timedOut: Boolean(result.timedOut),
        cwd: 'cwd' in result ? result.cwd : undefined,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        error: error.message || 'Failed to execute command',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
