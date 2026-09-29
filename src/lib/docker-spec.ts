/**
 * Spesifikasi container yang bisa diedit, dipakai bersama oleh server dan
 * browser. Server membangunnya dari `docker inspect` (lihat docker.ts), browser
 * mengeditnya, lalu server mengubahnya kembali menjadi argumen `docker create`.
 *
 * Murni TypeScript tanpa modul Node, supaya aman diimpor di sisi browser.
 */

export interface PortMapping {
  hostIp: string;
  /** Kosong = port acak di host. */
  hostPort: string;
  containerPort: string;
  protocol: 'tcp' | 'udp' | 'sctp';
}

export interface MountSpec {
  /** Path host (bind) atau nama volume. Kosong = volume anonim baru. */
  source: string;
  target: string;
  /** Opsi mount, mis. "ro" atau "ro,z". Kosong = baca-tulis. */
  mode: string;
}

export interface NetworkAttachment {
  name: string;
  aliases: string[];
}

export interface RunSpec {
  name: string;
  image: string;
  /** Kosong = pakai CMD / ENTRYPOINT bawaan image. */
  cmd: string[];
  entrypoint: string[];
  env: string[];
  ports: PortMapping[];
  publishAll: boolean;
  mounts: MountSpec[];
  tmpfs: string[];
  /** '' = bawaan (bridge). */
  network: string;
  networkAliases: string[];
  ipv4: string;
  extraNetworks: NetworkAttachment[];
  /** no | always | unless-stopped | on-failure | on-failure:N */
  restart: string;
  user: string;
  workdir: string;
  hostname: string;
  labels: string[];
  privileged: boolean;
  tty: boolean;
  interactive: boolean;
  init: boolean;
  capAdd: string[];
  capDrop: string[];
  extraHosts: string[];
  devices: string[];
  memory: string;
  cpus: string;
  shmSize: string;
  logDriver: string;
  logOpts: string[];
  /** Flag tambahan, satu flag per baris (mis. "--sysctl net.core.somaxconn=1024"). */
  extraArgs: string[];
}

export function emptySpec(): RunSpec {
  return {
    name: '', image: '', cmd: [], entrypoint: [], env: [], ports: [], publishAll: false,
    mounts: [], tmpfs: [], network: '', networkAliases: [], ipv4: '', extraNetworks: [],
    restart: 'no', user: '', workdir: '', hostname: '', labels: [], privileged: false,
    tty: false, interactive: false, init: false, capAdd: [], capDrop: [], extraHosts: [],
    devices: [], memory: '', cpus: '', shmSize: '', logDriver: '', logOpts: [], extraArgs: [],
  };
}

/** Memecah satu baris menjadi argumen, menghormati kutip tunggal/ganda. */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let hasToken = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < line.length) current += line[++i];
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
    } else if (/\s/.test(ch)) {
      if (hasToken) out.push(current);
      current = '';
      hasToken = false;
    } else {
      if (ch === '\\' && i + 1 < line.length) current += line[++i];
      else current += ch;
      hasToken = true;
    }
  }
  if (hasToken) out.push(current);
  return out;
}

const clean = (list: string[]) => list.map((s) => s.trim()).filter(Boolean);

export const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

export function validateSpec(spec: RunSpec): string[] {
  const errors: string[] = [];
  if (!NAME_RE.test(spec.name)) errors.push('Nama container hanya boleh huruf, angka, titik, garis bawah, dan strip.');
  if (!spec.image.trim()) errors.push('Image wajib diisi.');
  for (const p of spec.ports) {
    if (!/^\d+(-\d+)?$/.test(p.containerPort)) errors.push(`Port container tidak valid: ${p.containerPort || '(kosong)'}`);
    if (p.hostPort && !/^\d+(-\d+)?$/.test(p.hostPort)) errors.push(`Port host tidak valid: ${p.hostPort}`);
  }
  for (const m of spec.mounts) {
    if (!m.target.startsWith('/')) errors.push(`Path di container harus absolut: ${m.target || '(kosong)'}`);
  }
  for (const e of clean(spec.env)) {
    if (!/^[^=\s]+=/.test(e) && !/^[^=\s]+$/.test(e)) errors.push(`Environment tidak valid: ${e}`);
  }
  if (!/^(no|always|unless-stopped|on-failure(:\d+)?)$/.test(spec.restart || 'no')) errors.push(`Restart policy tidak valid: ${spec.restart}`);
  return errors;
}

/** Argumen untuk `docker create` (tanpa kata "docker create" itu sendiri). */
export function specToArgs(spec: RunSpec): string[] {
  const a: string[] = ['--name', spec.name.trim()];
  const flag = (name: string, values: string[]) => clean(values).forEach((v) => a.push(name, v));

  flag('-e', spec.env);

  for (const p of spec.ports) {
    const ip = p.hostIp && p.hostIp !== '0.0.0.0' && p.hostIp !== '::' ? (p.hostIp.includes(':') ? `[${p.hostIp}]` : p.hostIp) : '';
    const container = `${p.containerPort}/${p.protocol || 'tcp'}`;
    a.push('-p', p.hostPort ? `${ip ? `${ip}:` : ''}${p.hostPort}:${container}` : ip ? `${ip}::${container}` : container);
  }
  if (spec.publishAll) a.push('-P');

  for (const m of spec.mounts) {
    if (!m.target.trim()) continue;
    const mode = m.mode.trim();
    a.push('-v', m.source.trim() ? `${m.source.trim()}:${m.target.trim()}${mode ? `:${mode}` : ''}` : m.target.trim());
  }
  flag('--tmpfs', spec.tmpfs);

  if (spec.network.trim()) a.push('--network', spec.network.trim());
  flag('--network-alias', spec.networkAliases);
  if (spec.ipv4.trim()) a.push('--ip', spec.ipv4.trim());

  if (spec.restart && spec.restart !== 'no') a.push('--restart', spec.restart);
  if (spec.user.trim()) a.push('--user', spec.user.trim());
  if (spec.workdir.trim()) a.push('--workdir', spec.workdir.trim());
  if (spec.hostname.trim()) a.push('--hostname', spec.hostname.trim());
  flag('--label', spec.labels);

  if (spec.privileged) a.push('--privileged');
  if (spec.tty) a.push('--tty');
  if (spec.interactive) a.push('--interactive');
  if (spec.init) a.push('--init');
  flag('--cap-add', spec.capAdd);
  flag('--cap-drop', spec.capDrop);
  flag('--add-host', spec.extraHosts);
  flag('--device', spec.devices);
  if (spec.memory.trim()) a.push('--memory', spec.memory.trim());
  if (spec.cpus.trim()) a.push('--cpus', spec.cpus.trim());
  if (spec.shmSize.trim()) a.push('--shm-size', spec.shmSize.trim());
  if (spec.logDriver.trim()) a.push('--log-driver', spec.logDriver.trim());
  flag('--log-opt', spec.logOpts);

  for (const line of clean(spec.extraArgs)) a.push(...tokenize(line));

  const [entry, ...entryRest] = clean(spec.entrypoint);
  if (entry !== undefined) a.push('--entrypoint', entry);

  a.push(spec.image.trim());
  // ENTRYPOINT multi-elemen: elemen pertama lewat --entrypoint, sisanya jadi argumen awal.
  a.push(...entryRest, ...spec.cmd.filter((s) => s !== ''));
  return a;
}

/** Kutip POSIX sederhana untuk pratinjau perintah. */
export function quoteArg(arg: string): string {
  return /^[A-Za-z0-9_\/:=.,@%+-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function previewCommand(spec: RunSpec): string {
  const args = specToArgs(spec);
  const lines: string[] = [];
  let i = 0;
  // Kelompokkan "flag nilai" per baris supaya mudah dibaca.
  while (i < args.length) {
    const arg = args[i];
    if (arg === spec.image.trim()) {
      lines.push(args.slice(i).map(quoteArg).join(' '));
      break;
    }
    const next = args[i + 1];
    const takesValue = arg.startsWith('-') && next !== undefined && !next.startsWith('-') &&
      !['--privileged', '--tty', '--interactive', '--init', '-P'].includes(arg);
    lines.push(takesValue ? `${arg} ${quoteArg(next)}` : quoteArg(arg));
    i += takesValue ? 2 : 1;
  }
  return `docker run -d \\\n  ${lines.join(' \\\n  ')}`;
}
