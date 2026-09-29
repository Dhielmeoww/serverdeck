import { body, dockerRoute } from '../../../lib/docker-api';
import { composeRecreate, deploySpec, DockerError, specFromContainer } from '../../../lib/docker';
import { emptySpec, type RunSpec } from '../../../lib/docker-spec';

export const prerender = false;

/**
 * Recreate, edit, atau duplikat container.
 *
 *   { id, pull }                         recreate dengan konfigurasi sekarang
 *                                        (container compose lewat docker compose)
 *   { id, pull, spec, mode: 'replace' }  edit: ganti dengan konfigurasi baru
 *   { id, pull, spec, mode: 'duplicate'} buat salinan, container lama tetap
 */
export const POST = dockerRoute(async (sessionId, context) => {
  const input = await body(context);
  const id = String(input.id || '');
  const pull = Boolean(input.pull);
  const mode = input.mode === 'duplicate' ? 'duplicate' : 'replace';

  if (input.spec) {
    // Lengkapi field yang tidak dikirim supaya bentuknya selalu utuh.
    const spec: RunSpec = { ...emptySpec(), ...input.spec };
    return { result: await deploySpec(sessionId, id, spec, { pull, mode }) };
  }

  if (mode === 'duplicate') throw new DockerError('Duplikat membutuhkan konfigurasi container', 400);

  const current = await specFromContainer(sessionId, id);
  if (current.compose && input.strategy !== 'run') {
    return { result: await composeRecreate(sessionId, current.compose, pull), strategy: 'compose' };
  }
  return { result: await deploySpec(sessionId, id, current.spec, { pull, mode: 'replace' }), strategy: 'run' };
});
