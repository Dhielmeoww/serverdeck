import { dbRoute } from '../../../lib/db-api';
import { databaseInfo, listConnections, listPipelines } from '../../../lib/db';
import { dataDirIsMounted } from '../../../lib/config';
import { keySource } from '../../../lib/crypto';

export const prerender = false;

/** Ringkasan isi database untuk halaman Data. Nilai terenkripsi tidak ditampilkan. */
export const GET = dbRoute(() => ({
  info: databaseInfo(),
  keySource: keySource(),
  mounted: dataDirIsMounted(),
  connections: listConnections(),
  pipelines: listPipelines().map((p) => ({
    id: p.id,
    name: p.name,
    steps: p.steps.length,
    variables: p.variables.length,
    runs: p.runs.length,
    updatedAt: p.updatedAt,
  })),
}));
