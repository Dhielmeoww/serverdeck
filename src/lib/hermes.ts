/**
 * Integrasi Hermes Agent (Nous Research) lewat CLI `hermes` di server via SSH.
 * Dokumentasi: https://hermes-agent.nousresearch.com/docs/reference/cli-commands
 *
 * Hermes masih berkembang cepat, jadi output CLI ditampilkan apa adanya
 * (warna ANSI dibuang), bukan di-parse menjadi struktur yang mudah rusak.
 */
import type { ClientChannel } from 'ssh2';
import { SSHManager, shellQuote } from './ssh-session';

export class HermesError extends Error {
  constructor(message: string, public status = 500, public code?: string) {
    super(message);
  }
}

/** Folder data Hermes: $HERMES_HOME bila diset, selain itu ~/.hermes */
const HOME_EXPR = '"${HERMES_HOME:-$HOME/.hermes}"';
// Matikan warna dan spinner supaya output rapi di browser.
const ENV = 'NO_COLOR=1 TERM=dumb';

function unixSession(sessionId: string) {
  const s = SSHManager.getSession(sessionId);
  if (!s) throw new HermesError('Tidak ada sesi SSH aktif', 401);
  if (s.platform !== 'unix') throw new HermesError('Integrasi Hermes saat ini hanya untuk server Linux/macOS.', 400, 'windows');
  return s;
}

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07]*\x07|\r(?!\n)/g, '');
}

/** Jalankan skrip shell dengan PATH login user (installer Hermes menaruh `hermes` di ~/.local/bin). */
async function run(sessionId: string, script: string, timeoutMs = 60_000) {
  const s = unixSession(sessionId);
  const res = await SSHManager.execCommand(sessionId, SSHManager.buildCommand(s, script), timeoutMs);
  return { ...res, stdout: stripAnsi(res.stdout), stderr: stripAnsi(res.stderr) };
}

// ---------- Info ----------

export interface HermesInfo {
  installed: boolean;
  path: string;
  version: string;
  home: string;
  streamJson: boolean;
  configExists: boolean;
  envExists: boolean;
  logs: string[];
}

export async function hermesInfo(sessionId: string): Promise<HermesInfo> {
  const script = [
    `H=${HOME_EXPR}`,
    'echo "__HOME__$H"',
    'if command -v hermes >/dev/null 2>&1; then',
    '  echo "__PATH__$(command -v hermes)"',
    `  ${ENV} hermes --version 2>&1 | head -n 3 | sed 's/^/__VER__/'`,
    `  ${ENV} hermes chat --help 2>/dev/null | grep -q stream-json && echo __STREAMJSON__`,
    'fi',
    '[ -f "$H/config.yaml" ] && echo __CONFIG__',
    '[ -f "$H/.env" ] && echo __ENV__',
    'ls -1 "$H/logs" 2>/dev/null | grep -E "\\.log$" | sed "s/^/__LOG__/"',
  ].join('\n');
  const res = await run(sessionId, script, 30_000);
  const lines = res.stdout.split('\n');
  const pick = (prefix: string) => lines.filter((l) => l.startsWith(prefix)).map((l) => l.slice(prefix.length).trim());
  return {
    installed: pick('__PATH__').length > 0,
    path: pick('__PATH__')[0] || '',
    version: pick('__VER__').join(' ').trim(),
    home: pick('__HOME__')[0] || '~/.hermes',
    streamJson: lines.includes('__STREAMJSON__'),
    configExists: lines.includes('__CONFIG__'),
    envExists: lines.includes('__ENV__'),
    logs: pick('__LOG__'),
  };
}

// ---------- Perintah tetap (tanpa input pengguna) ----------

const ACTIONS: Record<string, { command: string; timeoutMs?: number }> = {
  status: { command: 'hermes status --full' },
  doctor: { command: 'hermes doctor' },
  'doctor-fix': { command: 'hermes doctor --fix', timeoutMs: 5 * 60_000 },
  'update-check': { command: 'hermes update --check', timeoutMs: 2 * 60_000 },
  update: { command: 'hermes update --backup', timeoutMs: 15 * 60_000 },
  'gateway-status': { command: 'hermes gateway status' },
  'gateway-list': { command: 'hermes gateway list' },
  'gateway-start': { command: 'hermes gateway start', timeoutMs: 2 * 60_000 },
  'gateway-stop': { command: 'hermes gateway stop', timeoutMs: 2 * 60_000 },
  'gateway-restart': { command: 'hermes gateway restart', timeoutMs: 2 * 60_000 },
  'gateway-install': { command: 'hermes gateway install', timeoutMs: 2 * 60_000 },
  'config-show': { command: 'hermes config show' },
  cron: { command: 'hermes cron list' },
  sessions: { command: 'hermes sessions list' },
};

export async function hermesAction(sessionId: string, action: string) {
  const def = ACTIONS[action];
  if (!def) throw new HermesError(`Aksi tidak dikenal: ${action}`, 400);
  // stdin ditutup oleh execCommand: perintah yang bertanya akan berhenti, bukan menggantung.
  const res = await run(sessionId, `cd "$HOME" && ${ENV} ${def.command}`, def.timeoutMs ?? 60_000);
  if (/command not found|hermes: not found/i.test(res.stderr)) {
    throw new HermesError('Hermes belum terpasang di server ini.', 404, 'not_installed');
  }
  return { command: def.command, stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode, timedOut: Boolean(res.timedOut) };
}

// ---------- .env (nilai disamarkan) ----------

export async function hermesEnvKeys(sessionId: string) {
  const res = await run(sessionId, `H=${HOME_EXPR}; [ -f "$H/.env" ] && cat "$H/.env"`, 15_000);
  return res.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      const value = l.slice(i + 1).replace(/^["']|["']$/g, '');
      return { key: l.slice(0, i).replace(/^export\s+/, ''), set: value.length > 0, preview: value ? `${value.slice(0, 3)}…${'•'.repeat(6)}` : '' };
    });
}

/** Path absolut file config untuk dibuka di editor File Manager. */
export async function hermesPaths(sessionId: string) {
  const res = await run(sessionId, `H=${HOME_EXPR}; cd "$H" 2>/dev/null && pwd -P || echo "$H"`, 15_000);
  const home = res.stdout.trim().split('\n').pop() || '';
  return { home, config: `${home}/config.yaml`, env: `${home}/.env`, logs: `${home}/logs` };
}

// ---------- Kanal stream: log & chat ----------

async function openStream(sessionId: string, script: string): Promise<ClientChannel> {
  const s = unixSession(sessionId);
  const channel = await SSHManager.openChannel(sessionId, SSHManager.buildCommand(s, script));
  // Tidak ada input dari pengguna: pertanyaan persetujuan Hermes otomatis ditolak (EOF).
  channel.end();
  return channel;
}

export function logStream(sessionId: string, file: string, tail: number, follow: boolean) {
  if (!/^[\w.-]+\.log$/.test(file)) throw new HermesError('Nama file log tidak valid', 400);
  const lines = Math.min(20_000, Math.max(1, Math.round(tail) || 300));
  return openStream(sessionId, `H=${HOME_EXPR}; tail -n ${lines}${follow ? ' -F' : ''} "$H/logs/${file}"`);
}

export interface ChatOptions {
  prompt: string;
  resume?: string;
  yolo?: boolean;
  streamJson?: boolean;
  maxTurns?: number;
}

export function chatStream(sessionId: string, options: ChatOptions) {
  const prompt = options.prompt.trim();
  if (!prompt) throw new HermesError('Pesan kosong', 400);
  if (prompt.length > 20_000) throw new HermesError('Pesan terlalu panjang (maks. 20.000 karakter)', 413);
  const resume = (options.resume || '').trim();
  if (resume && !/^[\w.:-]{1,128}$/.test(resume)) throw new HermesError('ID sesi tidak valid', 400);

  // Opsi global (--yolo, --resume) ditulis sebelum subperintah, sesuai dokumentasi CLI.
  const global = [options.yolo ? '--yolo' : '', resume ? `--resume ${shellQuote(resume)}` : ''].filter(Boolean).join(' ');
  const turns = Math.min(100, Math.max(1, Math.round(options.maxTurns || 30)));
  const flags = ['--oneshot', '-Q', '--source serverdeck', `--max-turns ${turns}`, options.streamJson ? '--format stream-json' : ''].filter(Boolean).join(' ');
  const script = `cd "$HOME" && ${ENV} hermes ${global} chat ${flags} -q ${shellQuote(prompt)} 2>&1`;
  return openStream(sessionId, script);
}

/** Respons HTTP yang meneruskan output kanal apa adanya; menutup request menutup kanal. */
export function channelResponse(channel: ClientChannel, signal: AbortSignal, contentType = 'text/plain; charset=utf-8') {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (chunk: Buffer) => {
        try {
          controller.enqueue(new Uint8Array(chunk));
        } catch {
          // pembaca sudah pergi
        }
      };
      channel.on('data', push);
      channel.stderr.on('data', push);
      channel.on('close', () => {
        try {
          controller.close();
        } catch {
          // sudah tertutup
        }
      });
    },
    cancel() {
      stop(channel);
    },
  });
  signal.addEventListener('abort', () => stop(channel));
  return new Response(stream, {
    headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  });
}

function stop(channel: ClientChannel) {
  try {
    channel.signal('TERM');
  } catch {
    // server tidak mendukung sinyal
  }
  channel.close();
}
