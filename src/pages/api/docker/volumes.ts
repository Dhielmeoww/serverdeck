import { body, dockerRoute } from '../../../lib/docker-api';
import { listVolumes, volumeAction } from '../../../lib/docker';

export const prerender = false;

export const GET = dockerRoute(async (sessionId) => ({ volumes: await listVolumes(sessionId) }));

/** { action: remove | prune, name } */
export const POST = dockerRoute(async (sessionId, context) => {
  const { action, name } = await body(context);
  const output = await volumeAction(sessionId, String(action), String(name ?? ''));
  return { output: String(output || '').trim().slice(-3000) };
});
