import type { APIRoute } from 'astro';
import { SSHManager, powershellCommand, toWindowsPath } from '../../lib/ssh-session';
import { getSessionId } from '../../lib/auth-cookie';

export const prerender = false;

/**
 * Informasi penyimpanan server remote.
 *
 *   ?action=disks                 filesystem yang terpasang (df)
 *   ?action=usage&path=/var       ukuran tiap sub-folder satu tingkat (du -d 1)
 *   ?action=largest&path=/var     file terbesar di bawah path (find)
 *
 * du dan find dibatasi `timeout` supaya folder raksasa tidak menggantung
 * permintaan; hasil parsial tetap dikembalikan dengan tanda `partial`.
 */

// Filesystem semu yang tidak mewakili disk sungguhan.
const PSEUDO_FS = new Set([
  'tmpfs', 'devtmpfs', 'squashfs', 'overlay', 'efivarfs', 'proc', 'sysfs', 'devfs',
  'udev', 'cgroup', 'cgroup2', 'debugfs', 'tracefs', 'securityfs', 'pstore', 'autofs',
  'mqueue', 'hugetlbfs', 'fusectl', 'configfs', 'binfmt_misc', 'nsfs', 'ramfs', 'none',
]);

const SCAN_TIMEOUT_SEC = 60;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function withTimeout(command: string) {
  return `T=""; command -v timeout >/dev/null 2>&1 && T="timeout ${SCAN_TIMEOUT_SEC}"; ${command}`;
}

function parseDf(stdout: string) {
  const lines = stdout.trim().split('\n');
  const hasType = /\bType\b/i.test(lines[0] || '');
  const disks = [];

  for (const line of lines.slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < (hasType ? 7 : 6)) continue;

    const [filesystem, type] = hasType ? [cols[0], cols[1]] : [cols[0], ''];
    const offset = hasType ? 2 : 1;
    const size = Number(cols[offset]) * 1024;
    const used = Number(cols[offset + 1]) * 1024;
    const available = Number(cols[offset + 2]) * 1024;
    const mount = cols.slice(offset + 4).join(' ');

    if (!size || PSEUDO_FS.has(type) || PSEUDO_FS.has(filesystem)) continue;
    disks.push({ filesystem, type, size, used, available, mount });
  }

  // Satu device bisa terpasang di beberapa titik (bind mount): tampilkan sekali.
  const seen = new Set<string>();
  return disks.filter((d) => {
    const key = `${d.filesystem}|${d.size}|${d.used}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------- Windows (PowerShell) ----------
// Path masuk/keluar memakai format SFTP (/C:/Users) supaya cocok dengan File Manager.

const psString = (value: string) => `'${value.replace(/'/g, "''")}'`;

const toArray = (value: unknown) => (Array.isArray(value) ? value : value ? [value] : []);

function parseJson(stdout: string) {
  const text = stdout.trim();
  if (!text) return [];
  return toArray(JSON.parse(text));
}

async function windowsDisks(sessionId: string) {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Get-CimInstance Win32_LogicalDisk | Where-Object { $_.Size -gt 0 } | ForEach-Object {
  [pscustomobject]@{
    filesystem = [string]$_.DeviceID
    type = [string]$_.FileSystem
    size = [int64]$_.Size
    available = [int64]$_.FreeSpace
    used = [int64]($_.Size - $_.FreeSpace)
    mount = '/' + $_.DeviceID
  }
} | ConvertTo-Json -Compress`;
  const res = await SSHManager.execCommand(sessionId, powershellCommand(script), 30_000);
  return parseJson(res.stdout);
}

async function windowsUsage(sessionId: string, path: string) {
  // Akar "/" di SFTP Windows adalah daftar drive.
  if (path === '/') {
    const disks = await windowsDisks(sessionId);
    const items = disks.map((d: any) => ({ name: d.filesystem, path: d.mount, size: Number(d.used) || 0 }));
    items.sort((a, b) => b.size - a.size);
    return { path, total: items.reduce((s, i) => s + i.size, 0), ownFiles: 0, items, partial: false, restricted: false };
  }

  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$p = ${psString(toWindowsPath(path))}
$items = foreach ($i in Get-ChildItem -LiteralPath $p -Force) {
  if ($i.PSIsContainer) {
    if ($i.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
    $s = (Get-ChildItem -LiteralPath $i.FullName -Recurse -Force -File | Measure-Object -Property Length -Sum).Sum
    [pscustomobject]@{ name = $i.Name; dir = $true; size = [int64]$s }
  } else {
    [pscustomobject]@{ name = $i.Name; dir = $false; size = [int64]$i.Length }
  }
}
@($items) | ConvertTo-Json -Compress`;

  const res = await SSHManager.execCommand(sessionId, powershellCommand(script), SCAN_TIMEOUT_SEC * 1000);
  const entries = res.timedOut ? [] : parseJson(res.stdout);
  const base = path === '/' ? '' : path;
  const items = entries
    .filter((e: any) => e.dir)
    .map((e: any) => ({ name: String(e.name), path: `${base}/${e.name}`, size: Number(e.size) || 0 }))
    .sort((a, b) => b.size - a.size);
  const ownFiles = entries.filter((e: any) => !e.dir).reduce((s: number, e: any) => s + (Number(e.size) || 0), 0);
  const total = ownFiles + items.reduce((s, i) => s + i.size, 0);
  return { path, total, ownFiles, items, partial: Boolean(res.timedOut), restricted: false };
}

async function windowsLargest(sessionId: string, path: string) {
  const root = path === '/' ? 'C:\\' : toWindowsPath(path);
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Get-ChildItem -LiteralPath ${psString(root)} -Recurse -Force -File |
  Where-Object { $_.Length -gt 10MB } |
  Sort-Object Length -Descending |
  Select-Object -First 25 |
  ForEach-Object { [pscustomobject]@{ size = [int64]$_.Length; path = '/' + ($_.FullName -replace '\\\\', '/') } } |
  ConvertTo-Json -Compress`;
  const res = await SSHManager.execCommand(sessionId, powershellCommand(script), SCAN_TIMEOUT_SEC * 1000);
  const files = res.timedOut ? [] : parseJson(res.stdout).map((f: any) => ({ size: Number(f.size) || 0, path: String(f.path) }));
  return { path, files, partial: Boolean(res.timedOut) };
}

export const GET: APIRoute = async (context) => {
  const sessionId = getSessionId(context);
  const session = sessionId ? SSHManager.getSession(sessionId) : null;
  if (!sessionId || !session) {
    return json({ error: 'Unauthorized: No active SSH session' }, 401);
  }

  const url = new URL(context.request.url);
  const action = url.searchParams.get('action') || 'disks';
  const path = (url.searchParams.get('path') || '/').replace(/\/+$/, '') || '/';

  if (!path.startsWith('/')) {
    return json({ error: 'Path harus absolut' }, 400);
  }

  if (session.platform === 'windows') {
    try {
      if (action === 'disks') return json({ success: true, disks: await windowsDisks(sessionId) });
      if (action === 'usage') return json({ success: true, ...(await windowsUsage(sessionId, path)) });
      if (action === 'largest') return json({ success: true, ...(await windowsLargest(sessionId, path)) });
      return json({ error: `Action tidak dikenal: ${action}` }, 400);
    } catch (error: any) {
      return json({ error: error.message || 'Gagal membaca informasi storage' }, 500);
    }
  }

  try {
    if (action === 'disks') {
      const res = await SSHManager.execCommand(sessionId, 'df -PkT 2>/dev/null || df -Pk', 30_000);
      return json({ success: true, disks: parseDf(res.stdout) });
    }

    if (action === 'usage') {
      const res = await SSHManager.execCommand(
        sessionId,
        withTimeout(`$T du -xk -d 1 -- ${shellQuote(path)} 2>/dev/null; echo "__EXIT:$?"`),
        (SCAN_TIMEOUT_SEC + 15) * 1000,
      );

      const exit = Number(res.stdout.match(/__EXIT:(\d+)/)?.[1] ?? 0);
      let total = 0;
      const items: { name: string; path: string; size: number }[] = [];

      for (const line of res.stdout.split('\n')) {
        const m = line.match(/^(\d+)\s+(.+)$/);
        if (!m) continue;
        const size = Number(m[1]) * 1024;
        const itemPath = m[2].replace(/\/+$/, '') || '/';
        if (itemPath === path) {
          total = size;
        } else {
          items.push({ name: itemPath.split('/').pop() || itemPath, path: itemPath, size });
        }
      }

      items.sort((a, b) => b.size - a.size);
      const childSum = items.reduce((sum, item) => sum + item.size, 0);
      // du hanya melaporkan folder; sisanya adalah file langsung di path ini.
      if (!total) total = childSum;
      const ownFiles = Math.max(0, total - childSum);

      return json({
        success: true,
        path,
        total,
        ownFiles,
        items,
        partial: exit === 124,
        restricted: exit === 1,
      });
    }

    if (action === 'largest') {
      const res = await SSHManager.execCommand(
        sessionId,
        withTimeout(`$T find ${shellQuote(path)} -xdev -type f -size +10M -printf '%s\\t%p\\n' 2>/dev/null | sort -rn | head -n 25`),
        (SCAN_TIMEOUT_SEC + 15) * 1000,
      );

      const files = res.stdout
        .split('\n')
        .map((line) => line.match(/^(\d+)\t(.+)$/))
        .filter((m): m is RegExpMatchArray => Boolean(m))
        .map((m) => ({ size: Number(m[1]), path: m[2] }));

      return json({ success: true, path, files });
    }

    return json({ error: `Action tidak dikenal: ${action}` }, 400);
  } catch (error: any) {
    return json({ error: error.message || 'Gagal membaca informasi storage' }, 500);
  }
};
