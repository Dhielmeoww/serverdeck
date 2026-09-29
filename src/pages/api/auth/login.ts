import type { APIRoute } from 'astro';
import { SSHManager } from '../../../lib/ssh-session';
import { setSessionCookie } from '../../../lib/auth-cookie';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  try {
    const body = await context.request.json();
    const { host, port, username, password, privateKey, passphrase } = body;

    if (!host || !username) {
      return new Response(JSON.stringify({ error: 'Host and Username are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!password && !privateKey) {
      return new Response(JSON.stringify({ error: 'Password or Private Key is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { sessionId, sessionInfo } = await SSHManager.createSession({
      host: host.trim(),
      port: port ? parseInt(port, 10) : 22,
      username: username.trim(),
      password: password ? String(password) : undefined,
      privateKey: privateKey ? String(privateKey).trim() : undefined,
      passphrase: passphrase ? String(passphrase) : undefined,
    });

    setSessionCookie(context, sessionId);

    // Fetch initial system info
    const sysInfo = await SSHManager.getSystemInfo(sessionId);

    return new Response(
      JSON.stringify({
        success: true,
        sessionId,
        user: sessionInfo,
        system: sysInfo,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('Login error:', error);
    return new Response(
      JSON.stringify({
        error: error.message || 'Failed to connect to SSH server',
      }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
