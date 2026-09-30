import type { APIRoute } from 'astro';
import { SSHManager } from '../../../lib/ssh-session';
import { clearLegacySessionCookie } from '../../../lib/auth-cookie';
import { storageMode } from '../../../lib/config';
import { getConnectionSecret, saveConnection, touchConnection } from '../../../lib/db';
import { loginEnabled } from '../../../lib/app-auth';

export const prerender = false;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Buka sesi SSH untuk tab ini.
 *
 *   { host, port, username, password | privateKey, passphrase?, save? }
 *   { connectionId, password? }   koneksi tersimpan (mode database); password
 *                                 tersimpan dibuka di server, tidak pernah ke browser.
 *
 * save: { storeSecret: boolean, name?: string } menyimpan koneksi setelah login
 * berhasil. Menyimpan password hanya diizinkan bila login web aktif, supaya
 * orang yang sekadar tahu alamat ServerDeck tidak bisa memakai password tersimpan.
 */
export const POST: APIRoute = async (context) => {
  try {
    const body = await context.request.json();
    const dbMode = storageMode() === 'database';

    let host = String(body.host ?? '').trim();
    let port = Number(body.port) || 22;
    let username = String(body.username ?? '').trim();
    let password: string | undefined = body.password ? String(body.password) : undefined;
    let privateKey: string | undefined = body.privateKey ? String(body.privateKey).trim() : undefined;
    let passphrase: string | undefined = body.passphrase ? String(body.passphrase) : undefined;
    const connectionId = body.connectionId ? String(body.connectionId) : '';

    if (connectionId) {
      if (!dbMode) return json({ error: 'Koneksi tersimpan hanya tersedia di mode database' }, 400);
      const saved = getConnectionSecret(connectionId);
      if (!saved) return json({ error: 'Koneksi tersimpan tidak ditemukan' }, 404);
      host = saved.host;
      port = saved.port;
      username = saved.username;
      // Password yang diketik saat ini menang atas yang tersimpan.
      if (!password && !privateKey) {
        password = saved.password;
        privateKey = saved.privateKey;
        passphrase = saved.passphrase;
      }
    }

    if (!host || !username) return json({ error: 'Host dan username wajib diisi' }, 400);
    if (!password && !privateKey) {
      return json({ error: connectionId ? 'Password untuk koneksi ini tidak tersimpan. Isi password lalu coba lagi.' : 'Password atau private key wajib diisi' }, 400);
    }

    const { sessionId, sessionInfo } = await SSHManager.createSession({ host, port, username, password, privateKey, passphrase });
    clearLegacySessionCookie(context);

    let savedId: string | undefined;
    let secretStored = false;
    if (dbMode && (body.save || connectionId)) {
      const storeSecret = Boolean(body.save?.storeSecret) && loginEnabled();
      if (body.save) {
        savedId = saveConnection({ host, port, username, password, privateKey, passphrase, name: body.save.name, storeSecret });
        secretStored = storeSecret;
      } else {
        touchConnection(connectionId);
        savedId = connectionId;
      }
    }

    const system = await SSHManager.getSystemInfo(sessionId);
    return json({
      success: true,
      sessionId,
      user: sessionInfo,
      system,
      connectionId: savedId,
      secretStored,
      secretRefused: Boolean(body.save?.storeSecret) && dbMode && !loginEnabled(),
    });
  } catch (error: any) {
    console.error('Login error:', error?.message || error);
    return json({ error: error.message || 'Failed to connect to SSH server' }, 401);
  }
};
