/**
 * Terminal bawah ServerDeck: shell interaktif sungguhan ke server (PTY), sama
 * seperti membuka `ssh user@host`. Login shell membaca ~/.bash_profile dan
 * ~/.bashrc, sehingga PATH (npm global, nvm, dll.), alias, wizard interaktif,
 * vim, top, dan prompt password sudo berjalan normal.
 *
 * Halaman utama (script inline) hanya membuka/menutup laci dan mengirim event:
 *   app:terminal   { open }   laci dibuka / ditutup
 *   app:ssh-closed            koneksi SSH tab ini diputus
 */
import { createConsole, type ConsoleController, type Status } from './docker-ui/console';
import { serverPlatform, shellQuote } from './client';

const el = document.getElementById('host-terminal')!;
const statusEl = document.getElementById('term-status')!;
const reconnectBtn = document.getElementById('btn-term-reconnect')!;
let ctl: ConsoleController | null = null;
let firstConnect = true;

function winPath(path: string) {
  let p = path.replace(/^\/([A-Za-z]:)/, '$1').replace(/\//g, '\\');
  if (/^[A-Za-z]:$/.test(p)) p += '\\';
  return p;
}

/** Perintah cd ke folder File Manager, sesuai shell server. */
function cdCommand(path: string): string {
  const { platform, shell } = serverPlatform();
  if (platform === 'windows') {
    return shell === 'cmd' ? `cd /d "${winPath(path)}"` : `Set-Location -LiteralPath '${winPath(path).replace(/'/g, "''")}'`;
  }
  return `cd ${shellQuote(path)}`;
}

function currentFolder(): string {
  return document.getElementById('app-container')?.dataset.path || '';
}

function onStatus(status: Status, message?: string) {
  const labels: Record<Status, string> = { idle: '', connecting: 'Menyambung…', connected: '', closed: message || 'Terputus' };
  statusEl.textContent = labels[status];
  reconnectBtn.classList.toggle('hidden', status !== 'closed');

  // Sambungan pertama: langsung pindah ke folder yang sedang dibuka di File Manager.
  if (status === 'connected' && firstConnect) {
    firstConnect = false;
    const folder = currentFolder();
    const home = document.getElementById('app-container')?.dataset.initialHome;
    if (folder && folder !== home) ctl?.send(`${cdCommand(folder)} && clear\r`);
  }
}

function ensure(): ConsoleController {
  if (!ctl) {
    firstConnect = true;
    ctl = createConsole(() => ({ action: 'open-shell' }), el, onStatus);
  }
  return ctl;
}

window.addEventListener('app:terminal', (e) => {
  if (!(e as CustomEvent<{ open: boolean }>).detail.open) return;
  const c = ensure();
  if (c.status === 'idle') c.connect();
  else {
    // Tunggu animasi laci selesai sebelum mengukur ulang ukuran terminal.
    setTimeout(() => {
      c.refit();
      c.focus();
    }, 320);
  }
});

window.addEventListener('app:ssh-closed', () => {
  ctl?.dispose();
  ctl = null;
  statusEl.textContent = '';
  reconnectBtn.classList.add('hidden');
});

reconnectBtn.addEventListener('click', () => ensure().connect());

document.getElementById('btn-term-cd')!.addEventListener('click', () => {
  const folder = currentFolder();
  if (!folder || !ctl) return;
  ctl.send(`${cdCommand(folder)}\r`);
  ctl.focus();
});

document.getElementById('btn-clear-terminal')!.addEventListener('click', () => {
  ctl?.clear();
  ctl?.focus();
});

// Tombol perintah cepat: ketik perintahnya ke shell.
document.querySelectorAll<HTMLElement>('.quick-cmd-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!ctl) return;
    ctl.send(`${btn.dataset.cmd}\r`);
    ctl.focus();
  });
});
