import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Authenticated encryption for cloud-archive OAuth tokens at rest (US-008 / R-08).
 *
 * New ciphertext uses AES-256-GCM, which is authenticated: tampering with the
 * stored value is detected on decrypt (the GCM tag fails) instead of silently
 * returning garbage like the previous unauthenticated AES-256-CBC scheme.
 *
 * Format (versioned, colon-separated hex):  `v2:iv:authTag:ciphertext`
 *
 * Values written by the old CBC scheme (`iv:ciphertext`, no version prefix) are
 * still readable, so existing rows decrypt without a forced key/data reset.
 */

const GCM_ALGO       = 'aes-256-gcm' as const;
const LEGACY_CBC_ALGO = 'aes-256-cbc' as const;
const GCM_IV_BYTES   = 12; // 96-bit nonce — the recommended size for GCM
const VERSION        = 'v2' as const;

/** Derive a 32-byte key from a hex string (pad/truncate as needed). */
function toKey(hexKey: string): Buffer {
  const hex = hexKey.replace(/[^0-9a-fA-F]/g, '').padEnd(64, '0').slice(0, 64);
  return Buffer.from(hex, 'hex');
}

/**
 * AES-256-GCM encrypt. Returns `v2:iv_hex:authTag_hex:ciphertext_hex`.
 * A fresh random IV per call makes the ciphertext non-deterministic; the auth
 * tag lets decrypt verify integrity.
 */
export function encryptToken(plaintext: string, hexKey: string): string {
  const iv     = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv(GCM_ALGO, toKey(hexKey), iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `${VERSION}:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/**
 * Decrypt a token. Authenticated AES-256-GCM (`v2:` format) is the default;
 * values written by the legacy unauthenticated AES-256-CBC scheme are still
 * read so existing rows keep working.
 */
export function decryptToken(ciphertext: string, hexKey: string): string {
  if (ciphertext.startsWith(`${VERSION}:`)) {
    const [, ivHex, tagHex, ctHex] = ciphertext.split(':');
    if (!ivHex || !tagHex || !ctHex) {
      throw new Error('Invalid ciphertext — expected v2:iv_hex:tag_hex:ciphertext_hex');
    }
    const decipher = createDecipheriv(GCM_ALGO, toKey(hexKey), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(ctHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  }

  // Legacy AES-256-CBC fallback (pre-US-008, unauthenticated): `iv_hex:ct_hex`.
  const sep = ciphertext.indexOf(':');
  if (sep === -1) throw new Error('Invalid ciphertext — expected iv_hex:ciphertext_hex');
  const iv       = Buffer.from(ciphertext.slice(0, sep), 'hex');
  const enc      = Buffer.from(ciphertext.slice(sep + 1), 'hex');
  const decipher = createDecipheriv(LEGACY_CBC_ALGO, toKey(hexKey), iv);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
