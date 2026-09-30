/**
 * Konfigurasi runtime dari environment (Docker -e / compose / .env saat dev).
 *
 *   STORAGE_MODE  browser  (bawaan) pipeline & daftar server di localStorage browser
 *                 database  disimpan di SQLite: DATA_DIR/serverdeck.db
 *   DATA_DIR      folder data untuk mode database (bawaan /data di Docker, ./data saat dev)
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type StorageMode = 'browser' | 'database';

export function env(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function storageMode(): StorageMode {
  return (env('STORAGE_MODE') || '').trim().toLowerCase() === 'database' ? 'database' : 'browser';
}

export function dataDir(): string {
  return resolve(env('DATA_DIR') || (existsSync('/.dockerenv') ? '/data' : './data'));
}

/**
 * Apakah DATA_DIR adalah volume/bind mount. Bila bukan, data di dalam container
 * hilang setiap kali container dibuat ulang (update image).
 */
export function dataDirIsMounted(): boolean | null {
  try {
    const mounts = readFileSync('/proc/self/mountinfo', 'utf8');
    const dir = dataDir();
    return mounts.split('\n').some((line) => line.split(' ')[4] === dir);
  } catch {
    // Bukan Linux (mis. dev di Windows): tidak bisa dipastikan.
    return null;
  }
}
