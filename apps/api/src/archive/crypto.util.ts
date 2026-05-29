import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-cbc' as const;

/** Derive a 32-byte key from a hex string (pad/truncate as needed) */
function toKey(hexKey: string): Buffer {
  const hex = hexKey.replace(/[^0-9a-fA-F]/g, '').padEnd(64, '0').slice(0, 64);
  return Buffer.from(hex, 'hex');
}

/**
 * AES-256-CBC encrypt. Returns `iv_hex:ciphertext_hex`.
 * Each call uses a fresh random IV so ciphertext is non-deterministic.
 */
export function encryptToken(plaintext: string, hexKey: string): string {
  const iv      = randomBytes(16);
  const cipher  = createCipheriv(ALGO, toKey(hexKey), iv);
  const enc     = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${enc.toString('hex')}`;
}

/** AES-256-CBC decrypt. Expects the `iv_hex:ciphertext_hex` format from encryptToken. */
export function decryptToken(ciphertext: string, hexKey: string): string {
  const sep = ciphertext.indexOf(':');
  if (sep === -1) throw new Error('Invalid ciphertext — expected iv_hex:ciphertext_hex');
  const iv      = Buffer.from(ciphertext.slice(0, sep), 'hex');
  const enc     = Buffer.from(ciphertext.slice(sep + 1), 'hex');
  const decipher = createDecipheriv(ALGO, toKey(hexKey), iv);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
