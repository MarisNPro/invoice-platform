import { createCipheriv, randomBytes } from 'crypto';
import { encryptToken, decryptToken } from './crypto.util';

const KEY = 'a'.repeat(64); // 64 hex chars → 32-byte AES key

/** Produce a legacy AES-256-CBC ciphertext (`iv_hex:ct_hex`) for read-compat tests. */
function legacyCbcEncrypt(plaintext: string, hexKey: string): string {
  const key    = Buffer.from(hexKey.replace(/[^0-9a-fA-F]/g, '').padEnd(64, '0').slice(0, 64), 'hex');
  const iv     = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${enc.toString('hex')}`;
}

describe('crypto.util (AES-256-GCM tokens)', () => {
  it('round-trips a token (encrypt → decrypt)', () => {
    const secret = 'ya29.a0Afh-some-oauth-access-token';
    expect(decryptToken(encryptToken(secret, KEY), KEY)).toBe(secret);
  });

  it('emits the versioned v2 GCM format', () => {
    const parts = encryptToken('hello', KEY).split(':');
    expect(parts[0]).toBe('v2');
    expect(parts).toHaveLength(4); // v2:iv:tag:ciphertext
  });

  it('is non-deterministic — same input yields different ciphertext', () => {
    expect(encryptToken('same', KEY)).not.toBe(encryptToken('same', KEY));
  });

  it('rejects tampered ciphertext (authentication tag fails)', () => {
    const [v, iv, tag, ct] = encryptToken('tamper-me', KEY).split(':') as [string, string, string, string];
    // Flip the last hex nibble of the ciphertext body.
    const flipped = ct.slice(0, -1) + (ct.endsWith('0') ? '1' : '0');
    expect(() => decryptToken(`${v}:${iv}:${tag}:${flipped}`, KEY)).toThrow();
  });

  it('still decrypts legacy AES-256-CBC ciphertext (backward compatibility)', () => {
    const secret = 'legacy-refresh-token';
    expect(decryptToken(legacyCbcEncrypt(secret, KEY), KEY)).toBe(secret);
  });

  it('throws on a malformed v2 payload', () => {
    expect(() => decryptToken('v2:onlyonepart', KEY)).toThrow();
  });
});
