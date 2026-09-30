/**
 * View Docker: daftar container/image/volume, aksi, dan halaman detail
 * (ringkasan, logs, stats, console, inspect).
 */
import { api, confirmAction, currentHost, escapeHtml, formatBytes, ICON, onView, spinner, svg, toast } from '../client';
import {
  $, closeDialog, download, openDialog, portLinks, shortId, stateBadge, stripAnsi,
  type ContainerRow, type ImageRow, type VolumeRow,
} from './common';
import { openEditor, showDeployResult, type DeployResult } from './editor';
import { startStats } from './stats';
import { createConsole, type ConsoleController } from './console';

type Tab = 'containers' | 'images' | 'volumes';
type DetailTab = 'overview' | 'logs' | 'stats' | 'console' | 'inspect';

let tab: Tab = 'containers';
let containers: ContainerRow[] = [];
let images: ImageRow[] = [];
let volumes: VolumeRow[] = [];
const loaded: Record<Tab, boolean> = { containers: false, images: false, volumes: false };
let loadedFor = '';
let unavailable = false;
const busy = new Set<string>();

let detailId: string | null = null;
let detail: any = null;
let dtab: DetailTab = 'overview';
let stopStats: (() => void) | null = null;
let consoleCtl: ConsoleController | null = null;
let logAbort: AbortController | null = null;
let logLines: string[] = [];

const viewActive = () => document.getElementById('app-container')?.dataset.view === 'docker';

// ---------- Memuat data ----------

async function loadInfo() {
  try {
    const { info } = await api<{ info: any }>('/api/docker/info');
    unavailable = false;
    $('dk-unavailable').classList.add('hidden');
    $('dk-content').classList.remove('hidden');
    $('dk-subtitle').innerHTML = `Docker ${escapeHtml(info.version)} · ${escapeHtml(info.os)}${info.viaSudo ? ' · <span class="badge badge-amber">via sudo</span>' : ''}`;
    $('dk-kpis').innerHTML = [
      ['Berjalan', `${info.running}`, `dari ${info.containers} container`],
      ['Berhenti', `${info.stopped}`, info.paused ? `${info.paused} di-pause` : 'container'],
      ['Image', `${info.images}`, info.rootDir ? `di ${info.rootDir}` : ''],
      ['Host', `${info.cpus} CPU`, info.memory ? `${formatBytes(info.memory)} memori` : ''],
    ].map(([label, value, sub]) => `
      <div class="card px-4 py-3.5">
        <p class="text-[12px] font-medium text-slate-500">${label}</p>
        <p class="mt-1 text-[22px] font-bold tracking-tight text-slate-900">${escapeHtml(value)}</p>
        <p class="mt-0.5 truncate text-[12px] text-slate-400">${escapeHtml(sub)}</p>
      </div>`).join('');
    return true;
  } catch (err: any) {
    unavailable = true;
    showUnavailable(err.message);
    return false;
  }
}

function showUnavailable(message: string) {
  $('dk-content').classList.add('hidden');
  const el = $('dk-unavailable');
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="card flex flex-col items-center px-6 py-14 text-center">
      <span class="mb-3 inline-flex size-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">${svg(ICON.container, 'size-6')}</span>
      <p class="text-[15px] font-semibold text-slate-900">Docker tidak bisa diakses</p>
      <p class="mt-1 max-w-lg text-[13px] leading-relaxed text-slate-500">${escapeHtml(message)}</p>
      <button type="button" data-retry class="btn-secondary mt-5">${svg(ICON.refresh, 'size-4')}Coba lagi</button>
    </div>`;
}

$('dk-unavailable').addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('[data-retry]')) refreshAll();
});

async function loadTab(which: Tab, quiet = false) {
  if (!quiet && !loaded[which]) $('dk-table').innerHTML = `<div class="flex items-center justify-center gap-2 py-16 text-[13px] text-slate-500">${spinner('size-4 text-brand-600')}Memuat…</div>`;
  try {
    if (which === 'containers') containers = (await api<{ containers: ContainerRow[] }>('/api/docker/containers')).containers;
    if (which === 'images') images = (await api<{ images: ImageRow[] }>('/api/docker/images')).images;
    if (which === 'volumes') volumes = (await api<{ volumes: VolumeRow[] }>('/api/docker/volumes')).volumes;
    loaded[which] = true;
    updateCounts();
    if (which === tab) renderTable();
  } catch (err: any) {
    if (which === tab && !quiet) $('dk-table').innerHTML = `<p class="py-12 text-center text-[13px] text-red-600">${escapeHtml(err.message)}</p>`;
  }
}

async function refreshAll() {
  const icon = document.querySelector('.dk-refresh-icon');
  icon?.classList.add('animate-spin');
  if (await loadInfo()) {
    await Promise.all([loadTab(tab), ...(['containers', 'images', 'volumes'] as Tab[]).filter((t) => t !== tab).map((t) => loadTab(t, true))]);
  }
  icon?.classList.remove('animate-spin');
}

function updateCounts() {
  const counts: Record<Tab, number | null> = {
    containers: loaded.containers ? containers.length : null,
    images: loaded.images ? images.length : null,
    volumes: loaded.volumes ? volumes.length : null,
  };
  document.querySelectorAll<HTMLElement>('#dk-tabs [data-count]').forEach((el) => {
    const n = counts[el.dataset.count as Tab];
    el.textContent = n === null ? '' : String(n);
  });
}

// ---------- Tab daftar ----------

function setTab(next: Tab) {
  tab = next;
  document.querySelectorAll<HTMLElement>('#dk-tabs [data-tab]').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === next));
  document.querySelectorAll<HTMLElement>('[data-toolbar]').forEach((el) => {
    const show = el.dataset.toolbar === next;
    el.classList.toggle('hidden', !show);
    el.classList.toggle('flex', show);
  });
  $<HTMLInputElement>('dk-search').placeholder = { containers: 'Cari container, image, stack…', images: 'Cari image…', volumes: 'Cari volume…' }[next];
  if (loaded[next]) renderTable();
  else loadTab(next);
}

$('dk-tabs').addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]')?.dataset.tab as Tab | undefined;
  if (t) setTab(t);
});
$('dk-search').addEventListener('input', () => renderTable());
$('dk-state-filter').addEventListener('change', () => renderTable());
$('dk-refresh').addEventListener('click', refreshAll);

const th = (label: string, cls = '') => `<th class="px-4 py-2.5 ${cls}">${label}</th>`;
const tableShell = (head: string, rows: string, empty: string) => `
  <div class="overflow-x-auto">
    <table class="w-full text-left text-[13px]">
      <thead><tr class="border-b border-slate-200 text-[11.5px] font-semibold uppercase tracking-wide text-slate-500">${head}</tr></thead>
      <tbody>${rows || `<tr><td colspan="9" class="px-4 py-14 text-center text-slate-400">${empty}</td></tr>`}</tbody>
    </table>
  </div>`;

const iconBtn = (action: string, icon: string, title: string, extra = '') =>
  `<button type="button" data-act="${action}" title="${title}" aria-label="${title}" class="icon-btn ${extra}">${svg(icon)}</button>`;

function renderTable() {
  const q = $<HTMLInputElement>('dk-search').value.trim().toLowerCase();
  const match = (...fields: string[]) => !q || fields.some((f) => (f || '').toLowerCase().includes(q));

  if (tab === 'containers') {
    const state = $<HTMLSelectElement>('dk-state-filter').value;
    const rows = containers
      .filter((c) => match(c.name, c.image, c.composeProject, c.composeService, c.id))
      .filter((c) => state === 'all' || (state === 'running' ? c.state === 'running' : c.state !== 'running'))
      .sort((a, b) => (a.composeProject || '~').localeCompare(b.composeProject || '~') || a.name.localeCompare(b.name));

    $('dk-table').innerHTML = tableShell(
      th('Nama') + th('Status') + th('Stack', 'hidden md:table-cell') + th('Image', 'hidden lg:table-cell') + th('Port', 'hidden sm:table-cell') + th('Dibuat', 'hidden xl:table-cell') + th('<span class="sr-only">Aksi</span>', 'w-36'),
      rows.map((c) => {
        const running = c.state === 'running';
        const isBusy = busy.has(c.id);
        const quick = isBusy
          ? `<span class="inline-flex size-8 items-center justify-center text-brand-600">${spinner('size-4')}</span>`
          : running
            ? iconBtn('stop', ICON.stop, 'Stop') + iconBtn('restart', ICON.restart, 'Restart')
            : c.state === 'paused'
              ? iconBtn('unpause', ICON.play, 'Lanjutkan')
              : iconBtn('start', ICON.play, 'Start', 'hover:text-brand-700');
        return `
          <tr data-id="${escapeHtml(c.id)}" class="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
            <td class="px-4 py-2.5">
              <p class="max-w-[16rem] truncate font-medium text-slate-900">${escapeHtml(c.name)}</p>
              <p class="font-mono text-[11px] text-slate-400">${shortId(c.id)}</p>
            </td>
            <td class="px-4 py-2.5">${stateBadge(c.state, c.status)}<p class="mt-0.5 text-[11.5px] text-slate-400">${escapeHtml(c.status)}</p></td>
            <td class="hidden px-4 py-2.5 md:table-cell">${c.composeProject ? `<span class="badge badge-violet">${escapeHtml(c.composeProject)}</span>` : '<span class="text-slate-300">—</span>'}</td>
            <td class="hidden px-4 py-2.5 lg:table-cell"><p class="max-w-[16rem] truncate font-mono text-[12px] text-slate-600" title="${escapeHtml(c.image)}">${escapeHtml(c.image)}</p></td>
            <td class="hidden px-4 py-2.5 sm:table-cell">${portLinks(c.ports)}</td>
            <td class="hidden px-4 py-2.5 text-[12.5px] text-slate-500 xl:table-cell">${escapeHtml(c.runningFor)}</td>
            <td class="px-4 py-1.5" data-stop>
              <div class="flex items-center justify-end gap-0.5">${quick}${iconBtn('menu', ICON.more, 'Aksi lainnya')}</div>
            </td>
          </tr>`;
      }).join(''),
      containers.length ? 'Tidak ada container yang cocok.' : 'Belum ada container di server ini.',
    );
    return;
  }

  if (tab === 'images') {
    const rows = images
      .filter((i) => match(i.repository, i.tag, i.id))
      .sort((a, b) => a.repository.localeCompare(b.repository) || a.tag.localeCompare(b.tag));
    $('dk-table').innerHTML = tableShell(
      th('Image') + th('ID', 'hidden sm:table-cell') + th('Ukuran') + th('Dibuat', 'hidden md:table-cell') + th('Dipakai', 'hidden sm:table-cell') + th('<span class="sr-only">Aksi</span>', 'w-24'),
      rows.map((i) => {
        const ref = i.repository !== '<none>' ? `${i.repository}:${i.tag}` : i.id;
        const dangling = i.repository === '<none>';
        return `
          <tr data-image="${escapeHtml(ref)}" class="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
            <td class="px-4 py-2.5">
              <p class="max-w-[22rem] truncate font-mono text-[12.5px] font-medium ${dangling ? 'text-slate-400' : 'text-slate-900'}">${escapeHtml(i.repository)}<span class="text-slate-400">:${escapeHtml(i.tag)}</span></p>
            </td>
            <td class="hidden px-4 py-2.5 font-mono text-[12px] text-slate-500 sm:table-cell">${shortId(i.id)}</td>
            <td class="px-4 py-2.5 text-slate-600">${escapeHtml(i.size)}</td>
            <td class="hidden px-4 py-2.5 text-[12.5px] text-slate-500 md:table-cell">${escapeHtml(i.createdSince)}</td>
            <td class="hidden px-4 py-2.5 sm:table-cell">${i.containers ? `<span class="badge badge-green">${i.containers} container</span>` : '<span class="badge badge-slate">Tidak dipakai</span>'}</td>
            <td class="px-4 py-1.5">
              <div class="flex items-center justify-end gap-0.5">
                ${dangling ? '' : iconBtn('pull', ICON.download, 'Pull versi terbaru')}
                ${iconBtn('rmi', ICON.trash, i.containers ? 'Dipakai container, hapus container-nya dulu' : 'Hapus image', 'hover:bg-red-50 hover:text-red-600')}
              </div>
            </td>
          </tr>`;
      }).join(''),
      images.length ? 'Tidak ada image yang cocok.' : 'Belum ada image.',
    );
    return;
  }

  const rows = volumes.filter((v) => match(v.name, v.composeProject, ...v.usedBy)).sort((a, b) => a.name.localeCompare(b.name));
  $('dk-table').innerHTML = tableShell(
    th('Volume') + th('Stack', 'hidden md:table-cell') + th('Dipakai oleh') + th('Mountpoint', 'hidden lg:table-cell') + th('<span class="sr-only">Aksi</span>', 'w-24'),
    rows.map((v) => `
      <tr data-volume="${escapeHtml(v.name)}" class="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
        <td class="px-4 py-2.5"><p class="max-w-[20rem] truncate font-mono text-[12.5px] font-medium text-slate-900" title="${escapeHtml(v.name)}">${escapeHtml(v.name)}</p><p class="text-[11px] text-slate-400">${escapeHtml(v.driver)}</p></td>
        <td class="hidden px-4 py-2.5 md:table-cell">${v.composeProject ? `<span class="badge badge-violet">${escapeHtml(v.composeProject)}</span>` : '<span class="text-slate-300">—</span>'}</td>
        <td class="px-4 py-2.5">${v.usedBy.length ? v.usedBy.map((n) => `<span class="mr-1 inline-block rounded-md bg-slate-100 px-1.5 py-0.5 text-[11.5px] text-slate-600">${escapeHtml(n)}</span>`).join('') : '<span class="badge badge-slate">Tidak dipakai</span>'}</td>
        <td class="hidden px-4 py-2.5 lg:table-cell"><p class="max-w-[22rem] truncate font-mono text-[11.5px] text-slate-500" title="${escapeHtml(v.mountpoint)}">${escapeHtml(v.mountpoint)}</p></td>
        <td class="px-4 py-1.5">
          <div class="flex items-center justify-end gap-0.5">
            ${iconBtn('open-volume', ICON.external, 'Buka di File Manager')}
            ${iconBtn('rmvol', ICON.trash, v.usedBy.length ? 'Dipakai container, hapus container-nya dulu' : 'Hapus volume', 'hover:bg-red-50 hover:text-red-600')}
          </div>
        </td>
      </tr>`).join(''),
    volumes.length ? 'Tidak ada volume yang cocok.' : 'Belum ada volume.',
  );
}

$('dk-table').addEventListener('click', async (e) => {
  const target = e.target as HTMLElement;
  const act = target.closest<HTMLElement>('[data-act]');

  const row = target.closest<HTMLElement>('tr[data-id]');
  if (row) {
    const c = containers.find((x) => x.id === row.dataset.id);
    if (!c) return;
    if (act) {
      const action = act.dataset.act!;
      if (action === 'menu') openMenu(act, containerMenu(c.id, c.name, c.state, Boolean(c.composeProject)));
      else runContainerAction(c.id, c.name, action);
      return;
    }
    if (target.closest('[data-stop]')) return;
    openDetail(c.id);
    return;
  }

  if (!act) return;
  const imageRef = target.closest<HTMLElement>('tr[data-image]')?.dataset.image;
  const volumeName = target.closest<HTMLElement>('tr[data-volume]')?.dataset.volume;

  if (act.dataset.act === 'pull' && imageRef) pullImage(imageRef);
  if (act.dataset.act === 'rmi' && imageRef) {
    const ok = await confirmAction({ title: `Hapus image ${imageRef}?`, message: 'Image dihapus dari server. Bisa di-pull lagi kapan saja.', okText: 'Hapus' });
    if (ok) mutate(() => api('/api/docker/images', { action: 'remove', ref: imageRef }), 'Image dihapus', ['images']);
  }
  if (act.dataset.act === 'rmvol' && volumeName) {
    const ok = await confirmAction({ title: `Hapus volume ${volumeName}?`, message: 'Semua data di volume ini dihapus permanen dan tidak bisa dikembalikan.', okText: 'Hapus permanen' });
    if (ok) mutate(() => api('/api/docker/volumes', { action: 'remove', name: volumeName }), 'Volume dihapus', ['volumes']);
  }
  if (act.dataset.act === 'open-volume' && volumeName) {
    const v = volumes.find((x) => x.name === volumeName);
    if (v) window.openInFiles?.(v.mountpoint);
  }
});

async function mutate(fn: () => Promise<unknown>, success: string, reload: Tab[]) {
  try {
    await fn();
    toast(success, 'success');
  } catch (err: any) {
    toast(err.message, 'error', 6000);
  }
  await Promise.all(reload.map((t) => loadTab(t, true)));
  loadInfo();
}

async function pullImage(ref: string) {
  toast(`Pull ${ref}… (bisa beberapa menit)`, 'info', 4000);
  await mutate(() => api('/api/docker/images', { action: 'pull', ref }), `${ref} berhasil di-pull`, ['images']);
}

$('dk-pull-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const ref = $<HTMLInputElement>('dk-pull-ref').value.trim();
  if (!ref) return;
  $<HTMLInputElement>('dk-pull-ref').value = '';
  pullImage(ref);
});

$('dk-image-prune').addEventListener('click', async () => {
  const ok = await confirmAction({ title: 'Bersihkan image dangling?', message: 'Image tanpa tag yang tidak dipakai container akan dihapus.', okText: 'Bersihkan' });
  if (ok) mutate(() => api('/api/docker/images', { action: 'prune' }), 'Image dangling dibersihkan', ['images']);
});

$('dk-volume-prune').addEventListener('click', async () => {
  const unused = volumes.filter((v) => !v.usedBy.length).length;
  const ok = await confirmAction({
    title: 'Hapus volume tak terpakai?',
    message: `${unused} volume yang tidak dipakai container mana pun (termasuk yang berhenti) akan dihapus permanen beserta datanya.`,
    okText: 'Hapus permanen',
  });
  if (ok) mutate(() => api('/api/docker/volumes', { action: 'prune' }), 'Volume tak terpakai dihapus', ['volumes']);
});

// ---------- Aksi container ----------

const ACTION_LABEL: Record<string, string> = {
  start: 'dijalankan', stop: 'dihentikan', restart: 'di-restart', kill: 'di-kill', pause: 'di-pause', unpause: 'dilanjutkan', remove: 'dihapus',
};

async function runContainerAction(id: string, name: string, action: string) {
  if (action === 'kill') {
    const ok = await confirmAction({ title: `Kill ${name}?`, message: 'Container dihentikan paksa tanpa kesempatan shutdown dengan rapi (SIGKILL).', okText: 'Kill' });
    if (!ok) return;
  }
  if (action === 'remove') {
    const ok = await confirmAction({ title: `Hapus ${name}?`, message: 'Container dihapus (dihentikan paksa bila sedang berjalan). Volume tidak ikut dihapus.', okText: 'Hapus' });
    if (!ok) return;
  }
  if (action === 'recreate') return openRecreate(id);
  if (action === 'edit') return openEditor(id, 'replace', afterDeploy);
  if (action === 'duplicate') return openEditor(id, 'duplicate', afterDeploy);
  if (action === 'logs' || action === 'console' || action === 'inspect') return openDetail(id, action as DetailTab);

  busy.add(id);
  renderTable();
  renderDetailActions();
  try {
    await api('/api/docker/containers', { id, action });
    toast(`${name} ${ACTION_LABEL[action] || action}`, 'success');
  } catch (err: any) {
    toast(err.message, 'error', 6000);
  } finally {
    busy.delete(id);
  }
  await loadTab('containers', true);
  loadInfo();
  if (detailId === id) {
    if (action === 'remove') closeDetail();
    else await loadDetail();
  }
}

async function afterDeploy(newId?: string) {
  await loadTab('containers', true);
  loadInfo();
  if (detailId && newId) openDetail(newId, dtab);
  else if (detailId) await loadDetail().catch(() => closeDetail());
}

// ---------- Menu aksi ----------

interface MenuItem { action: string; label: string; icon: string; danger?: boolean; divider?: boolean }

function containerMenu(id: string, name: string, state: string, compose: boolean): MenuItem[] {
  const running = state === 'running';
  const items: MenuItem[] = [
    { action: 'logs', label: 'Logs', icon: ICON.output },
    ...(running ? [{ action: 'console', label: 'Console', icon: ICON.terminal }] : []),
    { action: 'inspect', label: 'Inspect', icon: ICON.search },
    { action: running ? 'kill' : 'start', label: running ? 'Kill' : 'Start', icon: running ? ICON.skull : ICON.play, divider: true },
    ...(running ? [{ action: 'pause', label: 'Pause', icon: ICON.pauseBars }] : state === 'paused' ? [{ action: 'unpause', label: 'Lanjutkan', icon: ICON.play }] : []),
    { action: 'recreate', label: compose ? 'Recreate (compose)' : 'Recreate', icon: ICON.refresh },
    { action: 'edit', label: 'Edit', icon: ICON.edit },
    { action: 'duplicate', label: 'Duplikat', icon: ICON.copy },
    { action: 'remove', label: 'Hapus', icon: ICON.trash, danger: true, divider: true },
  ];
  menuTarget = { id, name };
  return items;
}

let menuTarget: { id: string; name: string } | null = null;
const menu = $('dk-menu');

function openMenu(anchor: HTMLElement, items: MenuItem[]) {
  menu.innerHTML = items
    .map((i) => `${i.divider ? '<div class="my-1 h-px bg-slate-100"></div>' : ''}
      <button type="button" data-menu="${i.action}" class="flex h-[34px] w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] font-medium transition ${i.danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'}">
        ${svg(i.icon, `size-4 ${i.danger ? '' : 'text-slate-500'}`)}${i.label}
      </button>`)
    .join('');
  menu.classList.remove('hidden');
  const rect = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const top = rect.bottom + 6 + height > window.innerHeight ? rect.top - height - 6 : rect.bottom + 6;
  menu.style.top = `${Math.max(8, top)}px`;
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width))}px`;
}

function closeMenu() {
  menu.classList.add('hidden');
}

menu.addEventListener('click', (e) => {
  const action = (e.target as HTMLElement).closest<HTMLElement>('[data-menu]')?.dataset.menu;
  closeMenu();
  if (action && menuTarget) runContainerAction(menuTarget.id, menuTarget.name, action);
});
document.addEventListener('mousedown', (e) => {
  if (!menu.classList.contains('hidden') && !menu.contains(e.target as Node) && !(e.target as HTMLElement).closest('[data-act="menu"]')) closeMenu();
});
window.addEventListener('scroll', closeMenu, true);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeMenu();
    closeDialog($('dk-recreate-dialog'));
  }
});

// ---------- Recreate ----------

let recreateId = '';

async function openRecreate(id: string) {
  recreateId = id;
  const c = containers.find((x) => x.id === id) || (detail && detail.Id === id ? { name: detail.Name.replace(/^\//, ''), composeProject: detail.Config?.Labels?.['com.docker.compose.project'] || '', composeService: detail.Config?.Labels?.['com.docker.compose.service'] || '' } : null);
  $('dk-recreate-title').textContent = `Recreate ${c?.name || 'container'}?`;
  $('dk-recreate-desc').innerHTML = c?.composeProject
    ? `Container ini bagian dari stack <b>${escapeHtml(c.composeProject)}</b>. Recreate dijalankan lewat <code class="font-mono">docker compose up --force-recreate ${escapeHtml(c.composeService)}</code> memakai file compose aslinya.`
    : 'Container dibuat ulang dengan konfigurasi yang sama. Volume dan data tetap. Bila gagal, container lama dikembalikan.';
  openDialog($('dk-recreate-dialog'));
}

$('dk-recreate-dialog').addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target === e.currentTarget || target.closest('[data-close]')) closeDialog($('dk-recreate-dialog'));
});

$('dk-recreate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pull = $<HTMLInputElement>('dk-recreate-pull').checked;
  const button = (e.target as HTMLFormElement).querySelector<HTMLButtonElement>('button[type="submit"]')!;
  button.disabled = true;
  button.innerHTML = `${spinner('size-3.5')}Recreate…`;
  busy.add(recreateId);
  renderTable();
  try {
    const data = await api<{ result: DeployResult; strategy: string }>('/api/docker/deploy', { id: recreateId, pull });
    closeDialog($('dk-recreate-dialog'));
    showDeployResult('Recreate', data.result);
    busy.delete(recreateId);
    await loadTab('containers', true);
    loadInfo();
    if (detailId === recreateId) {
      // Compose tidak mengembalikan ID baru; cari container dengan nama yang sama.
      const name = detail?.Name?.replace(/^\//, '');
      const next = data.result.newId || containers.find((c) => c.name === name)?.id;
      if (next) openDetail(next, dtab);
    }
  } catch (err: any) {
    toast(err.message, 'error', 6000);
  } finally {
    busy.delete(recreateId);
    button.disabled = false;
    button.textContent = 'Recreate';
    renderTable();
  }
});

// ---------- Detail ----------

async function openDetail(id: string, initialTab: DetailTab = 'overview') {
  cleanupDetail();
  detailId = id;
  detail = null;
  $('dk-list-screen').classList.add('hidden');
  $('dk-detail-screen').classList.remove('hidden');
  $('dk-detail-name').textContent = containers.find((c) => c.id === id)?.name || shortId(id);
  $('dk-detail-state').innerHTML = '';
  $('dk-detail-sub').textContent = '';
  $('dk-detail-actions').innerHTML = '';
  $('dk-overview').innerHTML = `<div class="flex items-center justify-center gap-2 py-16 text-[13px] text-slate-500">${spinner('size-4 text-brand-600')}Memuat detail…</div>`;
  window.scrollTo({ top: 0 });
  try {
    await loadDetail();
    setDetailTab(initialTab);
  } catch (err: any) {
    $('dk-overview').innerHTML = `<p class="py-12 text-center text-[13px] text-red-600">${escapeHtml(err.message)}</p>`;
  }
}

async function loadDetail() {
  if (!detailId) return;
  const { inspect } = await api<{ inspect: any }>(`/api/docker/container?view=inspect&id=${encodeURIComponent(detailId)}`);
  detail = inspect;
  const name = String(inspect.Name || '').replace(/^\//, '');
  const labels = inspect.Config?.Labels || {};
  $('dk-detail-name').textContent = name;
  $('dk-detail-state').innerHTML = stateBadge(inspect.State?.Status, inspect.State?.Status === 'exited' ? `Exited (${inspect.State?.ExitCode})` : '') +
    (inspect.State?.Health?.Status ? ` <span class="badge ${inspect.State.Health.Status === 'healthy' ? 'badge-green' : inspect.State.Health.Status === 'unhealthy' ? 'badge-red' : 'badge-amber'}">${escapeHtml(inspect.State.Health.Status)}</span>` : '') +
    (labels['com.docker.compose.project'] ? ` <span class="badge badge-violet">${escapeHtml(labels['com.docker.compose.project'])}</span>` : '');
  $('dk-detail-sub').textContent = `${inspect.Config?.Image} · ${shortId(inspect.Id)}`;
  renderDetailActions();
  renderOverview();
  $('dk-inspect-output').innerHTML = highlightJson(JSON.stringify(inspect, null, 2));
}

function renderDetailActions() {
  if (!detail) return;
  const id = detail.Id;
  const state = detail.State?.Status;
  const running = state === 'running';
  if (busy.has(id)) {
    $('dk-detail-actions').innerHTML = `<span class="flex items-center gap-2 text-[13px] text-slate-500">${spinner('size-4 text-brand-600')}Memproses…</span>`;
    return;
  }
  const btn = (action: string, icon: string, label: string, cls = 'btn-secondary') =>
    `<button type="button" data-detail-act="${action}" class="${cls}">${svg(icon, 'size-4')}${label}</button>`;
  $('dk-detail-actions').innerHTML = [
    running ? btn('stop', ICON.stop, 'Stop') : state === 'paused' ? btn('unpause', ICON.play, 'Lanjutkan') : btn('start', ICON.play, 'Start', 'btn-primary'),
    running ? btn('restart', ICON.restart, 'Restart') : '',
    btn('recreate', ICON.refresh, 'Recreate'),
    btn('edit', ICON.edit, 'Edit'),
    `<button type="button" data-detail-act="menu" class="icon-btn size-9 border border-slate-200" title="Aksi lainnya" aria-label="Aksi lainnya">${svg(ICON.more)}</button>`,
  ].join('');
}

$('dk-detail-actions').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-detail-act]');
  if (!btn || !detail) return;
  const name = String(detail.Name || '').replace(/^\//, '');
  const action = btn.dataset.detailAct!;
  if (action === 'menu') {
    const running = detail.State?.Status === 'running';
    const items: MenuItem[] = [
      ...(running ? [{ action: 'kill', label: 'Kill', icon: ICON.skull }, { action: 'pause', label: 'Pause', icon: ICON.pauseBars }] : []),
      { action: 'duplicate', label: 'Duplikat', icon: ICON.copy },
      { action: 'remove', label: 'Hapus', icon: ICON.trash, danger: true, divider: true },
    ];
    menuTarget = { id: detail.Id, name };
    openMenu(btn, items);
    return;
  }
  runContainerAction(detail.Id, name, action);
});

$('dk-back').addEventListener('click', closeDetail);

function closeDetail() {
  cleanupDetail();
  detailId = null;
  detail = null;
  $('dk-detail-screen').classList.add('hidden');
  $('dk-list-screen').classList.remove('hidden');
  renderTable();
}

/** Hentikan semua yang berjalan di halaman detail (stream log, polling stats, konsol). */
function cleanupDetail() {
  stopLogs();
  stopStats?.();
  stopStats = null;
  consoleCtl?.dispose();
  consoleCtl = null;
}

// Pindah ke view lain: stream dan konsol ditutup supaya tidak membebani server.
window.addEventListener('app:view', (e) => {
  if ((e as CustomEvent<{ view: string }>).detail.view !== 'docker') cleanupDetail();
});

function setDetailTab(next: DetailTab) {
  if (dtab === 'logs' && next !== 'logs') stopLogs();
  if (dtab === 'stats' && next !== 'stats') {
    stopStats?.();
    stopStats = null;
  }
  dtab = next;
  document.querySelectorAll<HTMLElement>('#dk-detail-tabs [data-dtab]').forEach((b) => b.classList.toggle('is-active', b.dataset.dtab === next));
  document.querySelectorAll<HTMLElement>('[data-dpanel]').forEach((p) => p.classList.toggle('hidden', p.dataset.dpanel !== next));
  if (!detail) return;
  const running = detail.State?.Status === 'running';

  if (next === 'logs') {
    $<HTMLInputElement>('dk-log-follow').checked = running;
    startLogs();
  }
  if (next === 'stats') stopStats = startStats(detail.Id, $('dk-stats'), running);
  if (next === 'console') {
    if (!consoleCtl) {
      const containerId = detail.Id;
      consoleCtl = createConsole(
        () => ({
          action: 'open',
          container: containerId,
          shell: $<HTMLSelectElement>('dk-console-shell').value,
          user: $<HTMLInputElement>('dk-console-user').value.trim(),
        }),
        $('dk-console-term'),
        renderConsoleStatus,
      );
      renderConsoleStatus('idle');
      if (running) consoleCtl.connect();
    } else {
      requestAnimationFrame(() => consoleCtl?.refit());
    }
    if (!running) renderConsoleStatus('idle', 'Container tidak berjalan; konsol butuh container running.');
  }
}

$('dk-detail-tabs').addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-dtab]')?.dataset.dtab as DetailTab | undefined;
  if (t) setDetailTab(t);
});

// ---------- Ringkasan ----------

function kv(label: string, value: string, mono = false) {
  return `<div class="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 border-b border-slate-100 py-2 last:border-0">
    <dt class="text-[12.5px] text-slate-500">${label}</dt>
    <dd class="min-w-0 break-words text-[13px] text-slate-800 ${mono ? 'font-mono text-[12px]' : ''}">${value || '<span class="text-slate-300">—</span>'}</dd>
  </div>`;
}

const card = (title: string, content: string, extra = '') =>
  `<div class="card p-4 ${extra}"><p class="mb-1 text-[13.5px] font-semibold text-slate-900">${title}</p>${content}</div>`;

const fmtDate = (s?: string) => (!s || s.startsWith('0001') ? '' : new Date(s).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }));

let envRevealed = false;

function renderOverview() {
  const d = detail;
  const cfg = d.Config || {};
  const host = d.HostConfig || {};
  const st = d.State || {};
  const labels = cfg.Labels || {};
  const compose = labels['com.docker.compose.project'];
  const rp = host.RestartPolicy?.Name || 'no';

  const composeBanner = compose
    ? `<div class="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-violet-100 bg-violet-50/60 px-4 py-3">
        <span class="inline-flex size-8 items-center justify-center rounded-lg bg-violet-100 text-violet-700">${svg(ICON.layers)}</span>
        <div class="min-w-0 flex-1">
          <p class="text-[13px] font-semibold text-slate-900">Stack Compose ${escapeHtml(compose)} · service ${escapeHtml(labels['com.docker.compose.service'] || '')}</p>
          <p class="truncate font-mono text-[11.5px] text-slate-500">${escapeHtml(labels['com.docker.compose.project.config_files'] || labels['com.docker.compose.project.working_dir'] || '')}</p>
        </div>
        ${labels['com.docker.compose.project.working_dir'] ? `<button type="button" data-open-path="${escapeHtml(labels['com.docker.compose.project.working_dir'])}" class="btn-secondary h-8 px-3">${svg(ICON.external, 'size-3.5')}Buka folder compose</button>` : ''}
      </div>`
    : '';

  const networks = Object.entries<any>(d.NetworkSettings?.Networks || {});
  const ports = Object.entries<any>(d.NetworkSettings?.Ports || {});
  const serverHost = currentHost().split('@').pop();

  const portList = ports.length
    ? ports.map(([port, bindings]) => {
        const targets = (bindings || []).map((b: any) => `${b.HostIp && b.HostIp !== '0.0.0.0' && b.HostIp !== '::' ? `${b.HostIp}:` : ''}${b.HostPort}`);
        const unique = [...new Set(targets)] as string[];
        return `<div class="flex items-center gap-2 py-1 font-mono text-[12px]"><span class="text-slate-700">${escapeHtml(port)}</span><span class="text-slate-300">←</span>${
          unique.length
            ? unique.map((t) => {
                const hp = t.split(':').pop();
                return `<a href="${port.startsWith('443/') ? 'https' : 'http'}://${escapeHtml(serverHost || '')}:${escapeHtml(hp || '')}" target="_blank" rel="noopener noreferrer" class="text-brand-700 hover:underline">${escapeHtml(t)}</a>`;
              }).join(', ')
            : '<span class="text-slate-400">tidak dipublikasikan</span>'
        }</div>`;
      }).join('')
    : '<p class="py-1 text-[12.5px] text-slate-400">Tidak ada port.</p>';

  const mounts = (d.Mounts || []).map((m: any) => `
    <tr class="border-b border-slate-100 last:border-0">
      <td class="py-2 pr-3"><span class="badge ${m.Type === 'volume' ? 'badge-brand' : 'badge-slate'}">${escapeHtml(m.Type)}</span></td>
      <td class="py-2 pr-3"><p class="max-w-[18rem] truncate font-mono text-[12px] text-slate-700" title="${escapeHtml(m.Name || m.Source)}">${escapeHtml(m.Type === 'volume' ? m.Name : m.Source)}</p></td>
      <td class="py-2 pr-3 font-mono text-[12px] text-slate-700">${escapeHtml(m.Destination)}</td>
      <td class="py-2 pr-3 text-[12px] text-slate-500">${m.RW ? 'rw' : 'ro'}</td>
      <td class="py-2 text-right">${m.Source ? `<button type="button" data-open-path="${escapeHtml(m.Source)}" class="icon-btn size-7" title="Buka di File Manager" aria-label="Buka di File Manager">${svg(ICON.external, 'size-3.5')}</button>` : ''}</td>
    </tr>`).join('');

  const env: string[] = cfg.Env || [];
  const envRows = env.map((e) => {
    const i = e.indexOf('=');
    const k = i === -1 ? e : e.slice(0, i);
    const v = i === -1 ? '' : e.slice(i + 1);
    return `<div class="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)] gap-3 border-b border-slate-100 py-1.5 font-mono text-[12px] last:border-0">
      <span class="truncate text-slate-500" title="${escapeHtml(k)}">${escapeHtml(k)}</span>
      <span class="break-all text-slate-800">${envRevealed ? escapeHtml(v) : v ? '••••••••' : ''}</span>
    </div>`;
  }).join('');

  $('dk-overview').innerHTML = `
    ${composeBanner}
    <div class="grid gap-4 lg:grid-cols-2">
      ${card('Status', `<dl>
        ${kv('Status', stateBadge(st.Status, st.Status === 'exited' ? `Exited (${st.ExitCode})` : ''))}
        ${kv('Dimulai', escapeHtml(fmtDate(st.StartedAt)))}
        ${st.Status !== 'running' ? kv('Berhenti', escapeHtml(fmtDate(st.FinishedAt))) : ''}
        ${kv('Dibuat', escapeHtml(fmtDate(d.Created)))}
        ${kv('Restart policy', escapeHtml(rp + (host.RestartPolicy?.MaximumRetryCount ? `:${host.RestartPolicy.MaximumRetryCount}` : '')))}
        ${kv('Jumlah restart', String(d.RestartCount ?? 0))}
        ${st.Health ? kv('Health', `${escapeHtml(st.Health.Status)} <span class="text-slate-400">(${st.Health.FailingStreak || 0} gagal beruntun)</span>`) : ''}
        ${st.Error ? kv('Error', `<span class="text-red-600">${escapeHtml(st.Error)}</span>`) : ''}
      </dl>`)}
      ${card('Image & perintah', `<dl>
        ${kv('Image', escapeHtml(cfg.Image), true)}
        ${kv('Image ID', escapeHtml(shortId(d.Image || '')), true)}
        ${kv('Command', escapeHtml([...(cfg.Entrypoint || []), ...(cfg.Cmd || [])].join(' ')), true)}
        ${kv('Folder kerja', escapeHtml(cfg.WorkingDir || ''), true)}
        ${kv('User', escapeHtml(cfg.User || 'root (bawaan)'), true)}
        ${kv('Hostname', escapeHtml(cfg.Hostname || ''), true)}
      </dl>`)}
      ${card('Jaringan', `
        <div class="py-1">${networks.length ? networks.map(([name, n]) => `
          <div class="border-b border-slate-100 py-2 last:border-0">
            <p class="text-[13px] font-medium text-slate-800">${escapeHtml(name)}</p>
            <p class="font-mono text-[12px] text-slate-500">${escapeHtml(n.IPAddress || 'tanpa IP')}${n.Gateway ? ` · gw ${escapeHtml(n.Gateway)}` : ''}</p>
            ${(n.Aliases || []).length ? `<p class="text-[11.5px] text-slate-400">alias: ${escapeHtml(n.Aliases.join(', '))}</p>` : ''}
          </div>`).join('') : `<p class="py-1 text-[12.5px] text-slate-400">Mode ${escapeHtml(host.NetworkMode || '')}</p>`}</div>
        <p class="mb-1 mt-3 text-[12px] font-semibold uppercase tracking-wide text-slate-400">Port</p>${portList}`)}
      ${card('Mount', mounts ? `<div class="overflow-x-auto"><table class="w-full text-left"><tbody>${mounts}</tbody></table></div>` : '<p class="py-1 text-[12.5px] text-slate-400">Tidak ada mount.</p>')}
      ${card(`Environment <span class="font-normal text-slate-400">(${env.length})</span>`, `
        <div class="-mt-6 mb-2 flex justify-end">
          <button type="button" data-toggle-env class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            ${svg(envRevealed ? ICON.eyeOff : ICON.eye, 'size-3.5')}${envRevealed ? 'Sembunyikan nilai' : 'Tampilkan nilai'}
          </button>
        </div>
        <div class="max-h-80 overflow-y-auto">${envRows || '<p class="text-[12.5px] text-slate-400">Tidak ada variabel.</p>'}</div>`, 'lg:col-span-2')}
      ${Object.keys(labels).length ? card(`Label <span class="font-normal text-slate-400">(${Object.keys(labels).length})</span>`, `
        <div class="max-h-64 overflow-y-auto">${Object.entries<string>(labels).map(([k, v]) => `
          <div class="grid grid-cols-[minmax(0,18rem)_minmax(0,1fr)] gap-3 border-b border-slate-100 py-1.5 font-mono text-[12px] last:border-0">
            <span class="truncate text-slate-500" title="${escapeHtml(k)}">${escapeHtml(k)}</span><span class="break-all text-slate-800">${escapeHtml(v)}</span>
          </div>`).join('')}</div>`, 'lg:col-span-2') : ''}
    </div>`;
}

$('dk-overview').addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('[data-toggle-env]')) {
    envRevealed = !envRevealed;
    renderOverview();
  }
  const open = target.closest<HTMLElement>('[data-open-path]');
  if (open) {
    cleanupDetail();
    window.openInFiles?.(open.dataset.openPath!);
  }
});

// ---------- Logs ----------

let renderQueued = false;
let partial = '';

function scheduleLogRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    const pre = $('dk-log-output');
    const filter = $<HTMLInputElement>('dk-log-filter').value.trim().toLowerCase();
    const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 60;
    const shown = filter ? logLines.filter((l) => l.toLowerCase().includes(filter)) : logLines;
    pre.textContent = shown.length ? shown.join('\n') : filter ? '(tidak ada baris yang cocok)' : '';
    if (atBottom) pre.scrollTop = pre.scrollHeight;
  });
}

function stopLogs() {
  logAbort?.abort();
  logAbort = null;
}

async function startLogs() {
  if (!detail) return;
  stopLogs();
  logLines = [];
  partial = '';
  const pre = $('dk-log-output');
  pre.textContent = '';
  const status = $('dk-log-status');
  const follow = $<HTMLInputElement>('dk-log-follow').checked;
  const params = new URLSearchParams({
    id: detail.Id,
    tail: $<HTMLSelectElement>('dk-log-tail').value,
    timestamps: $<HTMLInputElement>('dk-log-ts').checked ? '1' : '0',
    follow: follow ? '1' : '0',
  });
  status.textContent = 'Memuat…';

  const controller = new AbortController();
  logAbort = controller;
  try {
    const res = await fetch(`/api/docker/logs?${params}`, { signal: controller.signal });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Gagal memuat log (${res.status})`);
    }
    status.innerHTML = follow ? '<span class="text-emerald-400">●</span> Live' : '';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let first = true;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = partial + decoder.decode(value, { stream: true });
      const parts = text.split('\n');
      partial = parts.pop() ?? '';
      logLines.push(...parts.map(stripAnsi));
      if (logLines.length > 20000) logLines.splice(0, logLines.length - 20000);
      if (first) {
        first = false;
        requestAnimationFrame(() => (pre.scrollTop = pre.scrollHeight));
      }
      scheduleLogRender();
    }
    if (partial) logLines.push(stripAnsi(partial));
    partial = '';
    scheduleLogRender();
    if (logAbort === controller) status.textContent = `${logLines.length} baris${follow ? ' · stream berakhir' : ''}`;
  } catch (err: any) {
    if (err?.name !== 'AbortError') {
      status.textContent = '';
      pre.textContent = `Error: ${err.message}`;
    }
  }
}

['dk-log-tail', 'dk-log-follow', 'dk-log-ts'].forEach((id) => $(id).addEventListener('change', () => startLogs()));
$('dk-log-filter').addEventListener('input', scheduleLogRender);
$('dk-log-wrap').addEventListener('change', (e) => {
  const wrap = (e.target as HTMLInputElement).checked;
  $('dk-log-output').classList.toggle('whitespace-pre-wrap', wrap);
  $('dk-log-output').classList.toggle('break-all', wrap);
});
$('dk-log-output').classList.add('whitespace-pre-wrap', 'break-all');
$('dk-log-clear').addEventListener('click', () => {
  logLines = [];
  scheduleLogRender();
});
$('dk-log-download').addEventListener('click', () => {
  const name = String(detail?.Name || 'container').replace(/^\//, '');
  download(`${name}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`, logLines.join('\n'));
});

// ---------- Console ----------

function renderConsoleStatus(status: string, message?: string) {
  const btn = $<HTMLButtonElement>('dk-console-connect');
  const label = $('dk-console-status');
  const running = detail?.State?.Status === 'running';
  if (status === 'connected') {
    btn.className = 'btn-secondary h-8 px-3';
    btn.textContent = 'Putuskan';
    label.innerHTML = '<span class="text-emerald-600">●</span> Tersambung';
  } else if (status === 'connecting') {
    btn.className = 'btn-secondary h-8 px-3';
    btn.innerHTML = `${spinner('size-3.5')}Menyambung…`;
    label.textContent = '';
  } else {
    btn.className = 'btn-primary h-8 px-3';
    btn.textContent = status === 'closed' ? 'Sambungkan lagi' : 'Sambungkan';
    label.textContent = message || (status === 'closed' ? 'Terputus' : '');
  }
  btn.disabled = status === 'connecting' || !running;
}

$('dk-console-connect').addEventListener('click', () => {
  if (!consoleCtl) return;
  if (consoleCtl.status === 'connected') consoleCtl.disconnect();
  else consoleCtl.connect();
});

// ---------- Inspect ----------

function highlightJson(json: string): string {
  return escapeHtml(json).replace(
    /(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match, str, colon, lit, num) => {
      if (str) return colon ? `<span class="text-sky-300">${str}</span>${colon}` : `<span class="text-emerald-300">${str}</span>`;
      if (lit) return `<span class="text-violet-300">${lit}</span>`;
      if (num) return `<span class="text-amber-300">${num}</span>`;
      return match;
    },
  );
}

$('dk-inspect-copy').addEventListener('click', async () => {
  if (!detail) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(detail, null, 2));
    toast('JSON disalin', 'success');
  } catch {
    toast('Browser menolak akses clipboard', 'error');
  }
});

// ---------- Mulai & auto-refresh ----------

onView('docker', () => {
  const host = currentHost();
  if (host !== loadedFor) {
    loadedFor = host;
    loaded.containers = loaded.images = loaded.volumes = false;
    if (detailId) closeDetail();
    refreshAll();
  } else if (!unavailable) {
    loadTab('containers', true);
    loadInfo();
  }
});

// Daftar container diperbarui tiap 10 detik selama terlihat.
setInterval(() => {
  if (!viewActive() || document.hidden || unavailable || detailId || tab !== 'containers' || !loaded.containers) return;
  if (!menu.classList.contains('hidden')) return;
  loadTab('containers', true);
}, 10_000);
