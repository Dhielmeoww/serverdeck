/**
 * Halaman Hermes Agent: chat, status, gateway, log, konfigurasi, cron & sesi.
 */
import { api, confirmAction, currentHost, escapeHtml, ICON, onView, spinner, svg, toast } from './client';

interface Info {
  installed: boolean;
  path: string;
  version: string;
  home: string;
  streamJson: boolean;
  configExists: boolean;
  envExists: boolean;
  logs: string[];
}

interface ActionResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

type Tab = 'chat' | 'overview' | 'gateway' | 'logs' | 'config' | 'jobs';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const root = document.querySelector<HTMLElement>('[data-view-panel="hermes"]')!;

const INSTALL_COMMAND = 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash';

let info: Info | null = null;
let loadedFor = '';
let tab: Tab = 'chat';
const loadedTabs = new Set<Tab>();

// ---------- Info & keadaan ----------

async function loadInfo() {
  $('hm-state').innerHTML = `<div class="card flex items-center justify-center gap-2 py-16 text-[13px] text-slate-500">${spinner('size-4 text-brand-600')}Memeriksa Hermes di server…</div>`;
  $('hm-main').classList.add('hidden');
  loadedTabs.clear();
  try {
    info = (await api<{ info: Info }>('/api/hermes?view=info')).info;
  } catch (err: any) {
    info = null;
    $('hm-state').innerHTML = `<div class="card px-6 py-14 text-center"><p class="text-[15px] font-semibold text-slate-900">Hermes tidak bisa diperiksa</p><p class="mt-1 text-[13px] text-slate-500">${escapeHtml(err.message)}</p></div>`;
    return;
  }

  if (!info.installed) {
    $('hm-subtitle').textContent = 'Belum terpasang di server ini.';
    $('hm-state').innerHTML = `
      <div class="card flex flex-col items-center px-6 py-12 text-center">
        <span class="mb-3 inline-flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">${svg(ICON.zap, 'size-6')}</span>
        <p class="text-[15px] font-semibold text-slate-900">Hermes Agent belum terpasang</p>
        <p class="mt-1 max-w-lg text-[13px] leading-relaxed text-slate-500">Installer resmi akan memasang Hermes beserta Python, Node.js, dan ripgrep bila belum ada. Installer berjalan di terminal interaktif sehingga kamu bisa menjawab pertanyaannya.</p>
        <pre class="mt-4 max-w-full overflow-x-auto rounded-lg bg-slate-950 px-4 py-2.5 text-left font-mono text-[12px] text-slate-200">${escapeHtml(INSTALL_COMMAND)}</pre>
        <div class="mt-5 flex flex-wrap justify-center gap-2">
          <button type="button" data-terminal="${escapeHtml(INSTALL_COMMAND)}" class="btn-primary">${svg(ICON.terminal, 'size-4')}Install di terminal</button>
          <button type="button" data-reload class="btn-secondary">${svg(ICON.refresh, 'size-4')}Sudah terpasang? Periksa lagi</button>
        </div>
      </div>`;
    return;
  }

  $('hm-subtitle').innerHTML = `${escapeHtml(info.version || 'versi tidak diketahui')} · <span class="font-mono">${escapeHtml(info.path)}</span>`;
  $('hm-state').innerHTML = !info.configExists
    ? `<div class="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
         <span class="min-w-0 flex-1">Hermes terpasang tetapi belum dikonfigurasi (belum ada <code class="font-mono">config.yaml</code>). Jalankan setup dulu supaya chat bisa dipakai.</span>
         <button type="button" data-terminal="hermes setup --portal" class="btn-primary h-8 px-3">Setup cepat</button>
       </div>`
    : '';
  $('hm-main').classList.remove('hidden');
  renderChatHint();
  setTab(tab);
}

$('hm-refresh').addEventListener('click', async () => {
  const icon = document.querySelector('.hm-refresh-icon');
  icon?.classList.add('animate-spin');
  await loadInfo();
  icon?.classList.remove('animate-spin');
});

// Tombol dengan data-terminal: jalankan perintah interaktif di terminal bawah.
root.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const term = target.closest<HTMLElement>('[data-terminal]');
  if (term) {
    window.runInTerminal?.(term.dataset.terminal!);
    toast('Perintah dibuka di terminal di bawah', 'info');
    return;
  }
  if (target.closest('[data-reload]')) loadInfo();
});

// ---------- Tab ----------

function setTab(next: Tab) {
  tab = next;
  root.querySelectorAll<HTMLElement>('#hm-tabs [data-tab]').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === next));
  root.querySelectorAll<HTMLElement>('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== next));
  if (next !== 'logs') stopLogs();
  if (loadedTabs.has(next)) {
    if (next === 'logs') startLogs();
    return;
  }
  loadedTabs.add(next);
  if (next === 'chat') renderMessages();
  if (next === 'overview') loadOverview();
  if (next === 'gateway') runAction('gateway-status', 'gateway');
  if (next === 'logs') setupLogs();
  if (next === 'config') loadConfig();
  if (next === 'jobs') loadJobs();
}

$('hm-tabs').addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]')?.dataset.tab as Tab | undefined;
  if (t) setTab(t);
});

// ---------- Perintah tetap ----------

const CONFIRM: Record<string, { title: string; message: string; ok: string; danger?: boolean }> = {
  update: { title: 'Update Hermes sekarang?', message: 'Hermes diperbarui ke rilis stabil terbaru. Folder data di-backup dulu (--backup). Gateway mungkin perlu di-restart setelahnya.', ok: 'Update', danger: false },
  'doctor-fix': { title: 'Perbaiki otomatis?', message: 'hermes doctor --fix akan mencoba memperbaiki konfigurasi dan dependensi yang bermasalah.', ok: 'Perbaiki', danger: false },
  'gateway-stop': { title: 'Hentikan gateway?', message: 'Bot di Telegram/Discord/dll. berhenti membalas sampai gateway dijalankan lagi.', ok: 'Stop' },
  'gateway-install': { title: 'Pasang gateway sebagai service?', message: 'Membuat service systemd sehingga gateway berjalan otomatis setelah server reboot.', ok: 'Pasang', danger: false },
};

function renderOutput(el: HTMLElement, r: ActionResult) {
  const out = [r.stdout.trim(), r.stderr.trim()].filter(Boolean).join('\n');
  el.innerHTML = `${escapeHtml(out || '(tidak ada output)')}${r.timedOut ? '\n\n<span class="text-amber-600">Melewati batas waktu.</span>' : ''}`;
}

const exitBadge = (r: ActionResult, okLabel = 'OK', failLabel = 'Bermasalah') =>
  r.exitCode === 0
    ? `<span class="badge badge-green">${svg(ICON.check, 'size-3', 2.4)}${okLabel}</span>`
    : `<span class="badge badge-red">${svg(ICON.alert, 'size-3')}${failLabel} (exit ${r.exitCode})</span>`;

async function call(action: string): Promise<ActionResult> {
  return (await api<{ result: ActionResult }>('/api/hermes', { action })).result;
}

/** Jalankan aksi dan tampilkan hasilnya di panel yang sesuai. */
async function runAction(action: string, where: 'gateway' | 'overview') {
  const c = CONFIRM[action];
  if (c && !(await confirmAction({ title: c.title, message: c.message, okText: c.ok, danger: c.danger !== false }))) return;

  const pre = where === 'gateway' ? $('hm-gateway-output') : $('hm-doctor');
  const loading = `<span class="text-slate-400">Menjalankan…</span>`;
  pre.innerHTML = loading;
  if (where === 'gateway') {
    $('hm-gateway-title').textContent = `hermes ${action.replace('gateway-', 'gateway ')}`;
    $('hm-gateway-badge').innerHTML = spinner('size-4 text-brand-600');
  }
  try {
    const r = await call(action);
    renderOutput(pre, r);
    if (where === 'gateway') $('hm-gateway-badge').innerHTML = exitBadge(r, 'Berhasil', 'Gagal');
    else $('hm-doctor-badge').innerHTML = exitBadge(r, 'Sehat');
    if (action === 'update' && r.exitCode === 0) {
      toast('Hermes diperbarui', 'success');
      loadInfo();
    }
  } catch (err: any) {
    pre.innerHTML = `<span class="text-red-600">${escapeHtml(err.message)}</span>`;
    if (where === 'gateway') $('hm-gateway-badge').innerHTML = '';
  }
}

root.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action!;
  runAction(action, action.startsWith('gateway') ? 'gateway' : 'overview');
});

async function loadOverview() {
  $('hm-status').innerHTML = '<span class="text-slate-400">Memuat…</span>';
  $('hm-doctor').innerHTML = '<span class="text-slate-400">Memeriksa…</span>';
  $('hm-doctor-badge').innerHTML = spinner('size-4 text-brand-600');
  const [status, doctor] = await Promise.allSettled([call('status'), call('doctor')]);
  if (status.status === 'fulfilled') renderOutput($('hm-status'), status.value);
  else $('hm-status').textContent = status.reason?.message;
  if (doctor.status === 'fulfilled') {
    renderOutput($('hm-doctor'), doctor.value);
    $('hm-doctor-badge').innerHTML = exitBadge(doctor.value, 'Sehat');
  } else {
    $('hm-doctor').textContent = doctor.reason?.message;
    $('hm-doctor-badge').innerHTML = '';
  }
}

async function loadJobs() {
  for (const [action, id] of [['cron', 'hm-cron'], ['sessions', 'hm-sessions']] as const) {
    $(id).innerHTML = '<span class="text-slate-400">Memuat…</span>';
    call(action).then((r) => renderOutput($(id), r)).catch((err) => ($(id).textContent = err.message));
  }
}

// ---------- Konfigurasi ----------

let paths: { home: string; config: string; env: string; logs: string } | null = null;

async function loadConfig() {
  $('hm-env').innerHTML = `<div class="flex items-center justify-center gap-2 py-8 text-[13px] text-slate-500">${spinner('size-4 text-brand-600')}Memuat…</div>`;
  $('hm-config-show').innerHTML = '<span class="text-slate-400">Memuat…</span>';
  try {
    paths = (await api<{ paths: typeof paths }>('/api/hermes?view=paths')).paths;
    $('hm-config-paths').textContent = paths!.home;
  } catch (err: any) {
    $('hm-config-paths').textContent = err.message;
  }
  api<{ env: { key: string; set: boolean; preview: string }[] }>('/api/hermes?view=env')
    .then(({ env }) => {
      $('hm-env').innerHTML = env.length
        ? `<div class="divide-y divide-slate-100">${env.map((v) => `
            <div class="flex items-center gap-3 px-4 py-2">
              <span class="min-w-0 flex-1 truncate font-mono text-[12.5px] text-slate-800">${escapeHtml(v.key)}</span>
              ${v.set ? `<span class="font-mono text-[12px] text-slate-400">${escapeHtml(v.preview)}</span>` : '<span class="badge badge-slate">kosong</span>'}
            </div>`).join('')}</div>`
        : '<p class="px-4 py-8 text-center text-[13px] text-slate-400">Belum ada variabel di .env.</p>';
    })
    .catch((err) => ($('hm-env').innerHTML = `<p class="px-4 py-8 text-center text-[13px] text-red-600">${escapeHtml(err.message)}</p>`));
  call('config-show').then((r) => renderOutput($('hm-config-show'), r)).catch((err) => ($('hm-config-show').textContent = err.message));
}

$('hm-edit-config').addEventListener('click', () => {
  if (paths) window.openFileEditor?.(paths.config);
});
$('hm-edit-env').addEventListener('click', async () => {
  if (!paths) return;
  const ok = await confirmAction({ title: 'Buka .env?', message: 'File ini berisi API key dalam bentuk teks biasa dan akan tampil di layar.', okText: 'Buka', danger: false });
  if (ok) window.openFileEditor?.(paths.env);
});
$('hm-open-home').addEventListener('click', () => {
  if (paths) window.openInFiles?.(paths.home);
});

// ---------- Log ----------

let logAbort: AbortController | null = null;
let logLines: string[] = [];
let logQueued = false;

function setupLogs() {
  const select = $<HTMLSelectElement>('hm-log-file');
  const files = info?.logs.length ? info.logs : ['gateway.log', 'agent.log', 'errors.log'];
  select.innerHTML = files.map((f) => `<option ${f === 'gateway.log' ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('');
  startLogs();
}

function stopLogs() {
  logAbort?.abort();
  logAbort = null;
}

function renderLogs() {
  if (logQueued) return;
  logQueued = true;
  requestAnimationFrame(() => {
    logQueued = false;
    const pre = $('hm-log-output');
    const f = $<HTMLInputElement>('hm-log-filter').value.trim().toLowerCase();
    const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 60;
    const shown = f ? logLines.filter((l) => l.toLowerCase().includes(f)) : logLines;
    pre.textContent = shown.join('\n') || (f ? '(tidak ada baris yang cocok)' : '(log kosong)');
    if (atBottom) pre.scrollTop = pre.scrollHeight;
  });
}

async function startLogs() {
  stopLogs();
  logLines = [];
  const controller = new AbortController();
  logAbort = controller;
  const params = new URLSearchParams({
    view: 'logs',
    file: $<HTMLSelectElement>('hm-log-file').value,
    tail: $<HTMLSelectElement>('hm-log-tail').value,
    follow: $<HTMLInputElement>('hm-log-follow').checked ? '1' : '0',
  });
  $('hm-log-output').textContent = 'Memuat…';
  try {
    const res = await fetch(`/api/hermes?${params}`, { signal: controller.signal });
    if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || `Gagal memuat log (${res.status})`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let partial = '';
    let first = true;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const parts = (partial + decoder.decode(value, { stream: true })).split('\n');
      partial = parts.pop() ?? '';
      logLines.push(...parts);
      if (logLines.length > 20000) logLines.splice(0, logLines.length - 20000);
      if (first) {
        first = false;
        requestAnimationFrame(() => ($('hm-log-output').scrollTop = $('hm-log-output').scrollHeight));
      }
      renderLogs();
    }
    if (partial) logLines.push(partial);
    renderLogs();
  } catch (err: any) {
    if (err?.name !== 'AbortError') $('hm-log-output').textContent = `Error: ${err.message}`;
  }
}

['hm-log-file', 'hm-log-tail', 'hm-log-follow'].forEach((id) => $(id).addEventListener('change', startLogs));
$('hm-log-filter').addEventListener('input', renderLogs);

// ---------- Chat ----------

interface ToolEvent {
  label: string;
  detail: string;
}

interface Message {
  role: 'user' | 'assistant';
  text: string;
  tools: ToolEvent[];
  notes: string[];
  error?: string;
  at: number;
  done?: boolean;
}

interface Conversation {
  sessionId: string;
  messages: Message[];
}

const storeKey = () => `serverdeck.hermes.chat.${currentHost() || 'default'}`;

function loadConversation(): Conversation {
  try {
    const raw = JSON.parse(localStorage.getItem(storeKey()) || 'null');
    if (raw && Array.isArray(raw.messages)) return { sessionId: String(raw.sessionId || ''), messages: raw.messages };
  } catch {
    // data rusak: mulai baru
  }
  return { sessionId: '', messages: [] };
}

let convo: Conversation = { sessionId: '', messages: [] };
let chatAbort: AbortController | null = null;

function saveConversation() {
  try {
    convo.messages = convo.messages.slice(-100);
    localStorage.setItem(storeKey(), JSON.stringify(convo));
  } catch {
    // penyimpanan penuh: abaikan
  }
}

/** Markdown sederhana dan aman: teks di-escape dulu, baru diberi format. */
function renderMarkdown(text: string): string {
  const parts = text.split(/```/);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) {
        const body = part.replace(/^[\w+-]*\n/, '');
        return `<pre><code>${escapeHtml(body.replace(/\n$/, ''))}</code></pre>`;
      }
      return escapeHtml(part)
        .split(/\n{2,}/)
        .map((block) => {
          const inline = (s: string) => s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
          const lines = block.split('\n');
          if (lines.every((l) => /^\s*[-*]\s+/.test(l) || !l.trim())) {
            return `<ul>${lines.filter((l) => l.trim()).map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`;
          }
          return block.trim() ? `<p>${inline(block).replace(/\n/g, '<br>')}</p>` : '';
        })
        .join('');
    })
    .join('');
}

function messageHtml(m: Message, index: number): string {
  if (m.role === 'user') {
    return `<div class="flex justify-end"><div class="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-[13.5px] leading-relaxed text-white">${escapeHtml(m.text)}</div></div>`;
  }
  const streaming = !m.done && !m.error;
  const tools = m.tools.length
    ? `<div class="mb-2 space-y-1">${m.tools.map((t) => `
        <details class="rounded-lg border border-slate-200 bg-slate-50 text-[12px]">
          <summary class="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-slate-600">${svg(ICON.terminal, 'size-3.5 text-slate-400')}<span class="truncate font-mono">${escapeHtml(t.label)}</span></summary>
          ${t.detail ? `<pre class="max-h-56 overflow-auto whitespace-pre-wrap break-all border-t border-slate-200 px-2.5 py-2 font-mono text-[11.5px] text-slate-600">${escapeHtml(t.detail)}</pre>` : ''}
        </details>`).join('')}</div>`
    : '';
  const notes = m.notes.length ? `<p class="mt-2 whitespace-pre-wrap text-[11.5px] text-slate-400">${escapeHtml(m.notes.join('\n'))}</p>` : '';
  const body = m.text.trim()
    ? `<div class="hm-md text-[13.5px] leading-relaxed text-slate-800">${renderMarkdown(m.text)}</div>`
    : streaming
      ? `<div class="flex items-center gap-2 text-[13px] text-slate-500">${spinner('size-3.5 text-brand-600')}Hermes sedang bekerja…</div>`
      : '';
  const error = m.error ? `<div class="mt-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">${escapeHtml(m.error)}</div>` : '';
  return `
    <div class="flex gap-3" data-msg="${index}">
      <span class="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white">${svg(ICON.zap, 'size-3.5')}</span>
      <div class="min-w-0 max-w-[85%] rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3">${tools}${body}${error}${notes}</div>
    </div>`;
}

const SUGGESTIONS = [
  'Cek kondisi server ini: CPU, memori, disk, dan service yang gagal.',
  'Tampilkan container Docker yang sedang berjalan dan yang berhenti.',
  'Ringkas error di log Nginx 24 jam terakhir.',
];

function renderMessages() {
  const log = $('hm-chat-log');
  $('hm-chat-session').textContent = convo.sessionId ? `sesi ${convo.sessionId}` : '';
  if (!convo.messages.length) {
    log.innerHTML = `
      <div class="mx-auto flex max-w-lg flex-col items-center pt-8 text-center">
        <span class="mb-3 inline-flex size-12 items-center justify-center rounded-full bg-slate-900 text-white">${svg(ICON.zap, 'size-6')}</span>
        <p class="text-[15px] font-semibold text-slate-900">Perintahkan Hermes</p>
        <p class="mt-1 text-[13px] leading-relaxed text-slate-500">Hermes berjalan di server ini dan memakai tool-nya sendiri untuk mengerjakan permintaanmu.</p>
        <div class="mt-5 w-full space-y-2">${SUGGESTIONS.map((s) => `<button type="button" data-suggest="${escapeHtml(s)}" class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-[13px] text-slate-700 transition hover:border-brand-300 hover:bg-brand-50/50">${escapeHtml(s)}</button>`).join('')}</div>
      </div>`;
    return;
  }
  log.innerHTML = convo.messages.map(messageHtml).join('');
  log.scrollTop = log.scrollHeight;
}

/** Perbarui hanya gelembung terakhir saat streaming (lebih ringan dari render ulang semua). */
let bubbleQueued = false;
function renderLastBubble() {
  if (bubbleQueued) return;
  bubbleQueued = true;
  requestAnimationFrame(() => {
    bubbleQueued = false;
    const log = $('hm-chat-log');
    const index = convo.messages.length - 1;
    const el = log.querySelector(`[data-msg="${index}"]`);
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    if (el) el.outerHTML = messageHtml(convo.messages[index], index);
    else renderMessages();
    if (atBottom) log.scrollTop = log.scrollHeight;
  });
}

function renderChatHint() {
  $('hm-chat-hint').textContent = info?.streamJson
    ? 'Percakapan dilanjutkan otomatis. Persetujuan perintah berbahaya ditolak kecuali "Tanpa persetujuan" dinyalakan; untuk menyetujui satu per satu, pakai Mode terminal.'
    : 'Versi Hermes ini belum mendukung output terstruktur: setiap pesan memulai sesi baru. Update Hermes untuk percakapan berlanjut, atau pakai Mode terminal.';
}

const pickString = (...values: unknown[]) => values.find((v) => typeof v === 'string' && v.length > 0) as string | undefined;

/** Ambil teks dari event berbentuk apa pun (format stream-json bisa berbeda antar versi). */
function eventText(ev: any): string | undefined {
  if (Array.isArray(ev.content)) {
    const text = ev.content.filter((c: any) => c?.type === 'text' && typeof c.text === 'string').map((c: any) => c.text).join('');
    if (text) return text;
  }
  return pickString(ev.delta?.text, ev.delta, ev.text, ev.content, ev.message?.content, ev.message?.text, ev.data?.text, ev.data?.delta);
}

interface RunState {
  streamed: boolean;
  /** ID sesi yang dilaporkan Hermes pada run ini. */
  sessionId?: string;
  /** Kode penolakan dari baris "hermes-refusal-reason: KODE". */
  refusal?: string;
}

function handleEvent(m: Message, ev: any, state: RunState) {
  const type = String(ev.type ?? ev.event ?? ev.kind ?? '').toLowerCase();
  const sid = pickString(ev.session_id, ev.sessionId, ev.session?.id, typeof ev.session === 'string' ? ev.session : undefined);
  // Dicatat dulu; baru dipakai untuk lanjutan bila run ini berhasil.
  if (sid) state.sessionId = sid;

  if (type.includes('tool')) {
    const name = pickString(ev.name, ev.tool, ev.tool_name, ev.toolName, ev.function?.name, ev.data?.name) || 'tool';
    const phase = type.replace(/^.*tool[._-]?/, '') || '';
    const payload = ev.input ?? ev.args ?? ev.arguments ?? ev.command ?? ev.output ?? ev.result ?? ev.data;
    m.tools.push({
      label: `${name}${phase ? ` · ${phase}` : ''}`,
      detail: payload === undefined ? '' : typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
    });
    return;
  }
  if (type.includes('error')) {
    m.error = pickString(ev.message, ev.error?.message, ev.error, eventText(ev)) || JSON.stringify(ev);
    return;
  }
  if (type === 'result' || type.endsWith('.result') || type === 'final' || type === 'done') {
    // Teks hasil akhir hanya dipakai bila belum ada teks yang di-stream (hindari dobel).
    const final = pickString(ev.result, ev.text, ev.output, eventText(ev));
    if (final && !state.streamed) m.text = final;
    if (ev.is_error || ev.error) m.error = pickString(ev.error?.message, ev.error, ev.message) || 'Hermes melaporkan error';
    return;
  }
  const text = eventText(ev);
  if (text) {
    m.text += text;
    state.streamed = true;
  }
  // Event lain (usage, status, dll.) diabaikan dengan sengaja.
}

const REFUSALS: Record<string, string> = {
  SESSION_NOT_OWNED: 'Sesi ini sedang dibuka di jendela atau terminal Hermes lain.',
};

/** Sesi yang dilanjutkan tidak bisa dipakai (tidak ada, atau dikunci terminal lain). */
const SESSION_PROBLEM = /SESSION_NOT_OWNED|Session not found|session[^\n]*(not found|does not exist)/i;

/** Satu kali panggilan `hermes chat`; output dimasukkan ke gelembung `reply`. */
async function attempt(reply: Message, prompt: string, resume: string | undefined, signal: AbortSignal, structured: boolean): Promise<RunState> {
  const state: RunState = { streamed: false };
  const res = await fetch('/api/hermes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'chat',
      prompt,
      resume,
      yolo: $<HTMLInputElement>('hm-chat-yolo').checked,
      streamJson: structured,
      maxTurns: Number($<HTMLSelectElement>('hm-chat-turns').value),
    }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || `Permintaan gagal (${res.status})`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let partial = '';
  const handleLine = (line: string) => {
    if (!line.trim()) {
      if (!structured) reply.text += '\n';
      return;
    }
    const refusal = line.match(/hermes-refusal-reason:\s*([A-Z_]+)/);
    if (refusal) state.refusal = refusal[1];
    if (structured) {
      try {
        const ev = JSON.parse(line);
        if (ev && typeof ev === 'object') return handleEvent(reply, ev, state);
      } catch {
        // bukan JSON: catatan dari CLI (peringatan, alasan penolakan, dll.)
      }
      reply.notes.push(line);
    } else {
      reply.text += `${line}\n`;
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const lines = (partial + decoder.decode(value, { stream: true })).split('\n');
    partial = lines.pop() ?? '';
    lines.forEach(handleLine);
    renderLastBubble();
  }
  if (partial) handleLine(partial);
  return state;
}

async function sendMessage(prompt: string) {
  if (chatAbort || !prompt.trim()) return;
  const user: Message = { role: 'user', text: prompt.trim(), tools: [], notes: [], at: Date.now(), done: true };
  const reply: Message = { role: 'assistant', text: '', tools: [], notes: [], at: Date.now() };
  convo.messages.push(user, reply);
  renderMessages();
  saveConversation();
  setSending(true);

  const controller = new AbortController();
  chatAbort = controller;
  const structured = Boolean(info?.streamJson);
  try {
    const resume = structured ? convo.sessionId || undefined : undefined;
    let state = await attempt(reply, user.text, resume, controller.signal, structured);

    // Sesi lama tidak bisa dilanjutkan: ulangi sekali di sesi baru, tanpa membuat pengguna mengetik ulang.
    const failedOutput = `${reply.notes.join('\n')}\n${reply.error || ''}`;
    if (resume && !reply.text.trim() && (state.refusal === 'SESSION_NOT_OWNED' || SESSION_PROBLEM.test(failedOutput))) {
      const why = state.refusal === 'SESSION_NOT_OWNED' ? 'sedang dibuka di terminal/jendela Hermes lain' : 'tidak ditemukan di Hermes';
      convo.sessionId = '';
      Object.assign(reply, { text: '', tools: [], error: undefined, notes: [`Sesi ${resume} ${why}; dilanjutkan di sesi baru.`] });
      renderLastBubble();
      state = await attempt(reply, user.text, undefined, controller.signal, structured);
    }

    if (!reply.text.trim() && !reply.error && !reply.tools.length) {
      reply.error = state.refusal
        ? REFUSALS[state.refusal] || `Hermes menolak permintaan ini (${state.refusal}).`
        : 'Hermes tidak memberikan jawaban. Cek tab Ringkasan (hermes doctor) atau Log.';
    }
    if (/not connected to any AI provider|No provider configured/i.test(`${reply.notes.join('\n')}\n${reply.error || ''}`)) {
      reply.notes.push('Hubungkan Hermes ke provider AI dulu: tab Ringkasan → "Setup cepat (Nous Portal)" atau "Pilih model / provider".');
    }
    // Sesi hanya diingat bila run berhasil: sesi dari run yang gagal tidak tersimpan di Hermes.
    if (!reply.error && state.sessionId) convo.sessionId = state.sessionId;
  } catch (err: any) {
    reply.error = err?.name === 'AbortError' ? 'Dihentikan.' : err.message;
  } finally {
    reply.done = true;
    chatAbort = null;
    setSending(false);
    saveConversation();
    renderMessages();
  }
}

function setSending(sending: boolean) {
  const btn = $<HTMLButtonElement>('hm-chat-send');
  btn.className = sending ? 'btn-danger h-11 px-4' : 'btn-primary h-11 px-4';
  btn.innerHTML = sending ? `${svg(ICON.stop, 'size-3.5', 2.2)}Hentikan` : `${svg(ICON.play, 'size-3.5', 2.2)}Kirim`;
  $<HTMLTextAreaElement>('hm-chat-input').disabled = sending;
}

$('hm-chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (chatAbort) {
    chatAbort.abort();
    return;
  }
  const input = $<HTMLTextAreaElement>('hm-chat-input');
  const prompt = input.value;
  input.value = '';
  sendMessage(prompt);
});

$('hm-chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $<HTMLFormElement>('hm-chat-form').requestSubmit();
  }
});

$('hm-chat-log').addEventListener('click', (e) => {
  const s = (e.target as HTMLElement).closest<HTMLElement>('[data-suggest]')?.dataset.suggest;
  if (s) sendMessage(s);
});

$('hm-chat-new').addEventListener('click', async () => {
  if (chatAbort) return;
  if (convo.messages.length) {
    const ok = await confirmAction({ title: 'Mulai percakapan baru?', message: 'Riwayat di layar ini dihapus. Sesi lama tetap tersimpan di Hermes (hermes sessions).', okText: 'Mulai baru', danger: false });
    if (!ok) return;
  }
  convo = { sessionId: '', messages: [] };
  saveConversation();
  renderMessages();
  $<HTMLTextAreaElement>('hm-chat-input').focus();
});

$('hm-chat-yolo').addEventListener('change', (e) => {
  $('hm-chat-yolo-warning').classList.toggle('hidden', !(e.target as HTMLInputElement).checked);
});

$('hm-chat-repl').addEventListener('click', () => {
  // Sesi baru, bukan --resume sesi chat: Hermes mengunci sesi ke satu jendela, sehingga
  // melanjutkan sesi chat di terminal akan membuat chat di sini ditolak (SESSION_NOT_OWNED).
  window.runInTerminal?.('hermes');
});

// ---------- Mulai ----------

onView('hermes', () => {
  const host = currentHost();
  if (host === loadedFor && info) {
    if (tab === 'logs') startLogs();
    return;
  }
  loadedFor = host;
  convo = loadConversation();
  loadInfo();
});

window.addEventListener('app:view', (e) => {
  if ((e as CustomEvent<{ view: string }>).detail.view !== 'hermes') stopLogs();
});
