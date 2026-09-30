import type { APIContext } from 'astro';

/**
 * Sesi SSH dipegang per tab browser, bukan per cookie: cookie dipakai bersama
 * semua tab, sehingga login ke server B di tab lain akan membuat tab server A
 * diam-diam menjalankan perintah di server B.
 *
 * Browser menyimpan ID sesi di sessionStorage (terpisah per tab) dan
 * mengirimkannya lewat header X-SSH-Session. Untuk tautan biasa yang tidak bisa
 * membawa header (unduh file), dipakai parameter ?sshs=.
 */
export const SESSION_HEADER = 'x-ssh-session';
export const SESSION_QUERY = 'sshs';

// Cookie lama (versi sebelumnya); hanya dibersihkan, tidak dibaca lagi.
const LEGACY_COOKIE = 'ssh_session_token';

export function getSessionId(context: Pick<APIContext, 'request' | 'url'>): string | null {
  const header = context.request.headers.get(SESSION_HEADER);
  if (header) return header.trim();

  const query = context.url.searchParams.get(SESSION_QUERY);
  if (query) return query.trim();

  const authHeader = context.request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) return authHeader.substring(7).trim();
  return null;
}

export function clearLegacySessionCookie(context: APIContext) {
  context.cookies.delete(LEGACY_COOKIE, { path: '/' });
}
