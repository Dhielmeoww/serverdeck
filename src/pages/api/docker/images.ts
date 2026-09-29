import { body, dockerRoute } from '../../../lib/docker-api';
import { imageAction, listImages } from '../../../lib/docker';

export const prerender = false;

export const GET = dockerRoute(async (sessionId) => ({ images: await listImages(sessionId) }));

/** { action: pull | remove | prune, ref } */
export const POST = dockerRoute(async (sessionId, context) => {
  const { action, ref } = await body(context);
  const output = await imageAction(sessionId, String(action), String(ref ?? ''));
  return { output: String(output || '').trim().slice(-3000) };
});
