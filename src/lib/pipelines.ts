/**
 * Pipeline: urutan langkah yang dijalankan satu per satu di server SSH aktif.
 *
 * Semua pipeline, variabel, dan riwayat run hanya disimpan di localStorage
 * browser ini. Server ServerDeck tidak menyimpan apa pun; saat run, tiap
 * perintah dikirim ke /api/exec lalu diteruskan ke server SSH tujuan.
 */
import { api, shellQuote } from './client';

export type StepType = 'command' | 'condition' | 'write_file' | 'http_check' | 'wait';
export type ConditionCheck = 'exit_zero' | 'exit_nonzero' | 'contains' | 'not_contains';
export type StepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'stopped' | 'cancelled';
export type RunStatus = 'running' | 'success' | 'failed' | 'stopped' | 'cancelled';

export interface StepConfig {
  command?: string;
  cwd?: string;
  check?: ConditionCheck;
  value?: string;
  path?: string;
  content?: string;
  mode?: string;
  /** Tulis file lewat `sudo tee` (untuk /etc dan folder milik root). */
  sudo?: boolean;
  url?: string;
  expectStatus?: string;
  seconds?: number;
}

export interface Step {
  id: string;
  type: StepType;
  name: string;
  enabled: boolean;
  onError: 'stop' | 'continue';
  timeoutSec: number;
  config: StepConfig;
}

export interface Variable {
  key: string;
  value: string;
}

export interface StepResult {
  stepId: string;
  name: string;
  type: StepType;
  status: StepStatus;
  startedAt?: number;
  durationMs?: number;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  message?: string;
}

export interface RunRecord {
  id: string;
  host: string;
  startedAt: number;
  finishedAt?: number;
  status: RunStatus;
  steps: StepResult[];
}

export interface Pipeline {
  id: string;
  name: string;
  description: string;
  variables: Variable[];
  steps: Step[];
  createdAt: number;
  updatedAt: number;
  runs: RunRecord[];
}

export const STEP_TYPES: Record<StepType, { label: string; description: string; icon: string; tone: string }> = {
  command: {
    label: 'Command',
    description: 'Jalankan perintah shell. Gagal bila exit code bukan 0.',
    icon: 'terminal',
    tone: 'bg-slate-900 text-white',
  },
  condition: {
    label: 'Kondisi (IF)',
    description: 'Cek hasil perintah. Bila tidak terpenuhi, pipeline berhenti tanpa dianggap gagal.',
    icon: 'branch',
    tone: 'bg-violet-50 text-violet-700',
  },
  write_file: {
    label: 'Tulis file',
    description: 'Buat atau timpa file di server dengan isi tertentu.',
    icon: 'fileEdit',
    tone: 'bg-sky-50 text-sky-700',
  },
  http_check: {
    label: 'HTTP check',
    description: 'Panggil URL dari server (curl) dan cocokkan status code.',
    icon: 'globe',
    tone: 'bg-brand-50 text-brand-700',
  },
  wait: {
    label: 'Tunggu',
    description: 'Jeda beberapa detik sebelum langkah berikutnya.',
    icon: 'clock',
    tone: 'bg-amber-50 text-amber-700',
  },
};

export const CONDITION_LABELS: Record<ConditionCheck, string> = {
  exit_zero: 'Exit code = 0',
  exit_nonzero: 'Exit code ≠ 0',
  contains: 'Output mengandung',
  not_contains: 'Output tidak mengandung',
};

const STORAGE_KEY = 'serverdeck.pipelines.v1';
const MAX_RUNS = 10;
const MAX_OUTPUT = 4000;

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// ---------- Penyimpanan ----------

export function loadPipelines(): Pipeline[] {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(data) ? data.map(normalizePipeline) : [];
  } catch {
    return [];
  }
}

export function savePipelines(pipelines: Pipeline[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pipelines));
    return true;
  } catch {
    // Kuota penuh: buang riwayat run terlama dulu, lalu coba sekali lagi.
    try {
      const slim = pipelines.map((p) => ({ ...p, runs: p.runs.slice(0, 2) }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
      return true;
    } catch {
      return false;
    }
  }
}

// ---------- Penyimpanan: browser atau database ----------
// Mode ditentukan server (STORAGE_MODE) dan dibawa halaman lewat data-storage.

export type StoreMode = 'browser' | 'database';

export function storeMode(): StoreMode {
  return document.getElementById('app-container')?.dataset.storage === 'database' ? 'database' : 'browser';
}

export async function fetchPipelines(): Promise<Pipeline[]> {
  if (storeMode() === 'browser') return loadPipelines();
  const data = await api<{ pipelines: unknown[] }>('/api/pipelines');
  return (data.pipelines || []).map(normalizePipeline);
}

/** Simpan satu pipeline. Mode browser menulis ulang seluruh daftar ke localStorage. */
export async function storePipeline(all: Pipeline[], p: Pipeline): Promise<void> {
  if (storeMode() === 'browser') {
    if (!savePipelines(all)) throw new Error('Penyimpanan browser penuh. Hapus riwayat run atau pipeline lama.');
    return;
  }
  await api('/api/pipelines', { action: 'save', pipeline: p });
}

export async function storeManyPipelines(all: Pipeline[], list: Pipeline[]): Promise<void> {
  if (storeMode() === 'browser') {
    if (!savePipelines(all)) throw new Error('Penyimpanan browser penuh.');
    return;
  }
  await api('/api/pipelines', { action: 'import', pipelines: list });
}

export async function removeStoredPipeline(all: Pipeline[], id: string): Promise<void> {
  if (storeMode() === 'browser') {
    savePipelines(all);
    return;
  }
  await api('/api/pipelines', { action: 'delete', id });
}

/** Jumlah pipeline lama di localStorage browser ini (untuk dipindahkan ke database). */
export function browserPipelineCount(): number {
  return loadPipelines().length;
}

/** Pindahkan pipeline dari localStorage ke database, lalu hapus salinan di browser. */
export async function migrateBrowserPipelines(): Promise<number> {
  const local = loadPipelines();
  if (!local.length) return 0;
  const res = await api<{ imported: number }>('/api/pipelines', { action: 'import', pipelines: local });
  localStorage.removeItem(STORAGE_KEY);
  return res.imported;
}

export function storageBytes(): number {
  try {
    return new Blob([localStorage.getItem(STORAGE_KEY) || '']).size;
  } catch {
    return 0;
  }
}

export function newStep(type: StepType): Step {
  const defaults: Record<StepType, StepConfig> = {
    command: { command: '', cwd: '' },
    condition: { command: '', check: 'exit_zero', value: '' },
    write_file: { path: '', content: '', mode: '', sudo: false },
    http_check: { url: 'https://', expectStatus: '200' },
    wait: { seconds: 5 },
  };
  return {
    id: uid(),
    type,
    name: STEP_TYPES[type].label,
    enabled: true,
    onError: 'stop',
    timeoutSec: 300,
    config: { ...defaults[type] },
  };
}

function normalizePipeline(raw: any): Pipeline {
  return {
    id: String(raw.id || uid()),
    name: String(raw.name || 'Pipeline tanpa nama'),
    description: String(raw.description || ''),
    variables: Array.isArray(raw.variables)
      ? raw.variables.map((v: any) => ({ key: String(v.key || ''), value: String(v.value ?? '') }))
      : [],
    steps: Array.isArray(raw.steps)
      ? raw.steps
          .filter((s: any) => s && s.type in STEP_TYPES)
          .map((s: any) => ({
            ...newStep(s.type),
            ...s,
            id: String(s.id || uid()),
            config: { ...newStep(s.type).config, ...(s.config || {}) },
          }))
      : [],
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
    runs: Array.isArray(raw.runs) ? raw.runs.slice(0, MAX_RUNS) : [],
  };
}

/** Pipeline siap-ekspor: tanpa riwayat run (bisa berisi output sensitif). */
export function exportPipeline(p: Pipeline) {
  const { runs: _runs, ...rest } = p;
  return { format: 'serverdeck-pipeline', version: 1, pipeline: rest };
}

export function importPipelines(text: string): Pipeline[] {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data?.pipelines || (data?.pipeline ? [data.pipeline] : [data]);
  return list
    .filter((p: any) => p && Array.isArray(p.steps))
    .map((p: any) => normalizePipeline({ ...p, id: uid(), runs: [], createdAt: Date.now(), updatedAt: Date.now() }));
}

// ---------- Template ----------

type StepDraft = Partial<Omit<Step, 'config'>> & { type: StepType; config?: StepConfig };

function build(name: string, description: string, variables: Variable[], steps: StepDraft[]): Pipeline {
  return {
    id: uid(),
    name,
    description,
    variables,
    steps: steps.map((s) => {
      const base = newStep(s.type);
      return { ...base, ...s, id: uid(), config: { ...base.config, ...(s.config || {}) } };
    }),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    runs: [],
  };
}

/**
 * Langkah "tambah domain + SSL". File ditulis ke conf.d karena folder itu
 * di-include nginx.conf bawaan Debian/Ubuntu maupun RHEL, tanpa perlu symlink.
 */
export function nginxNewDomainSteps(): StepDraft[] {
  return [
    { type: 'command', name: 'Cek konfigurasi Nginx saat ini', config: { command: 'sudo nginx -t' } },
    {
      type: 'condition',
      name: 'Konfigurasi domain belum ada?',
      // Menjalankan ulang pipeline tidak boleh menimpa file yang sudah diubah certbot (blok SSL-nya hilang).
      config: { command: 'test -e {{CONF_DIR}}/{{NAME}}.conf', check: 'exit_nonzero' },
    },
    {
      type: 'command',
      name: 'Cek DNS domain',
      config: { command: 'getent hosts {{DOMAIN}} || { echo "DNS {{DOMAIN}} belum bisa di-resolve dari server ini" >&2; exit 1; }' },
    },
    {
      type: 'write_file',
      name: 'Buat file konfigurasi Nginx',
      config: {
        sudo: true,
        path: '{{CONF_DIR}}/{{NAME}}.conf',
        mode: '644',
        content: [
          'server {',
          '    listen 80;',
          '    server_name {{DOMAIN}};',
          '',
          '    location / {',
          '        proxy_pass {{UPSTREAM}};',
          '        proxy_set_header Host $host;',
          '        proxy_set_header X-Real-IP $remote_addr;',
          '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
          '        proxy_set_header X-Forwarded-Proto $scheme;',
          '    }',
          '}',
          '',
        ].join('\n'),
      },
    },
    {
      type: 'command',
      name: 'Uji konfigurasi baru (batal bila gagal)',
      config: {
        command: 'sudo nginx -t || { sudo rm -f {{CONF_DIR}}/{{NAME}}.conf; echo "Konfigurasi baru tidak valid, {{NAME}}.conf dihapus lagi" >&2; exit 1; }',
      },
    },
    { type: 'command', name: 'Reload Nginx', config: { command: 'sudo systemctl reload nginx' } },
    {
      type: 'command',
      name: 'Terbitkan sertifikat SSL',
      timeoutSec: 600,
      config: {
        // Tanpa EMAIL: daftar tanpa email (tidak dapat notifikasi kedaluwarsa).
        command:
          'sudo certbot --nginx -d {{DOMAIN}} --non-interactive --agree-tos --redirect $( [ -n "{{EMAIL}}" ] && echo "-m {{EMAIL}}" || echo "--register-unsafely-without-email" )',
      },
    },
    { type: 'command', name: 'Restart Nginx', config: { command: 'sudo systemctl restart nginx' } },
    { type: 'wait', name: 'Tunggu Nginx siap', config: { seconds: 2 } },
    { type: 'http_check', name: 'Cek HTTPS', config: { url: 'https://{{DOMAIN}}', expectStatus: '200,301,302' } },
    { type: 'command', name: 'Info sertifikat', config: { command: 'sudo certbot certificates -d {{DOMAIN}}' } },
  ];
}

export const TEMPLATES: { id: string; name: string; description: string; create: () => Pipeline }[] = [
  {
    id: 'blank',
    name: 'Pipeline kosong',
    description: 'Mulai dari nol, tambahkan langkah sendiri.',
    create: () => build('Pipeline baru', '', [], [{ type: 'command', name: 'Langkah pertama', config: { command: 'echo "Hello"' } }]),
  },
  {
    id: 'certbot',
    name: 'Perbarui sertifikat SSL (Certbot)',
    description: 'Cek masa berlaku, backup, renew, uji Nginx, reload, lalu verifikasi HTTPS.',
    create: () =>
      build(
        'Perbarui sertifikat SSL',
        'Renew sertifikat Let\'s Encrypt bila tersisa kurang dari DAYS hari, lalu reload Nginx.',
        [
          { key: 'DOMAIN', value: 'example.com' },
          { key: 'DAYS', value: '30' },
        ],
        [
          {
            type: 'condition',
            name: 'Sertifikat hampir kedaluwarsa?',
            config: {
              command: 'openssl x509 -checkend $(( {{DAYS}} * 86400 )) -noout -in /etc/letsencrypt/live/{{DOMAIN}}/cert.pem',
              check: 'exit_nonzero',
            },
          },
          {
            type: 'command',
            name: 'Backup /etc/letsencrypt',
            config: { command: 'tar -czf /root/letsencrypt-$(date +%F-%H%M).tar.gz -C /etc letsencrypt && ls -lh /root/letsencrypt-*.tar.gz | tail -n 1' },
          },
          {
            type: 'command',
            name: 'Renew sertifikat',
            timeoutSec: 600,
            config: { command: 'certbot renew --cert-name {{DOMAIN}} --non-interactive --no-random-sleep-on-renew' },
          },
          { type: 'command', name: 'Uji konfigurasi Nginx', config: { command: 'nginx -t' } },
          { type: 'command', name: 'Reload Nginx', config: { command: 'systemctl reload nginx' } },
          { type: 'wait', name: 'Tunggu Nginx siap', config: { seconds: 3 } },
          { type: 'http_check', name: 'Cek HTTPS', config: { url: 'https://{{DOMAIN}}', expectStatus: '200,301,302' } },
          {
            type: 'command',
            name: 'Tampilkan tanggal kedaluwarsa baru',
            config: { command: 'echo | openssl s_client -servername {{DOMAIN}} -connect {{DOMAIN}}:443 2>/dev/null | openssl x509 -noout -enddate' },
          },
        ],
      ),
  },
  {
    id: 'nginx-new-domain',
    name: 'Tambah domain + SSL baru (Nginx + Certbot)',
    description: 'Buat server block reverse proxy, uji Nginx, terbitkan sertifikat Let\'s Encrypt, lalu restart.',
    create: () =>
      build(
        'Tambah domain + SSL',
        'Reverse proxy DOMAIN → UPSTREAM dengan HTTPS dari Let\'s Encrypt. Aman diulang: berhenti bila konfigurasi domain sudah ada.',
        [
          { key: 'DOMAIN', value: 'app.example.com' },
          { key: 'NAME', value: 'app' },
          { key: 'UPSTREAM', value: 'http://127.0.0.1:3000' },
          { key: 'CONF_DIR', value: '/etc/nginx/conf.d' },
          { key: 'EMAIL', value: '' },
        ],
        nginxNewDomainSteps(),
      ),
  },
  {
    id: 'deploy',
    name: 'Deploy dari Git',
    description: 'Pull kode terbaru, install dependency, build, restart service, cek health.',
    create: () =>
      build(
        'Deploy aplikasi',
        'git pull → npm ci → build → restart → health check.',
        [
          { key: 'APP_DIR', value: '/var/www/app' },
          { key: 'BRANCH', value: 'main' },
          { key: 'SERVICE', value: 'app' },
          { key: 'HEALTH_URL', value: 'http://127.0.0.1:3000/health' },
        ],
        [
          { type: 'command', name: 'Pull kode terbaru', config: { cwd: '{{APP_DIR}}', command: 'git fetch --all --prune && git checkout {{BRANCH}} && git pull --ff-only' } },
          { type: 'command', name: 'Install dependency', timeoutSec: 900, config: { cwd: '{{APP_DIR}}', command: 'npm ci' } },
          { type: 'command', name: 'Build', timeoutSec: 900, config: { cwd: '{{APP_DIR}}', command: 'npm run build' } },
          { type: 'command', name: 'Restart service', config: { command: 'systemctl restart {{SERVICE}} && systemctl is-active {{SERVICE}}' } },
          { type: 'wait', name: 'Tunggu service naik', config: { seconds: 5 } },
          { type: 'http_check', name: 'Health check', config: { url: '{{HEALTH_URL}}', expectStatus: '200' } },
        ],
      ),
  },
  {
    id: 'cleanup',
    name: 'Bersihkan disk',
    description: 'Lihat pemakaian, rapikan journal, cache apt, dan log lama.',
    create: () =>
      build(
        'Bersihkan disk',
        'Membersihkan journal, cache paket, dan log terkompresi yang lebih tua dari DAYS hari.',
        [{ key: 'DAYS', value: '14' }],
        [
          { type: 'command', name: 'Pemakaian sebelum', config: { command: 'df -h /' } },
          { type: 'command', name: 'Rapikan journal', onError: 'continue', config: { command: 'journalctl --vacuum-time={{DAYS}}d' } },
          { type: 'command', name: 'Bersihkan cache apt', onError: 'continue', config: { command: 'apt-get clean && apt-get autoremove -y' } },
          { type: 'command', name: 'Hapus log lama (.gz)', onError: 'continue', config: { command: 'find /var/log -type f -name "*.gz" -mtime +{{DAYS}} -print -delete' } },
          { type: 'command', name: 'Pemakaian sesudah', config: { command: 'df -h /' } },
        ],
      ),
  },
  {
    id: 'healthcheck',
    name: 'Cek kesehatan server',
    description: 'Uptime, memori, disk, service gagal, dan status HTTP.',
    create: () =>
      build(
        'Cek kesehatan server',
        'Ringkasan cepat kondisi server.',
        [{ key: 'URL', value: 'http://127.0.0.1' }],
        [
          { type: 'command', name: 'Uptime & load', config: { command: 'uptime' } },
          { type: 'command', name: 'Memori', config: { command: 'free -h' } },
          { type: 'command', name: 'Disk', config: { command: 'df -h -x tmpfs -x devtmpfs' } },
          {
            type: 'condition',
            name: 'Tidak ada service gagal?',
            config: { command: 'systemctl --failed --no-legend --plain', check: 'not_contains', value: '.service' },
          },
          { type: 'http_check', name: 'HTTP', config: { url: '{{URL}}', expectStatus: '200,301,302' } },
        ],
      ),
  },
];

// ---------- Ringkasan untuk kartu ----------

export function stepSummary(step: Step): string {
  const c = step.config;
  switch (step.type) {
    case 'command':
      return (c.cwd ? `cd ${c.cwd} && ` : '') + (c.command || '').split('\n')[0];
    case 'condition':
      return `${(c.command || '').split('\n')[0]}`;
    case 'write_file':
      return `${c.sudo ? 'sudo · ' : ''}${c.path || '(path belum diisi)'}${c.mode ? ` · chmod ${c.mode}` : ''}`;
    case 'http_check':
      return `${c.url || ''} → ${c.expectStatus || '200'}`;
    case 'wait':
      return `${c.seconds || 0} detik`;
  }
}

export function conditionText(step: Step): string {
  const check = step.config.check || 'exit_zero';
  const label = CONDITION_LABELS[check];
  return check === 'contains' || check === 'not_contains' ? `${label} "${step.config.value || ''}"` : label;
}

// ---------- Variabel ----------

const VAR_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export function findUnknownVariables(p: Pipeline): string[] {
  const known = new Set(p.variables.map((v) => v.key).concat('PREV_OUTPUT'));
  const unknown = new Set<string>();
  for (const step of p.steps) {
    if (!step.enabled) continue;
    for (const value of Object.values(step.config)) {
      if (typeof value !== 'string') continue;
      for (const m of value.matchAll(VAR_RE)) if (!known.has(m[1])) unknown.add(m[1]);
    }
  }
  return [...unknown];
}

function substitute(text: string, vars: Record<string, string>): string {
  return text.replace(VAR_RE, (match, key) => (key in vars ? vars[key] : match));
}

// ---------- Runner ----------

export interface RunHooks {
  onUpdate(run: RunRecord): void;
}

export interface RunOptions {
  host: string;
  platform: 'unix' | 'windows';
  shell: 'sh' | 'cmd' | 'powershell';
  /** Hanya disimpan di memori selama run; tidak pernah ditulis ke localStorage. */
  sudoPassword?: string;
}

const SUDO_WORD = /(^|[\s;&|(`])sudo(\s|$)/;

/** Apakah pipeline memakai sudo (perintah atau langkah tulis-file dengan sudo). */
export function usesSudo(p: Pipeline): boolean {
  return p.steps.some((s) => {
    if (!s.enabled) return false;
    if (s.type === 'write_file') return Boolean(s.config.sudo);
    return (s.type === 'command' || s.type === 'condition') && SUDO_WORD.test(s.config.command || '');
  });
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Pesan yang lebih jelas untuk kegagalan sudo yang umum. */
function sudoHint(stderr: string, hasPassword: boolean): string | undefined {
  if (/incorrect password|Sorry, try again/i.test(stderr)) return 'Password sudo salah';
  if (/sudo: (a )?password is required|sudo: a terminal is required|no askpass program/i.test(stderr)) {
    return hasPassword ? 'sudo menolak password' : 'sudo butuh password: isi password sudo saat menjalankan pipeline';
  }
  if (/is not in the sudoers file|not allowed to execute/i.test(stderr)) return 'User ini tidak punya izin sudo untuk perintah tersebut';
  return undefined;
}

type ExecResult = { stdout: string; stderr: string; exitCode: number; timedOut: boolean };

export class PipelineRun {
  readonly record: RunRecord;
  private cancelled = false;
  private controller: AbortController | null = null;
  private wake: (() => void) | null = null;
  private pipeline: Pipeline;

  constructor(pipeline: Pipeline, private options: RunOptions, private hooks: RunHooks) {
    // Salinan: suntingan selama run tidak mengubah langkah yang sedang dijalankan.
    this.pipeline = structuredClone(pipeline);
    this.record = {
      id: uid(),
      host: options.host,
      startedAt: Date.now(),
      status: 'running',
      steps: this.pipeline.steps.map((s) => ({ stepId: s.id, name: s.name, type: s.type, status: 'pending' })),
    };
  }

  /** Berhenti setelah langkah yang sedang berjalan. Perintah remote tidak dibatalkan paksa. */
  cancel() {
    this.cancelled = true;
    this.controller?.abort();
    this.wake?.();
  }

  async start(): Promise<RunRecord> {
    const vars: Record<string, string> = Object.fromEntries(this.pipeline.variables.filter((v) => v.key).map((v) => [v.key, v.value]));
    let prevOutput = '';
    let halted: 'stopped' | 'failed' | null = null;
    let anyFailed = false;

    for (let i = 0; i < this.pipeline.steps.length; i++) {
      const step = this.pipeline.steps[i];
      const result = this.record.steps[i];

      if (this.cancelled) {
        result.status = 'cancelled';
        result.message = 'Run dihentikan';
        continue;
      }
      if (halted) {
        result.status = 'skipped';
        result.message = halted === 'stopped' ? 'Dilewati: kondisi sebelumnya tidak terpenuhi' : 'Dilewati: langkah sebelumnya gagal';
        continue;
      }
      if (!step.enabled) {
        result.status = 'skipped';
        result.message = 'Langkah nonaktif';
        continue;
      }

      result.status = 'running';
      result.startedAt = Date.now();
      this.emit();

      try {
        const ctx = { ...vars, PREV_OUTPUT: prevOutput };
        const outcome = await this.execute(step, ctx);
        Object.assign(result, outcome);
        prevOutput = (outcome.stdout || '').trim();
      } catch (err: any) {
        if (this.cancelled) {
          result.status = 'cancelled';
          result.message = 'Dihentikan saat berjalan. Perintah di server mungkin masih berlanjut.';
        } else {
          result.status = 'failed';
          result.message = err?.message || String(err);
        }
      }

      result.durationMs = Date.now() - (result.startedAt || Date.now());
      result.stdout = truncate(result.stdout);
      result.stderr = truncate(result.stderr);

      // Dibaca ulang: status sudah diubah oleh execute() lewat Object.assign.
      const status = result.status as StepStatus;
      if (status === 'stopped') halted = 'stopped';
      if (status === 'failed') {
        anyFailed = true;
        if (step.onError === 'stop') halted = 'failed';
      }
      this.emit();
    }

    // Password dibuang begitu run selesai.
    this.options.sudoPassword = undefined;
    this.record.finishedAt = Date.now();
    this.record.status = this.cancelled ? 'cancelled' : anyFailed ? 'failed' : halted === 'stopped' ? 'stopped' : 'success';
    this.emit();
    return this.record;
  }

  private emit() {
    this.hooks.onUpdate(this.record);
  }

  private async exec(command: string, timeoutSec: number, cwd?: string): Promise<ExecResult> {
    const unix = this.options.platform === 'unix';
    const password = this.options.sudoPassword;
    this.controller = new AbortController();
    try {
      return await api<ExecResult>(
        '/api/exec',
        {
          command,
          timeoutSec,
          cwd: cwd || undefined,
          sudo: !unix ? 'none' : password ? 'password' : 'nonInteractive',
          sudoPassword: unix && password ? password : undefined,
        },
        this.controller.signal,
      );
    } finally {
      this.controller = null;
    }
  }

  /** Hasil perintah → StepResult, dengan pesan khusus untuk timeout dan sudo. */
  private commandResult(res: ExecResult, timeout: number): Partial<StepResult> {
    const ok = res.exitCode === 0;
    const message = res.timedOut
      ? `Timeout setelah ${timeout} detik`
      : ok
        ? undefined
        : sudoHint(res.stderr, Boolean(this.options.sudoPassword)) || `Exit code ${res.exitCode}`;
    return { status: ok ? 'success' : 'failed', exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr, message };
  }

  private httpCheckCommand(url: string, maxTime: number) {
    if (this.options.shell === 'cmd') return `curl.exe -sS -o NUL -w "%{http_code}" --max-time ${maxTime} "${url.replace(/"/g, '')}"`;
    if (this.options.shell === 'powershell') return `curl.exe -sS -o NUL -w '%{http_code}' --max-time ${maxTime} '${url.replace(/'/g, "''")}'`;
    return `curl -sS -o /dev/null -w '%{http_code}' --max-time ${maxTime} ${shellQuote(url)}`;
  }

  private async execute(step: Step, vars: Record<string, string>): Promise<Partial<StepResult>> {
    const c = step.config;
    const sub = (value?: string) => substitute(value || '', vars);
    const timeout = Math.max(1, step.timeoutSec || 300);

    switch (step.type) {
      case 'command': {
        const command = sub(c.command).trim();
        if (!command) throw new Error('Perintah kosong');
        const res = await this.exec(command, timeout, sub(c.cwd).trim());
        return this.commandResult(res, timeout);
      }

      case 'condition': {
        const command = sub(c.command).trim();
        if (!command) throw new Error('Perintah kondisi kosong');
        const res = await this.exec(command, timeout);
        if (res.timedOut) {
          return { status: 'failed', exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr, message: `Timeout setelah ${timeout} detik` };
        }
        // Kegagalan sudo bukan jawaban "tidak" dari kondisi: hentikan sebagai gagal.
        const hint = sudoHint(res.stderr, Boolean(this.options.sudoPassword));
        if (hint) return { status: 'failed', exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr, message: hint };

        const output = `${res.stdout}\n${res.stderr}`;
        const needle = sub(c.value);
        const passed = {
          exit_zero: res.exitCode === 0,
          exit_nonzero: res.exitCode !== 0,
          contains: output.includes(needle),
          not_contains: !output.includes(needle),
        }[c.check || 'exit_zero'];
        return {
          status: passed ? 'success' : 'stopped',
          exitCode: res.exitCode,
          stdout: res.stdout,
          stderr: res.stderr,
          message: passed ? 'Kondisi terpenuhi, lanjut' : 'Kondisi tidak terpenuhi, pipeline berhenti',
        };
      }

      case 'write_file': {
        const path = sub(c.path).trim();
        if (!path.startsWith('/')) throw new Error('Path file harus absolut');
        const content = sub(c.content);
        const mode = (c.mode || '').trim();
        if (mode && !/^[0-7]{3,4}$/.test(mode)) throw new Error(`chmod tidak valid: ${mode}`);

        if (c.sudo && this.options.platform === 'unix') {
          // Isi dikirim sebagai base64 supaya aman dari kutip dan karakter khusus.
          const target = shellQuote(path);
          const command =
            `printf '%s' '${toBase64(content)}' | base64 -d | sudo tee -- ${target} > /dev/null` +
            (mode ? ` && sudo chmod ${mode} -- ${target}` : '');
          const res = await this.exec(command, timeout);
          const result = this.commandResult(res, timeout);
          if (result.status === 'success') result.message = `Ditulis ke ${path} dengan sudo${mode ? ` (chmod ${mode})` : ''}`;
          return result;
        }

        await api('/api/files/save', { path, content });
        if (mode) await api('/api/files/chmod', { path, mode });
        return { status: 'success', message: `Ditulis ke ${path}${mode ? ` (chmod ${mode})` : ''}` };
      }

      case 'http_check': {
        const url = sub(c.url).trim();
        if (!/^https?:\/\//.test(url)) throw new Error('URL harus diawali http:// atau https://');
        const expected = (c.expectStatus || '200').split(',').map((s) => s.trim()).filter(Boolean);
        const res = await this.exec(this.httpCheckCommand(url, Math.min(timeout, 120)), timeout);
        const code = res.stdout.trim();
        const ok = res.exitCode === 0 && expected.includes(code);
        return {
          status: ok ? 'success' : 'failed',
          exitCode: res.exitCode,
          stdout: code ? `HTTP ${code}` : '',
          stderr: res.stderr,
          message: ok ? `HTTP ${code}` : code && code !== '000' ? `HTTP ${code}, diharapkan ${expected.join(' / ')}` : 'Tidak ada respons',
        };
      }

      case 'wait': {
        const seconds = Math.max(0, Number(c.seconds) || 0);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, seconds * 1000);
          this.wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        this.wake = null;
        if (this.cancelled) throw new Error('Dihentikan');
        return { status: 'success', message: `Menunggu ${seconds} detik` };
      }
    }
  }
}


function truncate(text?: string) {
  if (!text) return text;
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n… (dipotong, ${text.length - MAX_OUTPUT} karakter lagi)` : text;
}

export function recordRun(pipeline: Pipeline, run: RunRecord) {
  pipeline.runs = [run, ...pipeline.runs.filter((r) => r.id !== run.id)].slice(0, MAX_RUNS);
}
