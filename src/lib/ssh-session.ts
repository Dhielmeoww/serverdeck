import { Client, type ClientChannel, type ConnectConfig, type SFTPWrapper } from 'ssh2';
import { nanoid } from 'nanoid';

/** Unix: sh/bash/zsh. Windows: OpenSSH dengan DefaultShell cmd.exe atau PowerShell. */
export type Platform = 'unix' | 'windows';
export type Shell = 'sh' | 'cmd' | 'powershell';

export interface SSHSessionInfo {
  id: string;
  host: string;
  port: number;
  username: string;
  connectedAt: number;
  lastActive: number;
  client: Client;
  sftp: SFTPWrapper | null;
  platform: Platform;
  shell: Shell;
  /** Folder awal dalam format path SFTP (Windows: /C:/Users/nama). */
  homeDir: string;
  /** Cara memanggil Docker di server ini ('docker' atau 'sudo -n docker'), diisi saat pertama dipakai. */
  dockerPrefix?: string;
  /** PATH dari login shell user; dipakai perintah non-interaktif (terminal lama, pipeline). */
  loginPath?: string;
}

export interface ExecOptions {
  timeoutMs?: number;
  /** Folder kerja dalam format path SFTP; diterjemahkan sesuai shell server. */
  cwd?: string;
  /**
   * Perlakuan `sudo` (hanya Unix):
   * - 'nonInteractive': sudo -n, langsung gagal bila butuh password (tidak menggantung)
   * - 'password': password dikirim lewat stdin ke helper SUDO_ASKPASS, tidak pernah masuk argv
   */
  sudo?: 'none' | 'nonInteractive' | 'password';
  sudoPassword?: string;
  /**
   * Laporkan folder terakhir setelah perintah selesai (untuk terminal: `cd`
   * di satu perintah berlaku untuk perintah berikutnya). Tidak didukung di cmd.exe.
   */
  trackCwd?: boolean;
}

const CWD_MARKER = '__SERVERDECK_CWD__';

/** Bungkus perintah agar mencetak folder akhirnya, tanpa mengubah exit code. */
function withCwdReport(shell: Shell, command: string): string {
  if (shell === 'powershell') {
    return [
      command,
      '$__sdec = if ($?) { 0 } elseif ($LASTEXITCODE) { $LASTEXITCODE } else { 1 }',
      `Write-Output ("\`n${CWD_MARKER}" + (Get-Location).ProviderPath)`,
      'exit $__sdec',
    ].join('\n');
  }
  // Baris baru sebelum "}" supaya perintah yang diakhiri komentar tetap valid.
  return `{ ${command}\n}\n__sd_ec=$?\nprintf '\\n${CWD_MARKER}%s\\n' "$(pwd)"\nexit $__sd_ec`;
}

/** Pisahkan penanda folder dari stdout. */
function extractCwd(stdout: string, shell: Shell): { stdout: string; cwd?: string } {
  const at = stdout.lastIndexOf(CWD_MARKER);
  if (at === -1) return { stdout };
  let raw = stdout.slice(at + CWD_MARKER.length).split(/\r?\n/)[0].trim();
  // Buang satu baris baru yang ditambahkan pembungkus sebelum penanda.
  const before = stdout.slice(0, at).replace(/\r?\n$/, '');
  if (!raw) return { stdout: before };
  // PowerShell: C:\Users\x → format path SFTP /C:/Users/x
  if (shell === 'powershell') raw = '/' + raw.replace(/\\/g, '/').replace(/\/$/, '');
  return { stdout: before, cwd: raw };
}

/** "/C:/Users/x" → "C:\Users\x" */
export function toWindowsPath(path: string): string {
  let p = path.replace(/^\/([A-Za-z]:)/, '$1').replace(/\//g, '\\');
  if (/^[A-Za-z]:$/.test(p)) p += '\\';
  return p;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Skrip PowerShell sebagai -EncodedCommand: bebas masalah kutip di cmd maupun PowerShell. */
export function powershellCommand(script: string): string {
  const encoded = Buffer.from(`$ProgressPreference='SilentlyContinue'\n${script}`, 'utf16le').toString('base64');
  return `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`;
}

// Helper askpass: berisi rujukan variabel lingkungan, bukan password itu sendiri.
const SUDO_ASKPASS_PREFIX = [
  'IFS= read -r SD_SUDO_PW || true',
  'export SD_SUDO_PW',
  'SD_ASKPASS="$HOME/.serverdeck-askpass-$$"',
  `( umask 077; printf '%s\\n' '#!/bin/sh' 'printf "%s\\n" "$SD_SUDO_PW"' > "$SD_ASKPASS" ) && chmod 700 "$SD_ASKPASS"`,
  'export SUDO_ASKPASS="$SD_ASKPASS"',
  `trap 'rm -f "$SD_ASKPASS"' EXIT`,
  'sudo() { command sudo -A "$@"; }',
].join('\n');

const SUDO_NONINTERACTIVE_PREFIX = 'sudo() { command sudo -n "$@"; }';

export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  size: number;
  modifyTime: number;
  accessTime: number;
  permissions: string;
  mode: number;
  octal: string;
  owner?: number;
  group?: number;
}

export interface SystemInfo {
  hostname?: string;
  uname?: string;
  uptime?: string;
  diskUsage?: string;
  memory?: string;
  homeDir?: string;
  platform?: Platform;
  shell?: Shell;
}

// In-memory sessions store
const sessions = new Map<string, SSHSessionInfo>();

// Clean inactive sessions every 10 minutes (sessions older than 1 hour)
const INACTIVE_TIMEOUT_MS = 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastActive > INACTIVE_TIMEOUT_MS) {
      try {
        session.client.end();
      } catch (e) {
        // ignore
      }
      sessions.delete(id);
    }
  }
}, 10 * 60 * 1000);

export function formatPermissions(mode: number): string {
  const isDir = (mode & 0o040000) === 0o040000;
  const isLink = (mode & 0o120000) === 0o120000;

  let prefix = '-';
  if (isDir) prefix = 'd';
  if (isLink) prefix = 'l';

  const user = [
    mode & 0o400 ? 'r' : '-',
    mode & 0o200 ? 'w' : '-',
    mode & 0o100 ? 'x' : '-',
  ].join('');

  const group = [
    mode & 0o040 ? 'r' : '-',
    mode & 0o020 ? 'w' : '-',
    mode & 0o010 ? 'x' : '-',
  ].join('');

  const other = [
    mode & 0o004 ? 'r' : '-',
    mode & 0o002 ? 'w' : '-',
    mode & 0o001 ? 'x' : '-',
  ].join('');

  return prefix + user + group + other;
}

export function formatOctal(mode: number): string {
  return '0' + (mode & 0o777).toString(8);
}

export class SSHManager {
  static createSession(config: {
    host: string;
    port?: number;
    username: string;
    password?: string;
    privateKey?: string;
    passphrase?: string;
  }): Promise<{ sessionId: string; sessionInfo: { host: string; port: number; username: string } }> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      const sessionId = nanoid(32);
      const port = config.port || 22;

      let timer: NodeJS.Timeout | null = setTimeout(() => {
        client.end();
        reject(new Error('Connection timed out after 15 seconds'));
      }, 15000);

      client.on('ready', () => {
        if (timer) clearTimeout(timer);
        timer = null;
        // Handler keyboard-interactive memegang password lewat closure; lepas setelah login.
        client.removeAllListeners('keyboard-interactive');

        client.sftp((err, sftp) => {
          if (err) {
            client.end();
            return reject(new Error('Failed to start SFTP subsystem: ' + err.message));
          }

          const session: SSHSessionInfo = {
            id: sessionId,
            host: config.host,
            port,
            username: config.username,
            connectedAt: Date.now(),
            lastActive: Date.now(),
            client,
            sftp,
            platform: 'unix',
            shell: 'sh',
            homeDir: '/',
          };

          sessions.set(sessionId, session);

          client.on('close', () => {
            sessions.delete(sessionId);
          });

          client.on('error', (clientErr) => {
            console.error(`[SSH Session ${sessionId}] error:`, clientErr);
          });

          this.detectPlatform(session)
            .catch((detectErr) => console.error(`[SSH Session ${sessionId}] platform detection failed:`, detectErr))
            .finally(() => {
              resolve({
                sessionId,
                sessionInfo: {
                  host: config.host,
                  port,
                  username: config.username,
                },
              });
            });
        });
      });

      // Sebagian server (termasuk Windows OpenSSH tertentu) hanya menawarkan
      // keyboard-interactive untuk login password.
      client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
        finish(prompts.map(() => config.password ?? ''));
      });

      client.on('error', (err) => {
        if (timer) clearTimeout(timer);
        timer = null;
        reject(err);
      });

      const connectOpts: ConnectConfig = {
        host: config.host,
        port,
        username: config.username,
        readyTimeout: 15000,
        keepaliveInterval: 10000,
      };

      if (config.privateKey) {
        connectOpts.privateKey = config.privateKey;
        if (config.passphrase) connectOpts.passphrase = config.passphrase;
      } else if (config.password !== undefined) {
        connectOpts.password = config.password;
        connectOpts.tryKeyboard = true;
      }

      try {
        client.connect(connectOpts);
      } catch (err: any) {
        if (timer) clearTimeout(timer);
        reject(err);
      }
    });
  }

  /**
   * Menentukan OS dan shell bawaan server:
   * - `echo %OS%` menghasilkan "Windows_NT" hanya di cmd.exe
   * - `uname -s` berhasil di shell Unix (termasuk MSYS/Cygwin/WSL sebagai shell Windows)
   * - selain itu dianggap PowerShell (DefaultShell Windows OpenSSH)
   */
  private static async detectPlatform(session: SSHSessionInfo) {
    const run = (command: string) => this.execCommand(session.id, command, 10_000).catch(() => null);

    const cmdProbe = await run('echo %OS%');
    if (cmdProbe?.stdout.trim() === 'Windows_NT') {
      session.platform = 'windows';
      session.shell = 'cmd';
    } else {
      const uname = await run('uname -s');
      if (uname && uname.exitCode === 0 && uname.stdout.trim()) {
        session.platform = 'unix';
        session.shell = 'sh';
      } else {
        session.platform = 'windows';
        session.shell = 'powershell';
      }
    }

    // realpath('.') memberi folder awal SFTP di semua platform, tanpa bergantung pada $HOME.
    session.homeDir = await new Promise<string>((resolve) => {
      if (!session.sftp) return resolve('/');
      session.sftp.realpath('.', (err, absPath) => resolve(err || !absPath ? '/' : absPath.replace(/\\/g, '/')));
    });

    if (session.platform === 'unix') session.loginPath = await this.detectLoginPath(session);
  }

  /**
   * `exec` SSH menjalankan shell non-login: ~/.bash_profile dan ~/.bashrc tidak
   * dibaca, sehingga program yang dipasang lewat npm global, nvm, pipx, dsb.
   * "command not found". Ambil PATH dari login shell user sekali saat konek.
   */
  private static async detectLoginPath(session: SSHSessionInfo): Promise<string | undefined> {
    const probe = (flags: string) =>
      `S="\${SHELL:-/bin/sh}"; case "$S" in */fish|*/nu) S=/bin/sh;; esac; "$S" ${flags} 'printf "__SDPATH__%s__SDEND__" "$PATH"' 2>/dev/null </dev/null`;
    // -i ikut: banyak installer (nvm, bun) menulis PATH di ~/.bashrc yang hanya dibaca shell interaktif.
    for (const flags of ['-lic', '-lc']) {
      const res = await this.execCommand(session.id, probe(flags), 10_000).catch(() => null);
      const found = res?.stdout.match(/__SDPATH__([^\n\0]*?)__SDEND__(?![\s\S]*__SDPATH__)/)?.[1];
      if (found && found.includes('/') && found.length < 8192) return found;
    }
    return undefined;
  }

  /** Membungkus perintah dengan folder kerja dan penanganan sudo sesuai shell. */
  static buildCommand(session: SSHSessionInfo, command: string, options: ExecOptions = {}): string {
    const cwd = options.cwd && options.cwd !== '/' ? options.cwd : '';

    if (session.shell === 'cmd') {
      return cwd ? `cd /d "${toWindowsPath(cwd)}" && ${command}` : command;
    }
    if (session.shell === 'powershell') {
      return cwd ? `Set-Location -LiteralPath '${toWindowsPath(cwd).replace(/'/g, "''")}' -ErrorAction Stop; ${command}` : command;
    }

    const parts: string[] = [];
    // PATH login shell user (npm global, nvm, ~/.local/bin, ...), seperti saat SSH biasa.
    if (session.loginPath) parts.push(`export PATH=${shellQuote(session.loginPath)}`);
    if (options.sudo === 'password') parts.push(SUDO_ASKPASS_PREFIX);
    if (options.sudo === 'nonInteractive') parts.push(SUDO_NONINTERACTIVE_PREFIX);
    parts.push(cwd ? `cd ${shellQuote(cwd)} && ${command}` : command);
    return parts.join('\n');
  }

  /** Menjalankan perintah pengguna: folder kerja, sudo, dan timeout sekaligus. */
  static async run(sessionId: string, command: string, options: ExecOptions = {}) {
    const session = this.getSession(sessionId);
    if (!session) throw new Error('No active SSH session');
    const track = Boolean(options.trackCwd) && session.shell !== 'cmd';
    const body = track ? withCwdReport(session.shell, command) : command;
    const wrapped = this.buildCommand(session, body, options);
    const stdin = session.platform === 'unix' && options.sudo === 'password' ? `${options.sudoPassword ?? ''}\n` : undefined;
    const res = await this.execCommand(sessionId, wrapped, options.timeoutMs ?? 0, stdin);
    if (!track) return res;
    const { stdout, cwd } = extractCwd(res.stdout, session.shell);
    return { ...res, stdout, cwd };
  }

  /**
   * Kanal exec yang tetap terbuka (stream log, konsol interaktif). Pemanggil
   * bertanggung jawab menutupnya. Dengan `pty`, perintah mendapat terminal.
   */
  static openChannel(
    sessionId: string,
    command: string,
    options: { pty?: { cols: number; rows: number } } = {},
  ): Promise<ClientChannel> {
    const session = this.getSession(sessionId);
    if (!session) throw new Error('No active SSH session');
    const execOptions = options.pty
      ? { pty: { term: 'xterm-256color', cols: options.pty.cols, rows: options.pty.rows } }
      : {};
    return new Promise((resolve, reject) => {
      session.client.exec(command, execOptions, (err, stream) => (err ? reject(err) : resolve(stream)));
    });
  }

  /**
   * Shell interaktif sungguhan (seperti `ssh user@host`): login shell dengan PTY,
   * jadi PATH, alias, prompt, wizard interaktif, vim, dan top berjalan normal.
   */
  static openShell(sessionId: string, size: { cols: number; rows: number }): Promise<ClientChannel> {
    const session = this.getSession(sessionId);
    if (!session) throw new Error('No active SSH session');
    return new Promise((resolve, reject) => {
      session.client.shell({ term: 'xterm-256color', cols: size.cols, rows: size.rows }, (err, stream) => (err ? reject(err) : resolve(stream)));
    });
  }

  /** Seperti execCommand, tetapi exit code bukan 0 menjadi error. */
  private static async execOrThrow(sessionId: string, command: string, context: string) {
    const res = await this.execCommand(sessionId, command, 60_000);
    if (res.exitCode !== 0) throw new Error(`${context}: ${(res.stderr || res.stdout).trim() || `exit code ${res.exitCode}`}`);
    return res;
  }

  /** Cek keberadaan sesi tanpa memperbarui lastActive (untuk tugas latar belakang). */
  static hasSession(sessionId: string): boolean {
    return sessions.has(sessionId);
  }

  static getSession(sessionId: string): SSHSessionInfo | null {
    const session = sessions.get(sessionId);
    if (session) {
      session.lastActive = Date.now();
      return session;
    }
    return null;
  }

  static closeSession(sessionId: string): boolean {
    const session = sessions.get(sessionId);
    if (session) {
      try {
        session.client.end();
      } catch (e) {
        // ignore
      }
      sessions.delete(sessionId);
      return true;
    }
    return false;
  }

  static async listDirectory(sessionId: string, remotePath: string = '/'): Promise<FileItem[]> {
    const session = this.getSession(sessionId);
    if (!session || !session.sftp) {
      throw new Error('No active SSH/SFTP session');
    }

    const sftp = session.sftp;
    const cleanPath = remotePath.replace(/\\/g, '/');

    return new Promise((resolve, reject) => {
      sftp.readdir(cleanPath, (err, list) => {
        if (err) {
          return reject(new Error(`Failed to read directory '${cleanPath}': ${err.message}`));
        }

        const items: FileItem[] = list.map((item) => {
          const mode = item.attrs.mode || 0;
          const isDir = (mode & 0o040000) === 0o040000;
          const isLink = (mode & 0o120000) === 0o120000;
          const fullPath = cleanPath === '/' ? `/${item.filename}` : `${cleanPath}/${item.filename}`.replace(/\/+/g, '/');

          return {
            name: item.filename,
            path: fullPath,
            isDirectory: isDir,
            isSymbolicLink: isLink,
            size: item.attrs.size || 0,
            modifyTime: (item.attrs.mtime || 0) * 1000,
            accessTime: (item.attrs.atime || 0) * 1000,
            permissions: formatPermissions(mode),
            mode,
            octal: formatOctal(mode),
            owner: item.attrs.uid,
            group: item.attrs.gid,
          };
        });

        // Sort: directories first, then alphabetically
        items.sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        });

        resolve(items);
      });
    });
  }

  static async readFile(sessionId: string, remotePath: string): Promise<string> {
    const session = this.getSession(sessionId);
    if (!session || !session.sftp) {
      throw new Error('No active SSH/SFTP session');
    }

    const sftp = session.sftp;
    return new Promise((resolve, reject) => {
      const stream = sftp.createReadStream(remotePath);
      const chunks: Buffer[] = [];

      stream.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.on('error', (err: Error) => reject(new Error(`Failed to read file '${remotePath}': ${err.message}`)));
    });
  }

  static async readFileBuffer(sessionId: string, remotePath: string): Promise<Buffer> {
    const session = this.getSession(sessionId);
    if (!session || !session.sftp) {
      throw new Error('No active SSH/SFTP session');
    }

    const sftp = session.sftp;
    return new Promise((resolve, reject) => {
      const stream = sftp.createReadStream(remotePath);
      const chunks: Buffer[] = [];

      stream.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', (err: Error) => reject(new Error(`Failed to read file '${remotePath}': ${err.message}`)));
    });
  }

  static async writeFile(sessionId: string, remotePath: string, content: string | Buffer): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session || !session.sftp) {
      throw new Error('No active SSH/SFTP session');
    }

    const sftp = session.sftp;
    return new Promise((resolve, reject) => {
      const stream = sftp.createWriteStream(remotePath);
      stream.on('close', () => resolve());
      stream.on('error', (err: Error) => reject(new Error(`Failed to write file '${remotePath}': ${err.message}`)));
      stream.end(content);
    });
  }

  static async createDirectory(sessionId: string, remotePath: string): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session || !session.sftp) {
      throw new Error('No active SSH/SFTP session');
    }

    const sftp = session.sftp;
    const mkdir = (path: string) =>
      new Promise<Error | null>((resolve) => sftp.mkdir(path, (err) => resolve(err || null)));
    const exists = (path: string) =>
      new Promise<boolean>((resolve) => sftp.stat(path, (err) => resolve(!err)));

    const err = await mkdir(remotePath);
    if (!err) return;

    if (session.platform === 'unix') {
      await this.execOrThrow(sessionId, `mkdir -p ${shellQuote(remotePath)}`, `Failed to create directory '${remotePath}'`);
      return;
    }

    // Windows: buat folder induk satu per satu lewat SFTP (setara mkdir -p).
    const parts = remotePath.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current += '/' + part;
      if (/^\/[A-Za-z]:$/.test(current) || (await exists(current))) continue;
      const partErr = await mkdir(current);
      if (partErr) throw new Error(`Failed to create directory '${current}': ${partErr.message}`);
    }
  }

  /** Hapus folder rekursif lewat SFTP; dipakai di Windows yang tidak punya rm -rf. */
  private static async removeTreeSftp(sftp: SFTPWrapper, path: string): Promise<void> {
    const list = await new Promise<any[]>((resolve, reject) =>
      sftp.readdir(path, (err, items) => (err ? reject(err) : resolve(items))),
    );
    for (const item of list) {
      const child = `${path}/${item.filename}`.replace(/\/+/g, '/');
      const mode = item.attrs.mode || 0;
      if ((mode & 0o170000) === 0o040000) await this.removeTreeSftp(sftp, child);
      else await new Promise<void>((resolve, reject) => sftp.unlink(child, (err) => (err ? reject(err) : resolve())));
    }
    await new Promise<void>((resolve, reject) => sftp.rmdir(path, (err) => (err ? reject(err) : resolve())));
  }

  static async deletePath(sessionId: string, remotePath: string, isDirectory: boolean): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error('No active SSH/SFTP session');
    }

    const sftp = session.sftp;
    if (!sftp) throw new Error('No active SFTP session');

    if (isDirectory) {
      if (session.platform === 'windows') {
        await this.removeTreeSftp(sftp, remotePath).catch((err) => {
          throw new Error(`Failed to delete folder '${remotePath}': ${err.message}`);
        });
        return;
      }
      await this.execOrThrow(sessionId, `rm -rf -- ${shellQuote(remotePath)}`, `Failed to delete folder '${remotePath}'`);
      return;
    }

    const err = await new Promise<Error | null>((resolve) => sftp.unlink(remotePath, (e) => resolve(e || null)));
    if (!err) return;
    if (session.platform === 'windows') throw new Error(`Failed to delete file '${remotePath}': ${err.message}`);
    await this.execOrThrow(sessionId, `rm -f -- ${shellQuote(remotePath)}`, `Failed to delete file '${remotePath}'`);
  }

  static async renamePath(sessionId: string, oldPath: string, newPath: string): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session || !session.sftp) {
      throw new Error('No active SSH/SFTP session');
    }

    const sftp = session.sftp;
    const err = await new Promise<Error | null>((resolve) => sftp.rename(oldPath, newPath, (e) => resolve(e || null)));
    if (!err) return;
    if (session.platform === 'windows') throw new Error(`Failed to rename '${oldPath}' to '${newPath}': ${err.message}`);
    await this.execOrThrow(sessionId, `mv -- ${shellQuote(oldPath)} ${shellQuote(newPath)}`, `Failed to rename '${oldPath}' to '${newPath}'`);
  }

  static async chmodPath(sessionId: string, remotePath: string, mode: number | string): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session || !session.sftp) {
      throw new Error('No active SSH/SFTP session');
    }

    const numericMode = typeof mode === 'string' ? parseInt(mode, 8) : mode;
    const sftp = session.sftp;

    if (!Number.isFinite(numericMode) || numericMode < 0 || numericMode > 0o7777) {
      throw new Error(`Invalid mode '${mode}'`);
    }
    const err = await new Promise<Error | null>((resolve) => sftp.chmod(remotePath, numericMode, (e) => resolve(e || null)));
    if (!err) return;
    if (session.platform === 'windows') throw new Error(`chmod tidak didukung di server Windows: ${err.message}`);
    await this.execOrThrow(sessionId, `chmod ${numericMode.toString(8)} -- ${shellQuote(remotePath)}`, `Failed to change mode on '${remotePath}'`);
  }

  static async statPath(sessionId: string, remotePath: string): Promise<any> {
    const session = this.getSession(sessionId);
    if (!session || !session.sftp) {
      throw new Error('No active SSH/SFTP session');
    }

    const sftp = session.sftp;
    return new Promise((resolve, reject) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err) return reject(err);
        resolve(stats);
      });
    });
  }

  /**
   * Menjalankan satu perintah. `timeoutMs` menutup kanal bila perintah tidak
   * selesai (mis. menunggu input sudo), hasilnya exit code 124 seperti `timeout`.
   */
  static execCommand(
    sessionId: string,
    command: string,
    timeoutMs = 0,
    stdin?: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut?: boolean }> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error('No active SSH session');
    }

    return new Promise((resolve, reject) => {
      session.client.exec(command, (err, stream) => {
        if (err) return reject(err);

        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const timer = timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true;
              try { stream.signal('KILL'); } catch { /* server may not support signals */ }
              stream.close();
            }, timeoutMs)
          : null;

        stream.on('close', (code: number | null, signal?: string) => {
          if (timer) clearTimeout(timer);
          if (timedOut) {
            stderr += `${stderr && !stderr.endsWith('\n') ? '\n' : ''}Timed out after ${Math.round(timeoutMs / 1000)}s`;
            return resolve({ stdout, stderr, exitCode: 124, timedOut: true });
          }
          // Dihentikan oleh sinyal: code null, jangan dianggap sukses.
          const exitCode = typeof code === 'number' ? code : signal ? 128 : 0;
          resolve({ stdout, stderr, exitCode });
        });

        stream.on('data', (data: Buffer) => {
          stdout += data.toString('utf8');
        });

        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString('utf8');
        });

        stream.on('error', (streamErr: any) => {
          reject(streamErr);
        });

        // Tidak ada terminal interaktif: stdin selalu ditutup supaya perintah
        // yang membaca input (cat, read, prompt) langsung selesai, bukan menggantung.
        if (stdin) stream.write(stdin);
        stream.end();
      });
    });
  }

  static async getSystemInfo(sessionId: string): Promise<SystemInfo> {
    const session = this.getSession(sessionId);
    if (!session) return { homeDir: '/' };
    const base = { homeDir: session.homeDir || '/', platform: session.platform, shell: session.shell };

    try {
      if (session.platform === 'windows') {
        const res = await this.execCommand(
          sessionId,
          powershellCommand('[Environment]::OSVersion.VersionString'),
          15_000,
        );
        return { ...base, uname: res.stdout.trim() || 'Windows' };
      }

      const [unameRes, uptimeRes, dfRes] = await Promise.allSettled([
        this.execCommand(sessionId, 'uname -srm 2>/dev/null || uname -a', 15_000),
        this.execCommand(sessionId, 'uptime 2>/dev/null', 15_000),
        this.execCommand(sessionId, 'df -h / 2>/dev/null | tail -n 1', 15_000),
      ]);

      return {
        ...base,
        uname: unameRes.status === 'fulfilled' ? unameRes.value.stdout.trim() : '',
        uptime: uptimeRes.status === 'fulfilled' ? uptimeRes.value.stdout.trim() : '',
        diskUsage: dfRes.status === 'fulfilled' ? dfRes.value.stdout.trim() : '',
      };
    } catch {
      return base;
    }
  }
}
