import type { APIRoute } from 'astro';
import {
  checkCredentials, clearFailures, createToken, loginEnabled, loginMisconfigured,
  lockedFor, recordFailure, setAppCookie,
} from '../../../lib/app-auth';

export const prerender = false;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async (context) => {
  if (!loginEnabled()) return json({ success: true });
  if (loginMisconfigured()) {
    return json({ error: 'Login aktif tetapi SECURITY_USERNAME / SECURITY_PASSWORD belum diatur di server.' }, 503);
  }

  const ip = context.clientAddress || 'unknown';
  const wait = lockedFor(ip);
  if (wait) return json({ error: `Terlalu banyak percobaan gagal. Coba lagi dalam ${Math.ceil(wait / 60)} menit.` }, 429);

  const body = await context.request.json().catch(() => ({}));
  const username = String(body.username ?? '');
  const password = String(body.password ?? '');

  if (!checkCredentials(username, password)) {
    recordFailure(ip);
    // Jeda kecil memperlambat tebak-tebakan otomatis.
    await new Promise((r) => setTimeout(r, 400));
    return json({ error: 'Username atau password salah.' }, 401);
  }

  clearFailures(ip);
  const { token, maxAge } = createToken(username);
  setAppCookie(context, token, maxAge);
  return json({ success: true });
};
