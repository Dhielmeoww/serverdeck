import type { APIContext, APIRoute } from 'astro';
import { storageMode } from './config';

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/**
 * Endpoint data (mode database). Tidak butuh sesi SSH; aksesnya dijaga login
 * web di middleware bila SECURITY_ENABLELOGIN=true.
 */
export function dbRoute(handler: (context: APIContext) => Promise<unknown> | unknown): APIRoute {
  return async (context) => {
    if (storageMode() !== 'database') {
      return json({ error: 'Mode database tidak aktif. Set STORAGE_MODE=database dan pasang volume /data.', code: 'browser_mode' }, 400);
    }
    try {
      const result = await handler(context);
      return result instanceof Response ? result : json({ success: true, ...(result as object) });
    } catch (error: any) {
      return json({ error: error?.message || 'Operasi database gagal' }, error?.status || 500);
    }
  };
}

export async function readBody(context: APIContext): Promise<Record<string, any>> {
  return context.request.json().catch(() => ({}));
}
