/**
 * Database SQLite untuk STORAGE_MODE=database. Satu file: DATA_DIR/serverdeck.db
 *
 * Kolom berakhiran `_enc` terenkripsi AES-256-GCM (lihat crypto.ts). Password
 * dan private key tidak pernah dikirim kembali ke browser: hanya server yang
 * membukanya saat membuka koneksi SSH.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { dataDir, storageMode } from './config';
import { decrypt, encrypt } from './crypto';

let db: DatabaseSync | null = null;

export const dbPath = () => join(dataDir(), 'serverdeck.db');

const MIGRATIONS: string[] = [
  `CREATE TABLE connections (
     id              TEXT PRIMARY KEY,
     name            TEXT NOT NULL DEFAULT '',
     host            TEXT NOT NULL,
     port            INTEGER NOT NULL DEFAULT 22,
     username        TEXT NOT NULL,
     auth_type       TEXT NOT NULL CHECK (auth_type IN ('password', 'key')),
     secret_enc      TEXT,
     passphrase_enc  TEXT,
     created_at      INTEGER NOT NULL,
     updated_at      INTEGER NOT NULL,
     last_used_at    INTEGER
   );
   CREATE UNIQUE INDEX connections_target ON connections(host, port, username);

   CREATE TABLE pipelines (
     id              TEXT PRIMARY KEY,
     name            TEXT NOT NULL,
     description     TEXT NOT NULL DEFAULT '',
     steps           TEXT NOT NULL,
     variables_enc   TEXT,
     runs            TEXT NOT NULL DEFAULT '[]',
     created_at      INTEGER NOT NULL,
     updated_at      INTEGER NOT NULL
   );`,
];

export function getDb(): DatabaseSync {
  if (storageMode() !== 'database') throw new Error('Mode database tidak aktif (STORAGE_MODE=database)');
  if (db) return db;

  mkdirSync(dataDir(), { recursive: true });
  db = new DatabaseSync(dbPath());
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();

  for (; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]);
      db.prepare('UPDATE schema_version SET version = ?').run(version + 1);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}

const newId = () => randomBytes(12).toString('hex');

// ---------- Koneksi SSH ----------

export interface ConnectionSummary {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key';
  hasSecret: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface ConnectionSecret {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export function listConnections(): ConnectionSummary[] {
  const rows = getDb()
    .prepare('SELECT id, name, host, port, username, auth_type, secret_enc IS NOT NULL AS has_secret, created_at, last_used_at FROM connections ORDER BY COALESCE(last_used_at, created_at) DESC')
    .all() as any[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    host: r.host,
    port: r.port,
    username: r.username,
    authType: r.auth_type,
    hasSecret: Boolean(r.has_secret),
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }));
}

/** Simpan / perbarui koneksi (unik per host+port+username). Secret opsional. */
export function saveConnection(input: ConnectionSecret & { name?: string; storeSecret: boolean }): string {
  const now = Date.now();
  const d = getDb();
  const existing = d.prepare('SELECT id FROM connections WHERE host = ? AND port = ? AND username = ?').get(input.host, input.port, input.username) as { id: string } | undefined;
  const authType = input.privateKey ? 'key' : 'password';
  const secret = input.storeSecret ? (input.privateKey || input.password || null) : null;
  const secretEnc = secret ? encrypt(secret) : null;
  const passphraseEnc = input.storeSecret && input.privateKey && input.passphrase ? encrypt(input.passphrase) : null;

  if (existing) {
    d.prepare('UPDATE connections SET name = COALESCE(NULLIF(?, \'\'), name), auth_type = ?, secret_enc = ?, passphrase_enc = ?, updated_at = ?, last_used_at = ? WHERE id = ?')
      .run(input.name || '', authType, secretEnc, passphraseEnc, now, now, existing.id);
    return existing.id;
  }
  const id = newId();
  d.prepare('INSERT INTO connections (id, name, host, port, username, auth_type, secret_enc, passphrase_enc, created_at, updated_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, input.name || '', input.host, input.port, input.username, authType, secretEnc, passphraseEnc, now, now, now);
  return id;
}

export function getConnectionSecret(id: string): ConnectionSecret | null {
  const r = getDb().prepare('SELECT host, port, username, auth_type, secret_enc, passphrase_enc FROM connections WHERE id = ?').get(id) as any;
  if (!r) return null;
  const secret = r.secret_enc ? decrypt(r.secret_enc) : undefined;
  return {
    host: r.host,
    port: r.port,
    username: r.username,
    password: r.auth_type === 'password' ? secret : undefined,
    privateKey: r.auth_type === 'key' ? secret : undefined,
    passphrase: r.passphrase_enc ? decrypt(r.passphrase_enc) : undefined,
  };
}

export function touchConnection(id: string) {
  getDb().prepare('UPDATE connections SET last_used_at = ? WHERE id = ?').run(Date.now(), id);
}

export function renameConnection(id: string, name: string) {
  getDb().prepare('UPDATE connections SET name = ?, updated_at = ? WHERE id = ?').run(name.slice(0, 80), Date.now(), id);
}

export function forgetConnectionSecret(id: string) {
  getDb().prepare('UPDATE connections SET secret_enc = NULL, passphrase_enc = NULL, updated_at = ? WHERE id = ?').run(Date.now(), id);
}

export function deleteConnection(id: string) {
  getDb().prepare('DELETE FROM connections WHERE id = ?').run(id);
}

// ---------- Pipeline ----------

export interface StoredPipeline {
  id: string;
  name: string;
  description: string;
  variables: { key: string; value: string }[];
  steps: unknown[];
  runs: unknown[];
  createdAt: number;
  updatedAt: number;
}

function rowToPipeline(r: any): StoredPipeline {
  let variables: StoredPipeline['variables'] = [];
  try {
    variables = r.variables_enc ? JSON.parse(decrypt(r.variables_enc)) : [];
  } catch {
    variables = [];
  }
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    variables,
    steps: JSON.parse(r.steps || '[]'),
    runs: JSON.parse(r.runs || '[]'),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listPipelines(): StoredPipeline[] {
  return (getDb().prepare('SELECT * FROM pipelines ORDER BY updated_at DESC').all() as any[]).map(rowToPipeline);
}

const MAX_RUNS = 10;

export function upsertPipeline(p: StoredPipeline) {
  const vars = Array.isArray(p.variables) ? p.variables : [];
  const runs = Array.isArray(p.runs) ? p.runs.slice(0, MAX_RUNS) : [];
  getDb()
    .prepare(`INSERT INTO pipelines (id, name, description, steps, variables_enc, runs, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, steps = excluded.steps,
                variables_enc = excluded.variables_enc, runs = excluded.runs, updated_at = excluded.updated_at`)
    .run(
      p.id,
      String(p.name || 'Pipeline').slice(0, 200),
      String(p.description || '').slice(0, 2000),
      JSON.stringify(Array.isArray(p.steps) ? p.steps : []),
      vars.length ? encrypt(JSON.stringify(vars)) : null,
      JSON.stringify(runs),
      Number(p.createdAt) || Date.now(),
      Number(p.updatedAt) || Date.now(),
    );
}

export function deletePipeline(id: string) {
  getDb().prepare('DELETE FROM pipelines WHERE id = ?').run(id);
}

// ---------- Info untuk halaman Data ----------

export function databaseInfo() {
  const d = getDb();
  const count = (table: string) => (d.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  let size = 0;
  for (const suffix of ['', '-wal']) {
    try {
      size += statSync(dbPath() + suffix).size;
    } catch {
      // file WAL belum ada
    }
  }
  const runs = (d.prepare('SELECT COALESCE(SUM(json_array_length(runs)), 0) AS n FROM pipelines').get() as { n: number }).n;
  return {
    path: dbPath(),
    size,
    tables: [
      { name: 'connections', label: 'Koneksi SSH', rows: count('connections') },
      { name: 'pipelines', label: 'Pipeline', rows: count('pipelines') },
    ],
    runs,
    secrets: (d.prepare('SELECT COUNT(*) AS n FROM connections WHERE secret_enc IS NOT NULL').get() as { n: number }).n,
  };
}

/** Salinan konsisten database untuk diunduh (VACUUM INTO, aman saat sedang dipakai). */
export function backupTo(file: string) {
  getDb().prepare('VACUUM INTO ?').run(file);
}
