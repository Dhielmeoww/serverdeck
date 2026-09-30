import type { APIRoute } from 'astro';
import { dataDir, dataDirIsMounted, storageMode } from '../../../lib/config';
import { loginEnabled } from '../../../lib/app-auth';

export const prerender = false;

/** Mode penyimpanan untuk browser: menentukan pipeline & koneksi dibaca dari mana. */
export const GET: APIRoute = () => {
  const mode = storageMode();
  return new Response(
    JSON.stringify({
      success: true,
      storageMode: mode,
      loginEnabled: loginEnabled(),
      // Password SSH hanya boleh disimpan bila login web aktif.
      canStoreSecrets: mode === 'database' && loginEnabled(),
      dataDir: mode === 'database' ? dataDir() : null,
      dataMounted: mode === 'database' ? dataDirIsMounted() : null,
    }),
    { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  );
};
