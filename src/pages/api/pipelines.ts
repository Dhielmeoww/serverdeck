import { dbRoute, readBody } from '../../lib/db-api';
import { deletePipeline, listPipelines, upsertPipeline, type StoredPipeline } from '../../lib/db';

export const prerender = false;

export const GET = dbRoute(() => ({ pipelines: listPipelines() }));

/**
 *   { action: 'save', pipeline }        simpan / perbarui satu pipeline
 *   { action: 'import', pipelines: [] } simpan banyak sekaligus (pindah dari browser)
 *   { action: 'delete', id }
 */
export const POST = dbRoute(async (context) => {
  const body = await readBody(context);
  const valid = (p: any): p is StoredPipeline => p && typeof p.id === 'string' && /^[\w-]{4,64}$/.test(p.id) && Array.isArray(p.steps);

  if (body.action === 'save') {
    if (!valid(body.pipeline)) throw Object.assign(new Error('Data pipeline tidak valid'), { status: 400 });
    upsertPipeline(body.pipeline);
    return {};
  }
  if (body.action === 'import') {
    const list = (Array.isArray(body.pipelines) ? body.pipelines : []).filter(valid);
    for (const p of list) upsertPipeline(p);
    return { imported: list.length };
  }
  if (body.action === 'delete') {
    deletePipeline(String(body.id ?? ''));
    return {};
  }
  throw Object.assign(new Error(`Aksi tidak dikenal: ${body.action}`), { status: 400 });
});
