/**
 * Dialog Edit / Duplikat container. Konfigurasi diambil dari server
 * (dibangun dari docker inspect), diedit di sini, lalu di-deploy ulang.
 */
import { api, escapeHtml, ICON, spinner, svg, toast } from '../client';
import { previewCommand, validateSpec, type RunSpec } from '../docker-spec';
import { $, closeDialog, openDialog } from './common';

interface SpecResponse {
  spec: RunSpec;
  warnings: string[];
  running: boolean;
  compose: { project: string; service: string; workingDir: string; configFiles: string[] } | null;
}

export interface DeployResult {
  ok: boolean;
  newId?: string;
  steps: { label: string; ok: boolean; output?: string }[];
}

// ---------- Dialog hasil ----------

export function showDeployResult(title: string, result: DeployResult) {
  const dialog = $('dk-result-dialog');
  $('dk-result-title').textContent = result.ok ? `${title} berhasil` : `${title} gagal`;
  $('dk-result-subtitle').textContent = result.ok
    ? 'Semua langkah selesai.'
    : 'Perubahan dibatalkan. Bila container lama sempat dihentikan, container itu sudah dikembalikan dan dijalankan lagi.';
  $('dk-result-steps').innerHTML = result.steps
    .map((s) => `
      <li class="rounded-lg border ${s.ok ? 'border-slate-100' : 'border-red-100 bg-red-50/50'} p-2.5">
        <p class="flex items-center gap-2 text-[13px] font-medium ${s.ok ? 'text-slate-800' : 'text-red-700'}">
          <span class="inline-flex size-5 shrink-0 items-center justify-center rounded-full ${s.ok ? 'bg-emerald-50 text-emerald-600' : 'bg-red-100 text-red-600'}">${svg(s.ok ? ICON.check : ICON.x, 'size-3', 2.6)}</span>
          ${escapeHtml(s.label)}
        </p>
        ${s.output ? `<pre class="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-slate-950 p-2 font-mono text-[11px] text-slate-300">${escapeHtml(s.output)}</pre>` : ''}
      </li>`)
    .join('');
  openDialog(dialog);
}

$('dk-result-dialog').addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target === e.currentTarget || target.closest('[data-close]')) closeDialog($('dk-result-dialog'));
});

// ---------- Form ----------

let spec: RunSpec | null = null;
let containerId = '';
let mode: 'replace' | 'duplicate' = 'replace';
let onDone: ((newId?: string) => void) | null = null;
let busy = false;

const dialog = $('dk-edit-dialog');
const bodyEl = $('dk-edit-body');

const lines = (list: string[]) => escapeHtml(list.join('\n'));
const field = (label: string, control: string, hint = '', cls = '') =>
  `<div class="${cls}"><label class="field-label">${label}</label>${control}${hint ? `<p class="mt-1 text-[11.5px] text-slate-400">${hint}</p>` : ''}</div>`;
const text = (key: string, value: string, placeholder = '', extra = '') =>
  `<input data-k="${key}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" class="field-input ${extra}" />`;
const area = (key: string, value: string[], placeholder = '', rows = 3) =>
  `<textarea data-list="${key}" rows="${rows}" spellcheck="false" placeholder="${escapeHtml(placeholder)}" class="field-input h-auto resize-y py-2 font-mono text-[12px]">${lines(value)}</textarea>`;
const check = (key: string, value: boolean, label: string, hint = '') =>
  `<label class="flex items-start gap-2 text-[13px] text-slate-700"><input type="checkbox" data-bool="${key}" ${value ? 'checked' : ''} class="mt-0.5 size-4 accent-brand-600" /><span>${label}${hint ? `<span class="block text-[11.5px] text-slate-400">${hint}</span>` : ''}</span></label>`;
const section = (title: string, content: string, hint = '') => `
  <section class="border-t border-slate-100 pt-5 first:border-0 first:pt-0">
    <p class="text-[13.5px] font-semibold text-slate-900">${title}</p>
    ${hint ? `<p class="mt-0.5 text-[12px] text-slate-500">${hint}</p>` : ''}
    <div class="mt-3 space-y-3">${content}</div>
  </section>`;
const removeBtn = (list: string, i: number) =>
  `<button type="button" data-remove="${list}" data-i="${i}" class="icon-btn shrink-0 hover:bg-red-50 hover:text-red-600" aria-label="Hapus baris">${svg(ICON.trash, 'size-3.5')}</button>`;
const addBtn = (list: string, label: string) =>
  `<button type="button" data-add="${list}" class="btn-secondary h-8 px-3">${svg(ICON.plus, 'size-3.5', 2.2)}${label}</button>`;

function envRows(s: RunSpec) {
  return s.env
    .map((e, i) => {
      const eq = e.indexOf('=');
      const k = eq === -1 ? e : e.slice(0, eq);
      const v = eq === -1 ? '' : e.slice(eq + 1);
      return `<div class="flex items-center gap-2">
        <input data-row="env" data-i="${i}" data-f="k" value="${escapeHtml(k)}" placeholder="NAMA" class="field-input w-[38%] font-mono text-[12px]" />
        <input data-row="env" data-i="${i}" data-f="v" value="${escapeHtml(v)}" placeholder="nilai" class="field-input font-mono text-[12px]" />
        ${removeBtn('env', i)}</div>`;
    })
    .join('');
}

function portRows(s: RunSpec) {
  return s.ports
    .map((p, i) => `<div class="flex items-center gap-2">
        <input data-row="ports" data-i="${i}" data-f="hostIp" value="${escapeHtml(p.hostIp)}" placeholder="IP (semua)" class="field-input w-28 font-mono text-[12px]" />
        <input data-row="ports" data-i="${i}" data-f="hostPort" value="${escapeHtml(p.hostPort)}" placeholder="host" class="field-input w-24 font-mono text-[12px]" />
        <span class="text-slate-400">→</span>
        <input data-row="ports" data-i="${i}" data-f="containerPort" value="${escapeHtml(p.containerPort)}" placeholder="container" class="field-input w-24 font-mono text-[12px]" />
        <select data-row="ports" data-i="${i}" data-f="protocol" class="field-input w-24">
          ${['tcp', 'udp', 'sctp'].map((x) => `<option ${p.protocol === x ? 'selected' : ''}>${x}</option>`).join('')}
        </select>
        ${removeBtn('ports', i)}</div>`)
    .join('');
}

function mountRows(s: RunSpec) {
  return s.mounts
    .map((m, i) => {
      const modes = ['', 'ro', ...(m.mode && m.mode !== 'ro' ? [m.mode] : [])];
      return `<div class="flex items-center gap-2">
        <input data-row="mounts" data-i="${i}" data-f="source" value="${escapeHtml(m.source)}" placeholder="/path/host atau nama-volume" class="field-input font-mono text-[12px]" />
        <span class="text-slate-400">→</span>
        <input data-row="mounts" data-i="${i}" data-f="target" value="${escapeHtml(m.target)}" placeholder="/path/container" class="field-input font-mono text-[12px]" />
        <select data-row="mounts" data-i="${i}" data-f="mode" class="field-input w-32">
          ${modes.map((x) => `<option value="${escapeHtml(x)}" ${m.mode === x ? 'selected' : ''}>${x === '' ? 'baca-tulis' : x === 'ro' ? 'read-only' : escapeHtml(x)}</option>`).join('')}
        </select>
        ${removeBtn('mounts', i)}</div>`;
    })
    .join('');
}

function networkRows(s: RunSpec) {
  return s.extraNetworks
    .map((n, i) => `<div class="flex items-center gap-2">
        <input data-row="extraNetworks" data-i="${i}" data-f="name" value="${escapeHtml(n.name)}" placeholder="nama network" class="field-input font-mono text-[12px]" />
        <input data-row="extraNetworks" data-i="${i}" data-f="aliases" value="${escapeHtml(n.aliases.join(', '))}" placeholder="alias (pisahkan koma)" class="field-input font-mono text-[12px]" />
        ${removeBtn('extraNetworks', i)}</div>`)
    .join('');
}

function restartControl(s: RunSpec) {
  const [policy, retries = ''] = (s.restart || 'no').split(':');
  return `<div class="flex items-center gap-2">
    <select data-k="restartPolicy" class="field-input">
      ${[['no', 'Tidak'], ['always', 'Selalu (always)'], ['unless-stopped', 'Kecuali dihentikan (unless-stopped)'], ['on-failure', 'Saat gagal (on-failure)']]
        .map(([v, l]) => `<option value="${v}" ${policy === v ? 'selected' : ''}>${l}</option>`).join('')}
    </select>
    <input data-k="restartRetries" value="${escapeHtml(retries)}" placeholder="maks. ulang" class="field-input w-28 ${policy === 'on-failure' ? '' : 'hidden'}" />
  </div>`;
}

function render(meta: SpecResponse) {
  const s = spec!;
  const banners: string[] = [];
  if (meta.compose && mode === 'replace') {
    banners.push(`Container ini bagian dari stack Compose <b>${escapeHtml(meta.compose.project)}</b> (service <b>${escapeHtml(meta.compose.service)}</b>). Edit di sini mengganti container dengan <code class="font-mono">docker run</code>; file compose tidak ikut berubah, sehingga <code class="font-mono">docker compose up</code> berikutnya bisa mengembalikan konfigurasi lama. Untuk perubahan permanen, edit file compose-nya.`);
  }
  if (mode === 'duplicate') {
    banners.push('Salinan memakai port host yang sama dengan aslinya. Ubah port host agar tidak bentrok, kecuali container asli sedang berhenti.');
  }
  banners.push(...meta.warnings.map(escapeHtml));

  bodyEl.innerHTML = `
    <div id="dk-edit-errors" class="mb-4 hidden rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-[13px] text-red-700"></div>
    ${banners.map((b) => `<div class="mb-3 flex gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-amber-800">${svg(ICON.alert, 'mt-0.5 size-4 shrink-0')}<span>${b}</span></div>`).join('')}
    <div class="space-y-5">
      ${section('Umum', `<div class="grid gap-3 sm:grid-cols-2">
          ${field('Nama container', text('name', s.name, 'nama-container', 'font-mono'))}
          ${field('Image', text('image', s.image, 'nginx:latest', 'font-mono'))}
        </div>`)}

      ${section('Port', `<div class="space-y-2" data-rows="ports">${portRows(s)}</div>
          <div class="flex flex-wrap items-center gap-3">${addBtn('ports', 'Tambah port')}${check('publishAll', s.publishAll, 'Publikasikan semua port EXPOSE ke port acak (-P)')}</div>`,
        'Port host kosong = Docker memilih port acak.')}

      ${section('Volume & mount', `<div class="space-y-2" data-rows="mounts">${mountRows(s)}</div>${addBtn('mounts', 'Tambah mount')}
          ${field('tmpfs', area('tmpfs', s.tmpfs, '/run:rw,size=64m', 2), 'Satu per baris.')}`,
        'Path yang diawali / adalah folder host (bind), selain itu nama volume Docker. Data volume tetap aman saat deploy ulang.')}

      ${section('Environment', `<div class="space-y-2" data-rows="env">${envRows(s)}</div>${addBtn('env', 'Tambah variabel')}`,
        'Hanya variabel yang berbeda dari bawaan image yang ditampilkan.')}

      ${section('Perintah', `<div class="grid gap-3 sm:grid-cols-2">
          ${field('Command (CMD)', area('cmd', s.cmd, 'kosong = bawaan image'), 'Satu argumen per baris.')}
          ${field('Entrypoint', area('entrypoint', s.entrypoint, 'kosong = bawaan image'), 'Satu argumen per baris.')}
          ${field('Folder kerja', text('workdir', s.workdir, 'bawaan image', 'font-mono'))}
          ${field('User', text('user', s.user, 'bawaan image', 'font-mono'))}
        </div>`)}

      ${section('Jaringan', `<div class="grid gap-3 sm:grid-cols-2">
          ${field('Network', text('network', s.network, 'bridge (bawaan)', 'font-mono'), 'Nama network, host, none, atau container:&lt;nama&gt;.')}
          ${field('IP statis', text('ipv4', s.ipv4, 'otomatis', 'font-mono'))}
          ${field('Alias di network ini', area('networkAliases', s.networkAliases, 'web', 2), 'Satu per baris. Dipakai container lain untuk memanggil container ini.')}
          ${field('Hostname', text('hostname', s.hostname, 'otomatis', 'font-mono'))}
        </div>
        <div><p class="field-label">Network tambahan</p><div class="space-y-2" data-rows="extraNetworks">${networkRows(s)}</div><div class="mt-2">${addBtn('extraNetworks', 'Tambah network')}</div></div>
        ${field('Host tambahan (/etc/hosts)', area('extraHosts', s.extraHosts, 'db.local:10.0.0.5', 2), 'Satu per baris, format nama:ip.')}`)}

      ${section('Restart & resource', `<div class="grid gap-3 sm:grid-cols-2">
          ${field('Restart policy', restartControl(s))}
          ${field('Batas memori', text('memory', s.memory, 'tanpa batas (mis. 512m)', 'font-mono'))}
          ${field('Batas CPU', text('cpus', s.cpus, 'tanpa batas (mis. 1.5)', 'font-mono'))}
          ${field('Shared memory', text('shmSize', s.shmSize, 'bawaan 64m', 'font-mono'))}
        </div>`)}

      ${section('Lanjutan', `<div class="grid gap-3 sm:grid-cols-2">
          ${check('privileged', s.privileged, 'Privileged', 'Akses penuh ke host. Hindari bila tidak perlu.')}
          ${check('init', s.init, 'Init (--init)', 'Proses init kecil untuk menangani sinyal dan zombie.')}
          ${check('tty', s.tty, 'TTY (-t)')}
          ${check('interactive', s.interactive, 'Interaktif (-i)')}
          ${field('Tambah capability', area('capAdd', s.capAdd, 'NET_ADMIN', 2))}
          ${field('Buang capability', area('capDrop', s.capDrop, 'ALL', 2))}
          ${field('Device', area('devices', s.devices, '/dev/ttyUSB0:/dev/ttyUSB0', 2))}
          ${field('Label', area('labels', s.labels, 'traefik.enable=true', 2))}
          ${field('Log driver', text('logDriver', s.logDriver, 'json-file (bawaan)', 'font-mono'))}
          ${field('Opsi log', area('logOpts', s.logOpts, 'max-size=10m', 2))}
        </div>
        ${field('Flag tambahan', area('extraArgs', s.extraArgs, '--sysctl net.core.somaxconn=1024', 3), 'Satu flag per baris, diteruskan apa adanya ke docker create.')}`)}

      ${section('Pratinjau perintah', `<pre id="dk-edit-preview" class="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-950 p-3 font-mono text-[11.5px] leading-relaxed text-slate-200"></pre>`,
        'Setara dengan perintah berikut (dijalankan sebagai docker create lalu docker start).')}
    </div>`;
  updatePreview();
}

function updatePreview() {
  const el = document.getElementById('dk-edit-preview');
  if (el && spec) el.textContent = previewCommand(spec);
}

function splitLines(value: string) {
  return value.split('\n').map((s) => s.trim()).filter(Boolean);
}

let meta: SpecResponse | null = null;

bodyEl.addEventListener('input', onEdit);
bodyEl.addEventListener('change', onEdit);

function onEdit(e: Event) {
  if (!spec) return;
  const el = e.target as HTMLInputElement;
  const s = spec as any;

  if (el.dataset.k) {
    const key = el.dataset.k;
    if (key === 'restartPolicy' || key === 'restartRetries') {
      const policy = (bodyEl.querySelector('[data-k="restartPolicy"]') as HTMLSelectElement).value;
      const retriesEl = bodyEl.querySelector('[data-k="restartRetries"]') as HTMLInputElement;
      retriesEl.classList.toggle('hidden', policy !== 'on-failure');
      const retries = retriesEl.value.trim();
      spec.restart = policy === 'on-failure' && /^\d+$/.test(retries) ? `on-failure:${retries}` : policy;
    } else {
      s[key] = el.value;
    }
  } else if (el.dataset.list) {
    s[el.dataset.list] = splitLines(el.value);
  } else if (el.dataset.bool) {
    s[el.dataset.bool] = el.checked;
  } else if (el.dataset.row) {
    const list = el.dataset.row;
    const i = Number(el.dataset.i);
    const f = el.dataset.f!;
    if (list === 'env') {
      const row = el.closest('div')!;
      const k = (row.querySelector('[data-f="k"]') as HTMLInputElement).value.trim();
      const v = (row.querySelector('[data-f="v"]') as HTMLInputElement).value;
      spec.env[i] = `${k}=${v}`;
    } else if (list === 'extraNetworks' && f === 'aliases') {
      spec.extraNetworks[i].aliases = el.value.split(',').map((x) => x.trim()).filter(Boolean);
    } else {
      (spec as any)[list][i][f] = el.value;
    }
  }
  updatePreview();
}

bodyEl.addEventListener('click', (e) => {
  if (!spec) return;
  const target = e.target as HTMLElement;
  const add = target.closest<HTMLElement>('[data-add]');
  const remove = target.closest<HTMLElement>('[data-remove]');
  const list = (add || remove)?.dataset.add || (add || remove)?.dataset.remove;
  if (!list) return;

  if (add) {
    if (list === 'env') spec.env.push('=');
    if (list === 'ports') spec.ports.push({ hostIp: '', hostPort: '', containerPort: '', protocol: 'tcp' });
    if (list === 'mounts') spec.mounts.push({ source: '', target: '', mode: '' });
    if (list === 'extraNetworks') spec.extraNetworks.push({ name: '', aliases: [] });
  } else {
    (spec as any)[list].splice(Number(remove!.dataset.i), 1);
  }

  const rows = bodyEl.querySelector<HTMLElement>(`[data-rows="${list}"]`)!;
  rows.innerHTML = { env: envRows, ports: portRows, mounts: mountRows, extraNetworks: networkRows }[list as 'env']!(spec);
  if (add) (rows.lastElementChild?.querySelector('input') as HTMLInputElement | null)?.focus();
  updatePreview();
});

dialog.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (!busy && (target === dialog || target.closest('[data-close]'))) closeDialog(dialog);
});

$('dk-edit-submit').addEventListener('click', async () => {
  if (!spec || busy) return;
  // Baris env kosong dari tombol "tambah" yang tidak diisi dibuang.
  spec.env = spec.env.filter((e) => e !== '=' && !e.startsWith('='));
  spec.ports = spec.ports.filter((p) => p.containerPort.trim());
  spec.mounts = spec.mounts.filter((m) => m.target.trim());
  spec.extraNetworks = spec.extraNetworks.filter((n) => n.name.trim());

  const errors = validateSpec(spec);
  const errorBox = $('dk-edit-errors');
  if (errors.length) {
    errorBox.innerHTML = errors.map(escapeHtml).join('<br>');
    errorBox.classList.remove('hidden');
    bodyEl.scrollTop = 0;
    return;
  }
  errorBox.classList.add('hidden');

  busy = true;
  const button = $<HTMLButtonElement>('dk-edit-submit');
  const label = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `${spinner('size-3.5')}Men-deploy…`;
  try {
    const data = await api<{ result: DeployResult }>('/api/docker/deploy', {
      id: containerId,
      spec,
      mode,
      pull: $<HTMLInputElement>('dk-edit-pull').checked,
    });
    busy = false;
    closeDialog(dialog);
    showDeployResult(mode === 'duplicate' ? 'Duplikat' : 'Deploy ulang', data.result);
    if (data.result.ok) {
      toast(mode === 'duplicate' ? `Container ${spec.name} dibuat` : `Container ${spec.name} diperbarui`, 'success');
      onDone?.(data.result.newId);
    } else {
      onDone?.();
    }
  } catch (err: any) {
    toast(err.message, 'error');
  } finally {
    busy = false;
    button.disabled = false;
    button.innerHTML = label;
  }
});

export async function openEditor(id: string, editMode: 'replace' | 'duplicate', done: (newId?: string) => void) {
  containerId = id;
  mode = editMode;
  onDone = done;
  $('dk-edit-title').textContent = editMode === 'duplicate' ? 'Duplikat container' : 'Edit container';
  $('dk-edit-subtitle').textContent = editMode === 'duplicate'
    ? 'Membuat container baru dari konfigurasi ini. Container asli tidak diubah.'
    : 'Container lama dihentikan dan diganti. Bila container baru gagal dibuat, container lama dikembalikan otomatis.';
  $('dk-edit-submit').innerHTML = editMode === 'duplicate' ? `${svg(ICON.copy, 'size-3.5')}Buat salinan` : `${svg(ICON.check, 'size-3.5', 2.2)}Simpan & deploy ulang`;
  $<HTMLInputElement>('dk-edit-pull').checked = false;
  bodyEl.innerHTML = `<div class="flex items-center justify-center gap-2 py-20 text-[13px] text-slate-500">${spinner('size-4 text-brand-600')}Membaca konfigurasi container…</div>`;
  openDialog(dialog);

  try {
    meta = await api<SpecResponse>(`/api/docker/container?view=spec&id=${encodeURIComponent(id)}`);
    spec = structuredClone(meta.spec);
    if (editMode === 'duplicate') {
      spec.name = `${spec.name}-copy`;
      spec.ipv4 = '';
      spec.hostname = '';
      // Salinan bukan milik stack compose; tanpa ini compose menganggapnya container miliknya.
      spec.labels = spec.labels.filter((l) => !l.startsWith('com.docker.compose.'));
    }
    render(meta);
  } catch (err: any) {
    bodyEl.innerHTML = `<p class="py-16 text-center text-[13px] text-red-600">${escapeHtml(err.message)}</p>`;
  }
}
