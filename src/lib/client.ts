/**
 * Utilitas sisi browser untuk komponen view (Pipelines, Storage).
 * Toast dan dialog konfirmasi disediakan Layout.astro lewat `window`.
 */

type ToastType = 'success' | 'error' | 'info';

interface ConfirmOptions {
  title: string;
  message?: string;
  okText?: string;
  danger?: boolean;
}

declare global {
  interface Window {
    showToast(message: string, type?: ToastType, duration?: number): void;
    confirmDialog(options: ConfirmOptions): Promise<boolean>;
    openInFiles?(path: string): void;
  }
}

export const toast = (message: string, type: ToastType = 'info', duration?: number) =>
  window.showToast(message, type, duration);

export const confirmAction = (options: ConfirmOptions) => window.confirmDialog(options);

export async function api<T = any>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || `Request gagal (${res.status})`);
  return data as T;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${sizes[i]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} dtk`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}d`;
}

export function formatRelative(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'baru saja';
  if (min < 60) return `${min} menit lalu`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return new Date(timestamp).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Label user@host dari header aplikasi. */
export function currentHost(): string {
  return document.getElementById('header-user-host')?.textContent?.trim() || '';
}

/** OS dan shell server yang terhubung, diisi halaman utama dari /api/auth/status. */
export function serverPlatform(): { platform: 'unix' | 'windows'; shell: 'sh' | 'cmd' | 'powershell' } {
  const el = document.getElementById('app-container');
  return {
    platform: el?.dataset.platform === 'windows' ? 'windows' : 'unix',
    shell: (['cmd', 'powershell'].includes(el?.dataset.shell || '') ? el!.dataset.shell : 'sh') as 'sh' | 'cmd' | 'powershell',
  };
}

/**
 * Panggil `callback` setiap kali view `name` tampil, termasuk bila view itu
 * sudah aktif sebelum modul ini dimuat.
 */
export function onView(name: string, callback: () => void) {
  window.addEventListener('app:view', (e) => {
    if ((e as CustomEvent<{ view: string }>).detail.view === name) callback();
  });
  const container = document.getElementById('app-container');
  if (container?.dataset.view === name && container.dataset.ready === 'true') callback();
}

export const svg = (d: string, cls = 'size-4', stroke = 1.8) =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ICON = {
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  branch: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 8v8M18 10a6 6 0 0 1-6 6H8"/>',
  fileEdit: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4"/><path d="M14 3v5h5M18.4 12.6a1.9 1.9 0 0 1 2.7 2.7L16 20.4l-3.5.9.9-3.5Z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  play: '<path d="M7 4v16l13-8Z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 13 4 4L19 7"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  minus: '<path d="M5 12h14"/>',
  pause: '<path d="M12 8v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  download: '<path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M12 4v11M7 10l5 5 5-5"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9Z"/>',
  flag: '<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  alert: '<path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  output: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  restart: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  pauseBars: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  skull: '<path d="M12 3a8 8 0 0 0-5 14.2V20a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2.8A8 8 0 0 0 12 3Z"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><path d="M10 21v-2M14 21v-2"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/>',
  database: '<ellipse cx="12" cy="5.5" rx="8" ry="2.5"/><path d="M4 5.5v13c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-13"/><path d="M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5"/>',
  container: '<rect x="2" y="7" width="20" height="12" rx="2"/><path d="M6.5 7v12M11 7v12M15.5 7v12M2 11h20M9 3h6v4H9z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.3 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  broom: '<path d="M19 3 9.5 12.5M7 11l6 6M3 21c1-4 3-7 6-9l3 3c-2 3-5 5-9 6Z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 9.2-9.2M16 7l3 3M14 9l2 2"/>',
};

export function spinner(cls = 'size-4') {
  return `<span class="${cls} inline-block animate-spin rounded-full border-2 border-current border-t-transparent"></span>`;
}
