import { currentHost, escapeHtml, svg, ICON } from '../client';

export interface ContainerRow {
  id: string;
  name: string;
  image: string;
  command: string;
  state: string;
  status: string;
  ports: string;
  createdAt: string;
  runningFor: string;
  networks: string;
  mounts: string;
  composeProject: string;
  composeService: string;
}

export interface ImageRow {
  id: string;
  repository: string;
  tag: string;
  size: string;
  createdAt: string;
  createdSince: string;
  containers: number;
}

export interface VolumeRow {
  name: string;
  driver: string;
  mountpoint: string;
  scope: string;
  usedBy: string[];
  composeProject: string;
}

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export const shortId = (id: string) => id.replace(/^sha256:/, '').slice(0, 12);

/** Exit code dari teks status ("Exited (137) 2 hours ago"). */
export function exitCode(status: string): number | null {
  const m = status.match(/Exited \((-?\d+)\)/);
  return m ? Number(m[1]) : null;
}

export function stateBadge(state: string, status = ''): string {
  const code = exitCode(status);
  const tones: Record<string, [string, string]> = {
    running: ['badge-green', 'Running'],
    paused: ['badge-amber', 'Paused'],
    restarting: ['badge-amber', 'Restarting'],
    created: ['badge-slate', 'Created'],
    removing: ['badge-slate', 'Removing'],
    dead: ['badge-red', 'Dead'],
    exited: code && code !== 0 ? ['badge-red', `Exited (${code})`] : ['badge-slate', 'Exited'],
  };
  const [cls, label] = tones[state] || ['badge-slate', state || 'Unknown'];
  const pulse = state === 'running' ? '<span class="size-1.5 rounded-full bg-emerald-500"></span>' : '<span class="size-1.5 rounded-full bg-current opacity-60"></span>';
  return `<span class="badge ${cls}">${pulse}${escapeHtml(label)}</span>`;
}

export interface PublishedPort {
  hostPort: string;
  containerPort: string;
  protocol: string;
}

/** "0.0.0.0:8080->80/tcp, [::]:8080->80/tcp, 443/tcp" → port unik yang dipublikasikan. */
export function parsePorts(ports: string): { published: PublishedPort[]; exposed: string[] } {
  const published: PublishedPort[] = [];
  const exposed: string[] = [];
  const seen = new Set<string>();
  for (const part of ports.split(',').map((s) => s.trim()).filter(Boolean)) {
    const arrow = part.indexOf('->');
    if (arrow === -1) {
      exposed.push(part);
      continue;
    }
    const hostPort = part.slice(0, arrow).split(':').pop() || '';
    const [containerPort, protocol = 'tcp'] = part.slice(arrow + 2).split('/');
    const key = `${hostPort}->${containerPort}/${protocol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    published.push({ hostPort, containerPort, protocol });
  }
  return { published, exposed };
}

/** Host SSH yang sedang terhubung, untuk membuat tautan ke port yang dipublikasikan. */
export function serverHost(): string {
  const label = currentHost();
  return label.includes('@') ? label.split('@').pop()! : label;
}

export function portLinks(ports: string, max = 3): string {
  const { published, exposed } = parsePorts(ports);
  if (!published.length && !exposed.length) return '<span class="text-slate-300">—</span>';
  const host = serverHost();
  const links = published.slice(0, max).map((p) => {
    const scheme = p.containerPort === '443' ? 'https' : 'http';
    const label = `${p.hostPort}:${p.containerPort}${p.protocol !== 'tcp' ? `/${p.protocol}` : ''}`;
    return p.protocol === 'tcp' && host
      ? `<a href="${scheme}://${escapeHtml(host)}:${escapeHtml(p.hostPort)}" target="_blank" rel="noopener noreferrer" data-stop
           class="inline-flex items-center gap-1 rounded-md bg-brand-50 px-1.5 py-0.5 font-mono text-[11.5px] text-brand-700 hover:bg-brand-100">${escapeHtml(label)}${svg(ICON.external, 'size-3')}</a>`
      : `<span class="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11.5px] text-slate-600">${escapeHtml(label)}</span>`;
  });
  const more = published.length > max ? `<span class="text-[11.5px] text-slate-400">+${published.length - max}</span>` : '';
  const exposedOnly = !published.length ? `<span class="font-mono text-[11.5px] text-slate-400" title="Hanya expose, tidak dipublikasikan ke host">${escapeHtml(exposed.slice(0, 2).join(', '))}</span>` : '';
  return `<div class="flex flex-wrap items-center gap-1">${links.join('')}${more}${exposedOnly}</div>`;
}

/** Hapus kode warna ANSI dari output log. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07]*\x07|\r(?!\n)/g, '');
}

export function download(filename: string, content: string, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function openDialog(el: HTMLElement) {
  el.classList.remove('hidden');
  el.classList.add('flex');
}

export function closeDialog(el: HTMLElement) {
  el.classList.add('hidden');
  el.classList.remove('flex');
}
