/**
 * Konsol interaktif `docker exec -it` untuk browser.
 *
 * Tanpa WebSocket: output dikirim lewat satu respons HTTP yang di-stream
 * (GET), input dan resize lewat POST kecil. Kanal SSH memakai PTY sehingga
 * bash, top, vim, dan warna ANSI berjalan seperti terminal biasa.
 */
import { randomBytes } from 'node:crypto';
import type { ClientChannel } from 'ssh2';
import { SSHManager, shellQuote } from './ssh-session';
import { assertId, dockerAccess, DockerError } from './docker';

interface ConsoleSession {
  id: string;
  sessionId: string;
  channel: ClientChannel;
  pending: Buffer[];
  pendingBytes: number;
  sink: ((chunk: Buffer | null) => void) | null;
  closed: boolean;
  createdAt: number;
}

const consoles = new Map<string, ConsoleSession>();
const MAX_PENDING = 256 * 1024;

// Pilih shell terbaik yang tersedia di dalam container.
const AUTO_SHELL = 'if command -v bash >/dev/null 2>&1; then exec bash; elif command -v ash >/dev/null 2>&1; then exec ash; else exec sh; fi';

export async function openConsole(
  sessionId: string,
  containerId: string,
  options: { shell?: string; user?: string; cols?: number; rows?: number },
): Promise<string> {
  const { prefix } = await dockerAccess(sessionId);
  const id = assertId(containerId);
  const shell = (options.shell || 'auto').trim();
  if (shell !== 'auto' && !/^[\w\/.-]+$/.test(shell)) throw new DockerError('Shell tidak valid', 400);
  const user = (options.user || '').trim();
  if (user && !/^[\w.-]+(:[\w.-]+)?$/.test(user)) throw new DockerError('User tidak valid', 400);

  const args = ['exec', '-it', '-e', 'TERM=xterm-256color', ...(user ? ['-u', user] : []), id,
    ...(shell === 'auto' ? ['sh', '-c', AUTO_SHELL] : [shell])];
  const command = `${prefix} ${args.map(shellQuote).join(' ')}`;

  const channel = await SSHManager.openChannel(sessionId, command, {
    pty: { cols: clamp(options.cols, 20, 500, 120), rows: clamp(options.rows, 5, 200, 32) },
  });

  const consoleId = randomBytes(16).toString('hex');
  const entry: ConsoleSession = {
    id: consoleId, sessionId, channel, pending: [], pendingBytes: 0, sink: null, closed: false, createdAt: Date.now(),
  };

  const push = (chunk: Buffer) => {
    if (entry.sink) return entry.sink(chunk);
    // Belum ada pembaca: tampung dulu (dibatasi) sampai browser tersambung.
    entry.pending.push(chunk);
    entry.pendingBytes += chunk.length;
    while (entry.pendingBytes > MAX_PENDING && entry.pending.length > 1) entry.pendingBytes -= entry.pending.shift()!.length;
  };

  channel.on('data', push);
  channel.stderr.on('data', push);
  channel.on('close', () => {
    entry.closed = true;
    entry.sink?.(null);
    consoles.delete(consoleId);
  });

  consoles.set(consoleId, entry);
  return consoleId;
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function get(consoleId: string, sessionId: string): ConsoleSession {
  const entry = consoles.get(consoleId);
  // Konsol hanya bisa dipakai oleh sesi SSH yang membukanya.
  if (!entry || entry.sessionId !== sessionId) throw new DockerError('Konsol tidak ditemukan atau sudah ditutup', 404);
  return entry;
}

/** Sambungkan pembaca output; mengembalikan fungsi pelepas. */
export function attachConsole(consoleId: string, sessionId: string, sink: (chunk: Buffer | null) => void): () => void {
  const entry = get(consoleId, sessionId);
  entry.sink = sink;
  for (const chunk of entry.pending) sink(chunk);
  entry.pending = [];
  entry.pendingBytes = 0;
  if (entry.closed) sink(null);
  return () => {
    if (entry.sink === sink) entry.sink = null;
  };
}

export function writeConsole(consoleId: string, sessionId: string, data: string) {
  const entry = get(consoleId, sessionId);
  if (data.length > 64 * 1024) throw new DockerError('Input terlalu besar', 413);
  entry.channel.write(data);
}

export function resizeConsole(consoleId: string, sessionId: string, cols: number, rows: number) {
  get(consoleId, sessionId).channel.setWindow(clamp(rows, 5, 200, 32), clamp(cols, 20, 500, 120), 0, 0);
}

export function closeConsole(consoleId: string, sessionId: string) {
  const entry = consoles.get(consoleId);
  if (!entry || entry.sessionId !== sessionId) return;
  try {
    entry.channel.close();
  } catch {
    // sudah tertutup
  }
  consoles.delete(consoleId);
}

// Konsol yang dibuka tapi tidak pernah disambungkan browser dibersihkan.
setInterval(() => {
  const now = Date.now();
  for (const entry of consoles.values()) {
    if (!entry.sink && now - entry.createdAt > 2 * 60_000) closeConsole(entry.id, entry.sessionId);
    else if (!SSHManager.hasSession(entry.sessionId)) closeConsole(entry.id, entry.sessionId);
  }
}, 60_000).unref?.();
