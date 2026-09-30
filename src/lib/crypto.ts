/**
 * Enkripsi data sensitif di database (password SSH, private key, variabel
 * pipeline) dengan AES-256-GCM.
 *
 * Ini enkripsi, bukan hash: password SSH harus bisa dibuka lagi untuk login.
 * Kunci:
 *   1. SECURITY_SECRET dari environment (disarankan: kunci terpisah dari data), atau
 *   2. file DATA_DIR/.secret-key yang dibuat otomatis (kunci ikut di volume yang sama).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir, env } from './config';

let cachedKey: Buffer | null = null;
let cachedSource: 'env' | 'file' | null = null;

export function keySource(): 'env' | 'file' {
  getKey();
  return cachedSource!;
}

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = env('SECURITY_SECRET');
  if (secret) {
    cachedKey = createHash('sha256').update(`serverdeck:data:${secret}`).digest();
    cachedSource = 'env';
    return cachedKey;
  }

  const dir = dataDir();
  const file = join(dir, '.secret-key');
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  cachedKey = createHash('sha256').update(`serverdeck:data:${readFileSync(file, 'utf8').trim()}`).digest();
  cachedSource = 'file';
  return cachedKey;
}

/** Format: v1:<iv>:<tag>:<ciphertext>, semuanya base64. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function decrypt(value: string): string {
  const [version, iv, tag, data] = value.split(':');
  if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('Format data terenkripsi tidak dikenal');
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  try {
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Tidak bisa membuka data terenkripsi. SECURITY_SECRET berubah sejak data disimpan?');
  }
}
