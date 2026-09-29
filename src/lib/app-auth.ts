/**
 * Login aplikasi (lapisan sebelum login SSH), dikendalikan environment:
 *
 *   SECURITY_ENABLELOGIN   true | false (bawaan: false)
 *   SECURITY_USERNAME      username login web
 *   SECURITY_PASSWORD      password login web
 *   SECURITY_SECRET        opsional; kunci tanda tangan cookie. Tanpa ini dibuat
 *                          acak saat start, sehingga restart = semua orang logout.
 *   SECURITY_SESSION_HOURS opsional; masa berlaku login (bawaan 12 jam)
 *
 * Tanpa database dan tanpa penyimpanan sesi: cookie berisi username + waktu
 * kedaluwarsa yang ditandatangani HMAC. Mengganti password otomatis
 * membatalkan semua cookie lama karena password ikut membentuk kuncinya.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { APIContext, AstroCookies } from 'astro';

export const APP_COOKIE = 'sd_app_auth';

// Saat dev, muat .env ke process.env. Sengaja tidak memakai import.meta.env:
// Vite bisa menanam nilainya ke hasil build, sehingga password ikut masuk ke dist/.
if (import.meta.env.DEV) {
  try {
    // Ada di Node >= 20.12; @types/node terpasang belum memuatnya.
    (process as NodeJS.Process & { loadEnvFile?: (path?: string) => void }).loadEnvFile?.();
  } catch {
    // .env tidak ada: pakai environment yang tersedia.
  }
}

// Selalu dibaca saat runtime (Docker -e / compose / .env di dev).
function env(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === 'string' ? value : undefined;
}

const truthy = (value?: string) => ['1', 'true', 'yes', 'on'].includes((value || '').trim().toLowerCase());

const RANDOM_SECRET = randomBytes(32).toString('hex');

export function loginEnabled(): boolean {
  return truthy(env('SECURITY_ENABLELOGIN'));
}

/** Login diaktifkan tapi kredensial belum diisi: semua akses ditolak (fail closed). */
export function loginMisconfigured(): boolean {
  return loginEnabled() && (!env('SECURITY_USERNAME') || !env('SECURITY_PASSWORD'));
}

function sessionHours(): number {
  const hours = Number(env('SECURITY_SESSION_HOURS'));
  return Number.isFinite(hours) && hours > 0 ? Math.min(hours, 24 * 30) : 12;
}

function signingKey(): Buffer {
  const secret = env('SECURITY_SECRET') || RANDOM_SECRET;
  return createHash('sha256')
    .update(`${secret}\0${env('SECURITY_USERNAME') ?? ''}\0${env('SECURITY_PASSWORD') ?? ''}`)
    .digest();
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');

function sign(payload: string): string {
  return createHmac('sha256', signingKey()).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  // Bandingkan hash, bukan string mentah: panjang berbeda tidak bocor lewat waktu.
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function checkCredentials(username: string, password: string): boolean {
  if (loginMisconfigured()) return false;
  const userOk = safeEqual(username, env('SECURITY_USERNAME') || '');
  const passOk = safeEqual(password, env('SECURITY_PASSWORD') || '');
  return userOk && passOk;
}

export function createToken(username: string): { token: string; maxAge: number } {
  const maxAge = Math.round(sessionHours() * 3600);
  const payload = b64url(JSON.stringify({ u: username, exp: Date.now() + maxAge * 1000 }));
  return { token: `${payload}.${sign(payload)}`, maxAge };
}

export function verifyToken(token?: string): string | null {
  if (!token || loginMisconfigured()) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = sign(payload);
  if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return typeof data.u === 'string' ? data.u : null;
  } catch {
    return null;
  }
}

/** Cookie Secure bila diakses lewat HTTPS (langsung atau di balik reverse proxy). */
export function isSecureRequest(context: Pick<APIContext, 'url' | 'request'>): boolean {
  return context.url.protocol === 'https:' || context.request.headers.get('x-forwarded-proto')?.split(',')[0].trim() === 'https';
}

export function setAppCookie(context: APIContext, token: string, maxAge: number) {
  context.cookies.set(APP_COOKIE, token, {
    path: '/',
    httpOnly: true,
    // Lax: tetap terkirim saat membuka link/bookmark, tidak terkirim pada POST lintas situs.
    sameSite: 'lax',
    secure: isSecureRequest(context),
    maxAge,
  });
}

export function clearAppCookie(cookies: AstroCookies) {
  cookies.delete(APP_COOKIE, { path: '/' });
}

// ---------- Pembatas percobaan login (di memori) ----------

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000;
const attempts = new Map<string, { count: number; first: number }>();

/** Sisa detik terkunci, atau 0 bila boleh mencoba. */
export function lockedFor(ip: string): number {
  const entry = attempts.get(ip);
  if (!entry) return 0;
  if (Date.now() - entry.first > WINDOW_MS) {
    attempts.delete(ip);
    return 0;
  }
  return entry.count >= MAX_ATTEMPTS ? Math.ceil((entry.first + WINDOW_MS - Date.now()) / 1000) : 0;
}

export function recordFailure(ip: string) {
  const entry = attempts.get(ip);
  if (!entry || Date.now() - entry.first > WINDOW_MS) attempts.set(ip, { count: 1, first: Date.now() });
  else entry.count++;
}

export function clearFailures(ip: string) {
  attempts.delete(ip);
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of attempts) if (now - entry.first > WINDOW_MS) attempts.delete(ip);
}, WINDOW_MS).unref?.();
