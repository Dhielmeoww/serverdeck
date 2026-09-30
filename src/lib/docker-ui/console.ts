/**
 * Terminal interaktif di browser (xterm.js + PTY lewat SSH). Dipakai untuk
 * console Docker (docker exec -it) dan terminal server (shell seperti ssh).
 * xterm.js baru dimuat saat terminal pertama kali dibuka.
 */
import { api } from '../client';

export type Status = 'idle' | 'connecting' | 'connected' | 'closed';

/** Payload pembuka sesi untuk /api/console (tanpa cols/rows, diisi otomatis). */
export type OpenPayload = { action: 'open'; container: string; shell: string; user: string } | { action: 'open-shell' };

export interface ConsoleController {
  connect(): Promise<void>;
  disconnect(): void;
  /** Panggil saat tab konsol tampil lagi supaya ukuran terminal pas. */
  refit(): void;
  /** Tutup sesi dan lepas terminal (saat meninggalkan halaman detail). */
  dispose(): void;
  /** Kirim teks seolah diketik (mis. "cd /var/www\r"). */
  send(data: string): void;
  /** Bersihkan layar di browser. */
  clear(): void;
  focus(): void;
  readonly status: Status;
}

export function createConsole(
  getPayload: () => OpenPayload,
  el: HTMLElement,
  onStatus: (status: Status, message?: string) => void,
): ConsoleController {
  let term: import('@xterm/xterm').Terminal | null = null;
  let fit: import('@xterm/addon-fit').FitAddon | null = null;
  let consoleId: string | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let abort: AbortController | null = null;
  let status: Status = 'idle';
  let observer: ResizeObserver | null = null;
  let resizeTimer: number | undefined;

  const setStatus = (s: Status, message?: string) => {
    status = s;
    onStatus(s, message);
  };

  // Input dikirim berurutan; ketikan cepat digabung dalam satu permintaan.
  let queue = '';
  let sending = false;
  const flush = async () => {
    if (sending || !queue || !consoleId) return;
    sending = true;
    const data = queue;
    queue = '';
    try {
      await api('/api/console', { action: 'input', console: consoleId, data });
    } catch {
      // sesi berakhir; ditangani oleh pembaca stream
    }
    sending = false;
    if (queue) flush();
  };

  function send(data: string) {
    if (status !== 'connected') return;
    queue += data;
    flush();
  }

  async function ensureTerminal() {
    if (term) return;
    // CSS xterm dimuat statis oleh DockerView.astro; modul JS-nya baru diunduh di sini.
    const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]);
    term = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 13,
      scrollback: 5000,
      theme: { background: '#020617', foreground: '#e2e8f0', cursor: '#7CC8A5', selectionBackground: '#17624C' },
    });
    fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    term.onData(send);

    observer = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(refit, 120);
    });
    observer.observe(el);
  }

  function refit() {
    if (!term || !fit || el.offsetParent === null) return;
    fit.fit();
    if (consoleId && status === 'connected') {
      api('/api/console', { action: 'resize', console: consoleId, cols: term.cols, rows: term.rows }).catch(() => {});
    }
  }

  async function connect() {
    if (status === 'connecting' || status === 'connected') return;
    setStatus('connecting');
    try {
      await ensureTerminal();
      term!.reset();
      fit!.fit();
      const opened = await api<{ console: string }>('/api/console', { ...getPayload(), cols: term!.cols, rows: term!.rows });
      consoleId = opened.console;

      abort = new AbortController();
      const res = await fetch(`/api/console?console=${encodeURIComponent(consoleId)}`, { signal: abort.signal });
      if (!res.ok || !res.body) throw new Error(`Gagal membuka stream konsol (${res.status})`);
      reader = res.body.getReader();
      setStatus('connected');
      term!.focus();

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) term!.write(value);
      }
      term!.write('\r\n\x1b[90m[Sesi konsol berakhir]\x1b[0m\r\n');
      setStatus('closed');
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setStatus('closed');
      } else {
        term?.write(`\r\n\x1b[31m${err?.message || err}\x1b[0m\r\n`);
        setStatus('closed', err?.message);
      }
    } finally {
      reader = null;
      abort = null;
      consoleId = null;
    }
  }

  function disconnect() {
    const id = consoleId;
    abort?.abort();
    if (id) api('/api/console', { action: 'close', console: id }).catch(() => {});
  }

  function dispose() {
    disconnect();
    observer?.disconnect();
    observer = null;
    term?.dispose();
    term = null;
    fit = null;
    el.innerHTML = '';
  }

  return {
    connect,
    disconnect,
    refit,
    dispose,
    send,
    clear: () => term?.clear(),
    focus: () => term?.focus(),
    get status() {
      return status;
    },
  };
}
