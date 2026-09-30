import { dbRoute, readBody } from '../../lib/db-api';
import { deleteConnection, forgetConnectionSecret, listConnections, renameConnection } from '../../lib/db';

export const prerender = false;

/** Daftar koneksi tersimpan. Tidak pernah berisi password / private key. */
export const GET = dbRoute(() => ({ connections: listConnections() }));

/**
 *   { action: 'rename', id, name }
 *   { action: 'forget-secret', id }   hapus password tersimpan, host tetap
 *   { action: 'delete', id }
 */
export const POST = dbRoute(async (context) => {
  const { action, id, name } = await readBody(context);
  const target = String(id ?? '');
  if (!target) throw Object.assign(new Error('ID koneksi wajib diisi'), { status: 400 });
  if (action === 'rename') renameConnection(target, String(name ?? ''));
  else if (action === 'forget-secret') forgetConnectionSecret(target);
  else if (action === 'delete') deleteConnection(target);
  else throw Object.assign(new Error(`Aksi tidak dikenal: ${action}`), { status: 400 });
  return {};
});
