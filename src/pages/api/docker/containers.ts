import { body, dockerRoute } from '../../../lib/docker-api';
import { containerAction, listContainers } from '../../../lib/docker';

export const prerender = false;

export const GET = dockerRoute(async (sessionId) => ({ containers: await listContainers(sessionId) }));

/** { id, action: start | stop | restart | kill | pause | unpause | remove } */
export const POST = dockerRoute(async (sessionId, context) => {
  const { id, action } = await body(context);
  await containerAction(sessionId, id, String(action));
  return {};
});
