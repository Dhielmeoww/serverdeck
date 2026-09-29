/**
 * Tab Stats: polling `docker stats --no-stream` dan grafik riwayat CPU/memori.
 * Satu seri per grafik (judul menamai seri), jadi tanpa legenda.
 */
import { api, escapeHtml } from '../client';

interface Sample {
  at: number;
  cpu: number;
  mem: number;
  raw: Record<string, string>;
}

const HISTORY = 60;
const INTERVAL_MS = 2000;

const percent = (v?: string) => {
  const n = parseFloat(String(v || '').replace('%', ''));
  return Number.isFinite(n) ? n : 0;
};

function chart(id: string, title: string, samples: Sample[], key: 'cpu' | 'mem', max: number, color: string) {
  const values = samples.map((s) => s[key]);
  const last = values[values.length - 1] ?? 0;
  const W = 300;
  const H = 80;
  const x = (i: number) => (values.length <= 1 ? W : (i / (HISTORY - 1)) * W + (HISTORY - values.length) * (W / (HISTORY - 1)));
  const y = (v: number) => H - (Math.min(v, max) / max) * (H - 4) - 2;
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = values.length ? `${line} L${x(values.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z` : '';

  return `
    <div class="card p-4">
      <div class="flex items-baseline justify-between">
        <p class="text-[12.5px] font-medium text-slate-500">${title}</p>
        <p class="text-[20px] font-bold tracking-tight text-slate-900">${last.toFixed(1)}%</p>
      </div>
      <div class="relative mt-3" data-chart="${id}">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="h-24 w-full overflow-visible">
          <line x1="0" y1="${y(max / 2)}" x2="${W}" y2="${y(max / 2)}" stroke="#f1f5f9" stroke-width="1" vector-effect="non-scaling-stroke" />
          <path d="${area}" fill="${color}" fill-opacity="0.12" />
          <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
          <line data-cursor x1="0" y1="0" x2="0" y2="${H}" stroke="#94a3b8" stroke-width="1" vector-effect="non-scaling-stroke" visibility="hidden" />
        </svg>
        <div data-tip class="pointer-events-none absolute -top-8 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white"></div>
        <div class="mt-1 flex justify-between text-[10.5px] text-slate-400"><span>${Math.round((HISTORY * INTERVAL_MS) / 60000)} menit lalu</span><span>sekarang</span></div>
      </div>
    </div>`;
}

function tile(label: string, value: string, sub = '') {
  return `
    <div class="card px-4 py-3.5">
      <p class="text-[12px] font-medium text-slate-500">${label}</p>
      <p class="mt-1 truncate text-[18px] font-bold tracking-tight text-slate-900">${escapeHtml(value)}</p>
      ${sub ? `<p class="mt-0.5 truncate text-[12px] text-slate-400">${escapeHtml(sub)}</p>` : ''}
    </div>`;
}

/** Hover: garis kursor + tooltip nilai pada titik terdekat. */
function bindHover(root: HTMLElement, samples: Sample[]) {
  root.querySelectorAll<HTMLElement>('[data-chart]').forEach((box) => {
    const key = box.dataset.chart as 'cpu' | 'mem';
    const svgEl = box.querySelector('svg')!;
    const cursor = box.querySelector<SVGLineElement>('[data-cursor]')!;
    const tip = box.querySelector<HTMLElement>('[data-tip]')!;
    box.addEventListener('mousemove', (e) => {
      if (!samples.length) return;
      const rect = svgEl.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const offset = HISTORY - samples.length;
      const index = Math.min(samples.length - 1, Math.max(0, Math.round(ratio * (HISTORY - 1)) - offset));
      const s = samples[index];
      const px = ((index + offset) / (HISTORY - 1)) * 300;
      cursor.setAttribute('x1', String(px));
      cursor.setAttribute('x2', String(px));
      cursor.setAttribute('visibility', 'visible');
      tip.textContent = `${s[key].toFixed(1)}% · ${new Date(s.at).toLocaleTimeString('id-ID')}`;
      tip.style.left = `${((index + offset) / (HISTORY - 1)) * 100}%`;
      tip.classList.remove('hidden');
    });
    box.addEventListener('mouseleave', () => {
      cursor.setAttribute('visibility', 'hidden');
      tip.classList.add('hidden');
    });
  });
}

export function startStats(containerId: string, root: HTMLElement, running: boolean): () => void {
  if (!running) {
    root.innerHTML = '<div class="card px-4 py-12 text-center text-[13px] text-slate-500">Container tidak berjalan. Stats tersedia saat container running.</div>';
    return () => {};
  }

  const samples: Sample[] = [];
  let stopped = false;
  let timer: number | undefined;
  root.innerHTML = '<div class="card px-4 py-12 text-center text-[13px] text-slate-400">Mengambil stats pertama…</div>';

  const render = () => {
    const s = samples[samples.length - 1];
    if (!s) return;
    const r = s.raw;
    const [memUsed, memLimit] = String(r.MemUsage || '').split('/').map((x) => x.trim());
    const [netRx, netTx] = String(r.NetIO || '').split('/').map((x) => x.trim());
    const [blkRead, blkWrite] = String(r.BlockIO || '').split('/').map((x) => x.trim());
    root.innerHTML = `
      <div class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        ${tile('Memori', memUsed || '—', memLimit ? `dari ${memLimit}` : '')}
        ${tile('Network I/O', `↓ ${netRx || '0B'}`, `↑ ${netTx || '0B'}`)}
        ${tile('Block I/O', `R ${blkRead || '0B'}`, `W ${blkWrite || '0B'}`)}
        ${tile('Proses (PIDs)', r.PIDs || '0')}
      </div>
      <div class="grid gap-4 lg:grid-cols-2">
        ${chart('cpu', 'CPU', samples, 'cpu', Math.max(100, ...samples.map((x) => x.cpu)), '#1B7A5C')}
        ${chart('mem', 'Memori', samples, 'mem', 100, '#268E6B')}
      </div>
      <p class="mt-3 text-[11.5px] text-slate-400">Diperbarui tiap ${INTERVAL_MS / 1000} detik selama tab ini terbuka. CPU bisa melebihi 100% pada container multi-core.</p>`;
    bindHover(root, samples);
  };

  const tick = async () => {
    if (stopped) return;
    try {
      const data = await api<{ stats: Record<string, string> | null }>(`/api/docker/container?view=stats&id=${encodeURIComponent(containerId)}`);
      if (stopped) return;
      if (data.stats) {
        samples.push({ at: Date.now(), cpu: percent(data.stats.CPUPerc), mem: percent(data.stats.MemPerc), raw: data.stats });
        if (samples.length > HISTORY) samples.shift();
        render();
      }
    } catch (err: any) {
      if (!stopped) root.innerHTML = `<div class="card px-4 py-12 text-center text-[13px] text-red-600">${escapeHtml(err.message)}</div>`;
      return;
    }
    // Jadwal berikutnya setelah respons selesai, supaya permintaan tidak menumpuk.
    if (!stopped) timer = window.setTimeout(tick, INTERVAL_MS);
  };

  tick();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
  };
}
