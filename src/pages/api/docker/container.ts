import { dockerRoute } from '../../../lib/docker-api';
import { containerStats, DockerError, inspectContainer, specFromContainer } from '../../../lib/docker';

export const prerender = false;

/** ?id=...&view=inspect | stats | spec */
export const GET = dockerRoute(async (sessionId, context) => {
  const id = context.url.searchParams.get('id') || '';
  const view = context.url.searchParams.get('view') || 'inspect';
  if (view === 'inspect') return { inspect: await inspectContainer(sessionId, id) };
  if (view === 'stats') return { stats: await containerStats(sessionId, id) };
  if (view === 'spec') return await specFromContainer(sessionId, id);
  throw new DockerError(`View tidak dikenal: ${view}`, 400);
});
