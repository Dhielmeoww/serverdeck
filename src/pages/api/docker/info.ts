import { dockerRoute } from '../../../lib/docker-api';
import { dockerInfo } from '../../../lib/docker';

export const prerender = false;

export const GET = dockerRoute(async (sessionId) => ({ info: await dockerInfo(sessionId) }));
