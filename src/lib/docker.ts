/**
 * Manajemen Docker di server remote lewat CLI `docker` melalui SSH.
 * Tidak ada agent atau API tambahan: semua perintah sama dengan yang diketik
 * manual di terminal server.
 */
import { SSHManager, shellQuote } from './ssh-session';
import { emptySpec, specToArgs, validateSpec, type MountSpec, type PortMapping, type RunSpec } from './docker-spec';

export const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.:\/@-]*$/;

export class DockerError extends Error {
  constructor(message: string, public status = 500, public code?: string) {
    super(message);
  }
}

type ExecResult = { stdout: string; stderr: string; exitCode: number; timedOut?: boolean };

function session(sessionId: string) {
  const s = SSHManager.getSession(sessionId);
  if (!s) throw new DockerError('Tidak ada sesi SSH aktif', 401);
  return s;
}

/**
 * Menentukan cara memanggil docker: langsung, atau `sudo -n docker` bila user
 * tidak ada di grup docker tapi punya sudo tanpa password.
 */
export async function dockerAccess(sessionId: string, verify = false): Promise<{ prefix: string; version: string }> {
  const s = session(sessionId);
  if (s.platform === 'windows') {
    throw new DockerError('Manajemen Docker saat ini hanya untuk server Linux.', 400, 'windows');
  }

  // Hasil deteksi disimpan per sesi; hanya dicek ulang bila diminta (halaman ringkasan).
  if (s.dockerPrefix && !verify) return { prefix: s.dockerPrefix, version: '' };

  const probe = async (prefix: string) =>
    SSHManager.execCommand(sessionId, `${prefix} version --format '{{.Server.Version}}'`, 20_000);

  if (s.dockerPrefix) {
    const res = await probe(s.dockerPrefix);
    if (res.exitCode === 0) return { prefix: s.dockerPrefix, version: res.stdout.trim() };
    s.dockerPrefix = undefined;
  }

  const direct = await probe('docker');
  if (direct.exitCode === 0) {
    s.dockerPrefix = 'docker';
    return { prefix: 'docker', version: direct.stdout.trim() };
  }

  const err = `${direct.stderr}\n${direct.stdout}`;
  if (/not found|No such file/i.test(err) && !/daemon/i.test(err)) {
    throw new DockerError('Docker tidak terpasang di server ini.', 404, 'not_installed');
  }

  if (/permission denied/i.test(err)) {
    const viaSudo = await probe('sudo -n docker');
    if (viaSudo.exitCode === 0) {
      s.dockerPrefix = 'sudo -n docker';
      return { prefix: 'sudo -n docker', version: viaSudo.stdout.trim() };
    }
    throw new DockerError(
      `User ${s.username} tidak punya akses ke Docker. Tambahkan ke grup docker (sudo usermod -aG docker ${s.username}, lalu login ulang) atau izinkan "sudo docker" tanpa password.`,
      403,
      'permission',
    );
  }

  if (/Cannot connect to the Docker daemon|Is the docker daemon running/i.test(err)) {
    throw new DockerError('Docker terpasang tetapi daemon tidak berjalan (sudo systemctl start docker).', 503, 'daemon_down');
  }
  throw new DockerError(err.trim() || 'Docker tidak bisa dipanggil', 500);
}

/** Jalankan `docker <args...>`; semua argumen dikutip. */
export async function docker(sessionId: string, args: string[], timeoutMs = 60_000): Promise<ExecResult> {
  const { prefix } = await dockerAccess(sessionId);
  return SSHManager.execCommand(sessionId, `${prefix} ${args.map(shellQuote).join(' ')}`, timeoutMs);
}

export async function dockerOk(sessionId: string, args: string[], timeoutMs = 60_000): Promise<string> {
  const res = await docker(sessionId, args, timeoutMs);
  if (res.timedOut) throw new DockerError(`Perintah docker ${args[0]} melewati batas waktu`, 504);
  if (res.exitCode !== 0) throw new DockerError((res.stderr || res.stdout).trim() || `docker ${args[0]} gagal`, 400);
  return res.stdout;
}

function jsonLines<T = any>(stdout: string): T[] {
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as T;
      } catch {
        return null;
      }
    })
    .filter((x): x is T => x !== null);
}

export function assertId(id: unknown): string {
  const value = String(id ?? '');
  if (!ID_RE.test(value)) throw new DockerError('ID/nama tidak valid', 400);
  return value;
}

// ---------- Ringkasan ----------

export async function dockerInfo(sessionId: string) {
  const access = await dockerAccess(sessionId, true);
  const info = JSON.parse(await dockerOk(sessionId, ['info', '--format', '{{json .}}'], 30_000));
  return {
    version: access.version,
    viaSudo: access.prefix !== 'docker',
    containers: info.Containers ?? 0,
    running: info.ContainersRunning ?? 0,
    paused: info.ContainersPaused ?? 0,
    stopped: info.ContainersStopped ?? 0,
    images: info.Images ?? 0,
    os: info.OperatingSystem ?? '',
    cpus: info.NCPU ?? 0,
    memory: info.MemTotal ?? 0,
    rootDir: info.DockerRootDir ?? '',
  };
}

// ---------- Container ----------

function parseLabels(raw: string): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const part of (raw || '').split(',')) {
    const i = part.indexOf('=');
    if (i > 0) labels[part.slice(0, i)] = part.slice(i + 1);
  }
  return labels;
}

export async function listContainers(sessionId: string) {
  const rows = jsonLines(await dockerOk(sessionId, ['ps', '-a', '--no-trunc', '--format', '{{json .}}'], 30_000));
  return rows.map((r: any) => {
    const labels = parseLabels(r.Labels);
    return {
      id: r.ID,
      name: String(r.Names || '').split(',')[0],
      image: r.Image,
      command: r.Command,
      state: r.State,
      status: r.Status,
      ports: r.Ports || '',
      createdAt: r.CreatedAt,
      runningFor: r.RunningFor,
      networks: r.Networks || '',
      mounts: r.Mounts || '',
      composeProject: labels['com.docker.compose.project'] || '',
      composeService: labels['com.docker.compose.service'] || '',
    };
  });
}

const CONTAINER_ACTIONS: Record<string, (id: string) => string[]> = {
  start: (id) => ['start', id],
  stop: (id) => ['stop', id],
  restart: (id) => ['restart', id],
  kill: (id) => ['kill', id],
  pause: (id) => ['pause', id],
  unpause: (id) => ['unpause', id],
  remove: (id) => ['rm', '--force', id],
};

export async function containerAction(sessionId: string, id: string, action: string) {
  const build = CONTAINER_ACTIONS[action];
  if (!build) throw new DockerError(`Aksi tidak dikenal: ${action}`, 400);
  await dockerOk(sessionId, build(assertId(id)), 120_000);
}

export async function inspectContainer(sessionId: string, id: string) {
  const data = JSON.parse(await dockerOk(sessionId, ['inspect', '--type', 'container', assertId(id)], 30_000));
  if (!Array.isArray(data) || !data[0]) throw new DockerError('Container tidak ditemukan', 404);
  return data[0];
}

export async function containerStats(sessionId: string, id: string) {
  const out = await dockerOk(sessionId, ['stats', '--no-stream', '--no-trunc', '--format', '{{json .}}', assertId(id)], 30_000);
  return jsonLines(out)[0] ?? null;
}

// ---------- Image ----------

export async function listImages(sessionId: string) {
  const [images, usedOut] = await Promise.all([
    dockerOk(sessionId, ['images', '--no-trunc', '--format', '{{json .}}'], 30_000),
    // Image ID yang dipakai container (termasuk yang berhenti).
    docker(sessionId, ['ps', '-a', '--no-trunc', '--format', '{{.ID}}'], 30_000).then(async (res) => {
      const ids = res.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
      if (!ids.length) return '';
      return (await docker(sessionId, ['inspect', '--format', '{{.Image}}', ...ids], 30_000)).stdout;
    }),
  ]);
  const usage = new Map<string, number>();
  for (const id of usedOut.split('\n').map((s) => s.trim()).filter(Boolean)) usage.set(id, (usage.get(id) || 0) + 1);

  return jsonLines(images).map((r: any) => ({
    id: r.ID,
    repository: r.Repository,
    tag: r.Tag,
    size: r.Size,
    createdAt: r.CreatedAt,
    createdSince: r.CreatedSince,
    containers: usage.get(r.ID) || 0,
  }));
}

export async function imageAction(sessionId: string, action: string, ref: string) {
  if (action === 'pull') return dockerOk(sessionId, ['pull', assertId(ref)], 15 * 60_000);
  if (action === 'remove') return dockerOk(sessionId, ['rmi', assertId(ref)], 120_000);
  if (action === 'prune') return dockerOk(sessionId, ['image', 'prune', '--force'], 10 * 60_000);
  throw new DockerError(`Aksi tidak dikenal: ${action}`, 400);
}

// ---------- Volume ----------

export async function listVolumes(sessionId: string) {
  const [volumes, mountsOut] = await Promise.all([
    dockerOk(sessionId, ['volume', 'ls', '--format', '{{json .}}'], 30_000),
    docker(sessionId, ['ps', '-a', '--no-trunc', '--format', '{{.Names}}\t{{.Mounts}}'], 30_000),
  ]);
  const usedBy = new Map<string, string[]>();
  for (const line of mountsOut.stdout.split('\n')) {
    const [name, mounts] = line.split('\t');
    if (!name) continue;
    for (const m of (mounts || '').split(',').map((s) => s.trim()).filter(Boolean)) {
      usedBy.set(m, [...(usedBy.get(m) || []), name]);
    }
  }
  return jsonLines(volumes).map((r: any) => ({
    name: r.Name,
    driver: r.Driver,
    mountpoint: r.Mountpoint,
    scope: r.Scope,
    usedBy: usedBy.get(r.Name) || [],
    composeProject: parseLabels(r.Labels)['com.docker.compose.project'] || '',
  }));
}

export async function volumeAction(sessionId: string, action: string, name: string) {
  if (action === 'remove') return dockerOk(sessionId, ['volume', 'rm', assertId(name)], 120_000);
  if (action === 'prune') return dockerOk(sessionId, ['volume', 'prune', '--force'], 10 * 60_000);
  throw new DockerError(`Aksi tidak dikenal: ${action}`, 400);
}

// ---------- Spec dari inspect ----------

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function parseBind(bind: string): MountSpec {
  const parts = bind.split(':');
  // Path Windows (C:\...) tidak relevan di server Linux; format: src:dst[:opts]
  const [source, target, ...opts] = parts;
  return { source: source || '', target: target || '', mode: opts.join(':') };
}

export interface SpecResult {
  spec: RunSpec;
  warnings: string[];
  running: boolean;
  compose: { project: string; service: string; workingDir: string; configFiles: string[] } | null;
}

/**
 * Menyusun ulang konfigurasi `docker run` dari hasil inspect. Nilai yang sama
 * dengan bawaan image (ENV, CMD, label, ...) sengaja tidak disalin, supaya
 * image versi baru tetap membawa perubahannya.
 */
export async function specFromContainer(sessionId: string, id: string): Promise<SpecResult> {
  const c = await inspectContainer(sessionId, id);
  const imageRef = c.Config?.Image || c.Image;
  let img: any = {};
  try {
    const out = await dockerOk(sessionId, ['image', 'inspect', c.Image], 30_000);
    img = JSON.parse(out)[0] || {};
  } catch {
    // Image sudah terhapus: semua nilai dianggap milik container.
  }

  const cfg = c.Config || {};
  const host = c.HostConfig || {};
  const imgCfg = img.Config || {};
  const spec = emptySpec();
  const warnings: string[] = [];
  const extra: string[] = [];
  const q = (v: string) => (/\s/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v);

  spec.name = String(c.Name || '').replace(/^\//, '');
  spec.image = imageRef;

  const imageEnv = new Set<string>(imgCfg.Env || []);
  spec.env = (cfg.Env || []).filter((e: string) => !imageEnv.has(e));

  const entrypointChanged = !same(cfg.Entrypoint, imgCfg.Entrypoint);
  if (entrypointChanged) spec.entrypoint = cfg.Entrypoint || [];
  if (entrypointChanged || !same(cfg.Cmd, imgCfg.Cmd)) spec.cmd = cfg.Cmd || [];

  if (cfg.User && cfg.User !== imgCfg.User) spec.user = cfg.User;
  if (cfg.WorkingDir && cfg.WorkingDir !== imgCfg.WorkingDir) spec.workdir = cfg.WorkingDir;
  if (cfg.Hostname && !String(c.Id || '').startsWith(cfg.Hostname)) spec.hostname = cfg.Hostname;
  spec.tty = Boolean(cfg.Tty);
  spec.interactive = Boolean(cfg.OpenStdin);

  const imageLabels = imgCfg.Labels || {};
  spec.labels = Object.entries(cfg.Labels || {})
    .filter(([k, v]) => imageLabels[k] !== v)
    .map(([k, v]) => `${k}=${v}`);

  // Port
  const ports: PortMapping[] = [];
  for (const [key, bindings] of Object.entries<any>(host.PortBindings || {})) {
    const [containerPort, protocol = 'tcp'] = key.split('/');
    for (const b of bindings || [{}]) {
      ports.push({ hostIp: b.HostIp || '', hostPort: b.HostPort || '', containerPort, protocol: protocol as PortMapping['protocol'] });
    }
  }
  spec.ports = ports;
  spec.publishAll = Boolean(host.PublishAllPorts);

  // Mount: Binds, --mount, lalu volume yang tidak tercakup (termasuk volume anonim,
  // supaya datanya tetap terpasang di container baru).
  const mounts: MountSpec[] = (host.Binds || []).map(parseBind);
  for (const m of host.Mounts || []) {
    if (m.Type === 'tmpfs') spec.tmpfs.push(m.Target);
    else if (!mounts.some((x) => x.target === m.Target)) mounts.push({ source: m.Source || '', target: m.Target, mode: m.ReadOnly ? 'ro' : '' });
  }
  for (const m of c.Mounts || []) {
    if (m.Type === 'volume' && !mounts.some((x) => x.target === m.Destination)) {
      mounts.push({ source: m.Name, target: m.Destination, mode: m.RW === false ? 'ro' : '' });
    }
  }
  spec.mounts = mounts;
  for (const [path, opts] of Object.entries<string>(host.Tmpfs || {})) spec.tmpfs.push(opts ? `${path}:${opts}` : path);

  // Jaringan: alias dipertahankan supaya nama service (mis. di compose) tetap bisa di-resolve.
  const mode = host.NetworkMode || 'default';
  const networks = c.NetworkSettings?.Networks || {};
  const shortId = String(c.Id || '').slice(0, 12);
  const aliasesOf = (n: any) => (n?.Aliases || []).filter((a: string) => a !== shortId && a !== spec.name);
  if (mode !== 'default' && mode !== 'bridge') spec.network = mode;
  const primary = mode === 'default' ? 'bridge' : mode;
  if (networks[primary]) {
    spec.networkAliases = aliasesOf(networks[primary]);
    spec.ipv4 = networks[primary].IPAMConfig?.IPv4Address || '';
  }
  if (!mode.startsWith('container:') && mode !== 'host' && mode !== 'none') {
    spec.extraNetworks = Object.entries<any>(networks)
      .filter(([name]) => name !== primary)
      .map(([name, n]) => ({ name, aliases: aliasesOf(n) }));
  }

  // Restart
  const rp = host.RestartPolicy || {};
  if (rp.Name && rp.Name !== 'no') spec.restart = rp.Name === 'on-failure' && rp.MaximumRetryCount ? `on-failure:${rp.MaximumRetryCount}` : rp.Name;

  // Resource & keamanan
  spec.privileged = Boolean(host.Privileged);
  spec.init = Boolean(host.Init);
  spec.capAdd = host.CapAdd || [];
  spec.capDrop = host.CapDrop || [];
  spec.extraHosts = host.ExtraHosts || [];
  spec.devices = (host.Devices || []).map((d: any) => `${d.PathOnHost}:${d.PathInContainer}${d.CgroupPermissions && d.CgroupPermissions !== 'rwm' ? `:${d.CgroupPermissions}` : ''}`);
  if (host.Memory) spec.memory = String(host.Memory);
  if (host.NanoCpus) spec.cpus = String(host.NanoCpus / 1e9);
  if (host.ShmSize && host.ShmSize !== 67108864) spec.shmSize = String(host.ShmSize);
  const log = host.LogConfig || {};
  if (log.Type && (log.Type !== 'json-file' || Object.keys(log.Config || {}).length)) {
    spec.logDriver = log.Type;
    spec.logOpts = Object.entries<string>(log.Config || {}).map(([k, v]) => `${k}=${v}`);
  }

  // Pengaturan lain yang jarang dipakai: diteruskan sebagai flag tambahan.
  for (const v of host.Dns || []) extra.push(`--dns ${q(v)}`);
  for (const v of host.DnsSearch || []) extra.push(`--dns-search ${q(v)}`);
  for (const v of host.DnsOptions || []) extra.push(`--dns-option ${q(v)}`);
  for (const v of host.SecurityOpt || []) extra.push(`--security-opt ${q(v)}`);
  for (const [k, v] of Object.entries<string>(host.Sysctls || {})) extra.push(`--sysctl ${q(`${k}=${v}`)}`);
  for (const u of host.Ulimits || []) extra.push(`--ulimit ${u.Name}=${u.Soft}:${u.Hard}`);
  for (const g of host.GroupAdd || []) extra.push(`--group-add ${q(g)}`);
  for (const v of host.VolumesFrom || []) extra.push(`--volumes-from ${q(v)}`);
  if (host.PidMode) extra.push(`--pid ${q(host.PidMode)}`);
  if (host.IpcMode && !['private', 'shareable', ''].includes(host.IpcMode)) extra.push(`--ipc ${q(host.IpcMode)}`);
  if (host.UTSMode) extra.push(`--uts ${q(host.UTSMode)}`);
  if (host.UsernsMode) extra.push(`--userns ${q(host.UsernsMode)}`);
  if (host.ReadonlyRootfs) extra.push('--read-only');
  if (host.PidsLimit > 0) extra.push(`--pids-limit ${host.PidsLimit}`);
  if (host.MemoryReservation) extra.push(`--memory-reservation ${host.MemoryReservation}`);
  if (host.MemorySwap > 0 && host.MemorySwap !== host.Memory * 2) extra.push(`--memory-swap ${host.MemorySwap}`);
  if (host.CpuShares) extra.push(`--cpu-shares ${host.CpuShares}`);
  if (host.CpusetCpus) extra.push(`--cpuset-cpus ${q(host.CpusetCpus)}`);
  if (host.OomKillDisable) extra.push('--oom-kill-disable');
  if (host.Runtime && host.Runtime !== 'runc') extra.push(`--runtime ${q(host.Runtime)}`);
  if (cfg.StopSignal && cfg.StopSignal !== imgCfg.StopSignal) extra.push(`--stop-signal ${q(cfg.StopSignal)}`);
  if (cfg.StopTimeout) extra.push(`--stop-timeout ${cfg.StopTimeout}`);
  spec.extraArgs = extra;

  if ((host.DeviceRequests || []).length) warnings.push('Container memakai GPU/device request (--gpus); pengaturan ini tidak ikut disalin, tambahkan manual di "Flag tambahan".');
  if ((host.Links || []).length) warnings.push('Container memakai --link (legacy); link tidak ikut disalin.');
  if (!img.Id) warnings.push('Image asli tidak ditemukan di server; semua ENV/CMD disalin apa adanya.');

  const labels = cfg.Labels || {};
  const compose = labels['com.docker.compose.project'] && labels['com.docker.compose.service']
    ? {
        project: labels['com.docker.compose.project'],
        service: labels['com.docker.compose.service'],
        workingDir: labels['com.docker.compose.project.working_dir'] || '',
        configFiles: (labels['com.docker.compose.project.config_files'] || '').split(',').map((s: string) => s.trim()).filter(Boolean),
      }
    : null;

  return { spec, warnings, running: Boolean(c.State?.Running), compose };
}

// ---------- Recreate / edit ----------

const STABLE_MS = 4000;

/**
 * `docker start` sukses walaupun proses di dalamnya langsung crash. Pastikan
 * container tetap berjalan beberapa detik; bila tidak, kembalikan log terakhirnya.
 */
async function waitStable(sessionId: string, id: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const deadline = Date.now() + STABLE_MS;
  const initial = await inspectContainer(sessionId, id).catch(() => null);
  const startCount = initial?.RestartCount ?? 0;
  for (;;) {
    const c = await inspectContainer(sessionId, id).catch(() => null);
    const st = c?.State || {};
    const crashed = !c || st.Status === 'exited' || st.Status === 'dead' || st.Restarting || (c.RestartCount ?? 0) > startCount;
    if (crashed) {
      const logs = (await docker(sessionId, ['logs', '--tail', '25', id], 20_000).catch(() => null)) as ExecResult | null;
      const tail = logs ? `${logs.stdout}\n${logs.stderr}`.trim().slice(-1800) : '';
      const restarted = c && ((c.RestartCount ?? 0) > startCount || st.Restarting);
      const what = !c
        ? 'Container hilang setelah dijalankan.'
        : restarted
          ? `Container crash dan terus di-restart oleh Docker${st.ExitCode ? ` (exit code ${st.ExitCode})` : ''}.`
          : `Container berhenti setelah dijalankan${st.ExitCode ? ` (exit code ${st.ExitCode})` : ''}.`;
      return { ok: false, reason: `${what}${tail ? `\n\nLog terakhir:\n${tail}` : ''}` };
    }
    if (Date.now() >= deadline) return { ok: true };
    await new Promise((r) => setTimeout(r, 800));
  }
}

export interface DeployLog {
  ok: boolean;
  newId?: string;
  steps: { label: string; ok: boolean; output?: string }[];
}

/**
 * Mengganti container dengan konfigurasi `spec`. Container lama diganti nama
 * dan dihentikan dulu; bila pembuatan container baru gagal, container lama
 * dikembalikan seperti semula.
 *
 * mode 'duplicate': membuat container baru tanpa menyentuh yang lama.
 */
export async function deploySpec(
  sessionId: string,
  oldId: string,
  spec: RunSpec,
  options: { pull: boolean; mode: 'replace' | 'duplicate' },
): Promise<DeployLog> {
  const errors = validateSpec(spec);
  if (errors.length) throw new DockerError(errors.join(' '), 400);

  const log: DeployLog = { ok: false, steps: [] };
  const step = async (label: string, args: string[], timeoutMs = 120_000) => {
    const res = await docker(sessionId, args, timeoutMs);
    const ok = res.exitCode === 0 && !res.timedOut;
    log.steps.push({ label, ok, output: (ok ? res.stdout : res.stderr || res.stdout).trim().slice(-2000) });
    return { ok, stdout: res.stdout.trim() };
  };

  if (options.pull && !(await step(`Pull ${spec.image}`, ['pull', spec.image], 15 * 60_000)).ok) return log;

  if (options.mode === 'duplicate') {
    const created = await step('Buat container baru', ['create', ...specToArgs(spec)]);
    if (!created.ok) return log;
    log.newId = created.stdout.split('\n').pop();
    for (const n of spec.extraNetworks) {
      await step(`Hubungkan ke network ${n.name}`, ['network', 'connect', ...n.aliases.flatMap((a) => ['--alias', a]), n.name, log.newId!]);
    }
    if (!(await step('Jalankan container', ['start', log.newId!])).ok) return log;
    const stable = await waitStable(sessionId, log.newId!);
    log.steps.push({ label: `Pastikan container tetap berjalan (${STABLE_MS / 1000} detik)`, ok: stable.ok, output: stable.ok ? undefined : stable.reason });
    // Salinan yang gagal dibiarkan (berhenti) supaya log-nya bisa diperiksa; aslinya tidak tersentuh.
    log.ok = stable.ok;
    return log;
  }

  const old = await inspectContainer(sessionId, oldId);
  const oldName = String(old.Name || '').replace(/^\//, '');
  const wasRunning = Boolean(old.State?.Running);
  const tmpName = `${oldName}-sd-old-${Date.now().toString(36)}`;

  // Nama baru sama dengan lama: lama diganti nama dulu supaya namanya bebas.
  if (!(await step(`Ganti nama lama → ${tmpName}`, ['rename', old.Id, tmpName])).ok) return log;
  if (wasRunning && !(await step('Hentikan container lama', ['stop', old.Id], 120_000)).ok) {
    await step('Kembalikan nama', ['rename', old.Id, oldName]);
    return log;
  }

  const rollback = async (newId?: string) => {
    if (newId) await step('Hapus container baru yang gagal', ['rm', '--force', newId]);
    await step(`Kembalikan nama → ${oldName}`, ['rename', old.Id, oldName]);
    if (wasRunning) await step('Jalankan lagi container lama', ['start', old.Id]);
  };

  const created = await step('Buat container baru', ['create', ...specToArgs(spec)]);
  if (!created.ok) {
    await rollback();
    return log;
  }
  const newId = created.stdout.split('\n').pop()!;

  for (const n of spec.extraNetworks) {
    const ok = (await step(`Hubungkan ke network ${n.name}`, ['network', 'connect', ...n.aliases.flatMap((a) => ['--alias', a]), n.name, newId])).ok;
    if (!ok) {
      await rollback(newId);
      return log;
    }
  }

  if (wasRunning) {
    if (!(await step('Jalankan container baru', ['start', newId])).ok) {
      await rollback(newId);
      return log;
    }
    const stable = await waitStable(sessionId, newId);
    log.steps.push({ label: `Pastikan container tetap berjalan (${STABLE_MS / 1000} detik)`, ok: stable.ok, output: stable.ok ? undefined : stable.reason });
    if (!stable.ok) {
      await rollback(newId);
      return log;
    }
  }

  // Volume tidak ikut dihapus (tanpa -v): data tetap aman.
  await step('Hapus container lama', ['rm', old.Id]);
  log.ok = true;
  log.newId = newId;
  return log;
}

/** Recreate container compose lewat file compose aslinya. */
export async function composeRecreate(
  sessionId: string,
  compose: NonNullable<SpecResult['compose']>,
  pull: boolean,
): Promise<DeployLog> {
  const { prefix } = await dockerAccess(sessionId);
  const sudo = prefix.startsWith('sudo') ? 'sudo -n ' : '';
  const files = compose.configFiles.flatMap((f) => ['-f', shellQuote(f)]).join(' ');
  const base = `$C -p ${shellQuote(compose.project)} ${files}`;
  const script = [
    compose.workingDir ? `cd ${shellQuote(compose.workingDir)} || exit 1` : '',
    `if ${prefix} compose version >/dev/null 2>&1; then C="${prefix} compose"; elif command -v docker-compose >/dev/null 2>&1; then C="${sudo}docker-compose"; else echo "docker compose tidak ditemukan di server" >&2; exit 127; fi`,
    pull ? `${base} pull ${shellQuote(compose.service)} || exit 1` : '',
    `${base} up -d --no-deps --force-recreate ${shellQuote(compose.service)}`,
  ].filter(Boolean).join('\n');

  const res = await SSHManager.execCommand(sessionId, script, 15 * 60_000);
  const ok = res.exitCode === 0 && !res.timedOut;
  return {
    ok,
    steps: [{
      label: `docker compose up --force-recreate ${compose.service}${pull ? ' (dengan pull)' : ''}`,
      ok,
      // compose menulis progresnya ke stderr.
      output: `${res.stdout}\n${res.stderr}`.trim().slice(-3000),
    }],
  };
}
