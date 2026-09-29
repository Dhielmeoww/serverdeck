/**
 * Tab Console: terminal interaktif ke dalam container (docker exec -it).
 * xterm.js baru dimuat saat konsol pertama kali dibuka.
 */
import { api } from '../client';

type Status = 'idle' | 'connecting' | 'connected' | 'closed';

export interface ConsoleController {
  connect(): Promise<void>;
  disconnect(): void;
  /** Panggil saat tab konsol tampil lagi supaya ukuran terminal pas. */
  refit(): void;
  /** Tutup sesi dan lepas terminal (saat meninggalkan halaman detail). */
  dispose(): void;
  readonly status: Status;
}

export function createConsole(
  containerId: string,
  el: HTMLElement,
  getOptions: () => { shell: string; user: string },
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

    // Input dikirim berurutan; ketikan cepat digabung dalam satu permintaan.
    let queue = '';
    let sending = false;
    const flush = async () => {
      if (sending || !queue || !consoleId) return;
      sending = true;
      const data = queue;
      queue = '';
      try {
        await api('/api/docker/console', { action: 'input', console: consoleId, data });
      } catch {
        // sesi berakhir; ditangani oleh pembaca stream
      }
      sending = false;
      if (queue) flush();
    };
    term.onData((data) => {
      if (status !== 'connected') return;
      queue += data;
      flush();
    });

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
      api('/api/docker/console', { action: 'resize', console: consoleId, cols: term.cols, rows: term.rows }).catch(() => {});
    }
  }

  async function connect() {
    if (status === 'connecting' || status === 'connected') return;
    setStatus('connecting');
    try {
      await ensureTerminal();
      term!.reset();
      fit!.fit();
      const { shell, user } = getOptions();
      const opened = await api<{ console: string }>('/api/docker/console', {
        action: 'open', container: containerId, shell, user, cols: term!.cols, rows: term!.rows,
      });
      consoleId = opened.console;

      abort = new AbortController();
      const res = await fetch(`/api/docker/console?console=${encodeURIComponent(consoleId)}`, { signal: abort.signal });
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
    if (id) api('/api/docker/console', { action: 'close', console: id }).catch(() => {});
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
    get status() {
      return status;
    },
  };
}
