import { defineMiddleware } from 'astro:middleware';
import { APP_COOKIE, loginEnabled, verifyToken } from './lib/app-auth';

// Boleh diakses tanpa login aplikasi.
// Logout publik: hanya menghapus cookie milik pemanggil, tetap berguna saat login sudah kedaluwarsa.
const PUBLIC_PATHS = new Set(['/login', '/api/app-auth/login', '/api/app-auth/logout', '/api/health']);

/**
 * Gerbang login aplikasi. Aktif hanya bila SECURITY_ENABLELOGIN=true; saat
 * aktif, semua halaman dan API (termasuk login SSH) butuh cookie yang valid.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;

  if (!loginEnabled()) {
    if (path === '/login') return context.redirect('/');
    return next();
  }

  if (path.startsWith('/_astro/') || path === '/favicon.ico') return next();

  const user = verifyToken(context.cookies.get(APP_COOKIE)?.value);
  context.locals.appUser = user ?? undefined;

  if (PUBLIC_PATHS.has(path)) {
    if (path === '/login' && user) return context.redirect('/');
    return next();
  }

  if (user) return next();

  if (path.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'Login aplikasi diperlukan', appLogin: true }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return context.redirect('/login');
});
