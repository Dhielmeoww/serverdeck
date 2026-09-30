import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { dbRoute } from '../../../lib/db-api';
import { backupTo } from '../../../lib/db';

export const prerender = false;

/**
 * Unduh salinan database. Password di dalamnya tetap terenkripsi; untuk
 * membukanya di server lain dibutuhkan SECURITY_SECRET (atau file .secret-key) yang sama.
 */
export const GET = dbRoute(() => {
  const file = join(tmpdir(), `serverdeck-backup-${randomBytes(6).toString('hex')}.db`);
  try {
    backupTo(file);
    const data = readFileSync(file);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': 'application/vnd.sqlite3',
        'Content-Disposition': `attachment; filename="serverdeck-${stamp}.db"`,
        'Cache-Control': 'no-store',
      },
    });
  } finally {
    rmSync(file, { force: true });
  }
});
