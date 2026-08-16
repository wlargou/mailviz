import { describe, it, expect, vi, afterEach } from 'vitest';
import { encrypt, decrypt } from './encryption.js';

/**
 * Encryption of Google OAuth tokens at rest.
 *
 * This module guards the most sensitive rows in the database: the refresh
 * tokens that grant full access to a user's mailbox and calendar. Two
 * properties matter and neither is obvious from reading the code.
 *
 * 1. The plaintext fallback. With no TOKEN_ENCRYPTION_KEY configured, encrypt()
 *    is a no-op and decrypt() passes values through, so the app still boots in
 *    a bare development environment.
 *
 * 2. The legacy passthrough. decrypt() must ALSO return already-stored
 *    plaintext unchanged *while a key is configured* — it sniffs the
 *    `iv:authTag:ciphertext` shape by splitting on ':'. That is the only reason
 *    encryption could be switched on in an existing deployment without
 *    invalidating every stored token and forcing every user to re-auth. If
 *    someone "tidies up" decrypt() into an unconditional decipher, every
 *    pre-encryption token in production breaks at once, and the failure shows
 *    up as mysterious Gmail sync errors rather than as a decrypt error.
 *
 * The suite-wide TOKEN_ENCRYPTION_KEY set in vitest.config.ts means these tests
 * exercise the real AES-256-GCM path by default; the no-key case re-imports the
 * module against a stubbed env instead of mutating the real one.
 */

/** Load a fresh copy of the module against a specific TOKEN_ENCRYPTION_KEY. */
async function importWithKey(key: string) {
  vi.resetModules();
  vi.doMock('../config/env.js', () => ({ env: { TOKEN_ENCRYPTION_KEY: key } }));
  return import('./encryption.js');
}

afterEach(() => {
  vi.doUnmock('../config/env.js');
  vi.resetModules();
});

describe('encrypt/decrypt with a key configured', () => {
  it('round-trips a value', () => {
    const token = 'ya29.a0AfB_byC-not-a-real-google-refresh-token';

    expect(decrypt(encrypt(token))).toBe(token);
  });

  it('round-trips unicode and empty strings', () => {
    expect(decrypt(encrypt(''))).toBe('');
    expect(decrypt(encrypt('café ☕ 東京'))).toBe('café ☕ 東京');
  });

  it('does not store the plaintext', () => {
    const secret = 'super-secret-refresh-token';
    const ciphertext = encrypt(secret);

    expect(ciphertext).not.toBe(secret);
    expect(ciphertext).not.toContain(secret);
  });

  it('produces a different ciphertext each call — random IV', () => {
    const secret = 'super-secret-refresh-token';

    const first = encrypt(secret);
    const second = encrypt(secret);

    // Equal ciphertexts would mean a fixed IV, which leaks that two rows hold
    // the same token and breaks AES-GCM's security guarantees outright.
    expect(first).not.toBe(second);
    expect(decrypt(first)).toBe(secret);
    expect(decrypt(second)).toBe(secret);
  });

  it('emits the iv:authTag:ciphertext envelope decrypt() expects', () => {
    const parts = encrypt('token').split(':');

    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatch(/^[0-9a-f]{32}$/); // 16-byte IV
    expect(parts[1]).toMatch(/^[0-9a-f]{32}$/); // 16-byte auth tag
  });

  it('rejects a tampered ciphertext rather than returning garbage', () => {
    const [iv, authTag, body] = encrypt('super-secret-refresh-token').split(':');
    // Flip the first byte of the ciphertext; GCM's auth tag must catch it.
    const flipped = (body[0] === '0' ? '1' : '0') + body.slice(1);

    expect(() => decrypt(`${iv}:${authTag}:${flipped}`)).toThrow();
  });

  it('returns legacy plaintext unchanged — REGRESSION', () => {
    // The migration path: rows written before TOKEN_ENCRYPTION_KEY existed are
    // still plain tokens. decrypt() must hand them back untouched even though a
    // key is now configured, or enabling encryption logs every user out.
    const legacy = 'ya29.legacy-plaintext-token-stored-before-encryption';

    expect(decrypt(legacy)).toBe(legacy);
  });

  it('does not mangle plaintext values that contain colons', () => {
    // The shape check splits on ':', so colon-bearing plaintext is the risky
    // input. Anything that is not exactly three parts must pass through.
    expect(decrypt('https://accounts.google.com/o/oauth2')).toBe('https://accounts.google.com/o/oauth2');
    expect(decrypt('scope:gmail')).toBe('scope:gmail');
    expect(decrypt('a:b:c:d')).toBe('a:b:c:d');
    expect(decrypt('::::')).toBe('::::');
  });

  it('cannot pass through plaintext that happens to have exactly two colons', () => {
    // A documented limitation of the shape heuristic rather than a behaviour we
    // want: such a value is mistaken for the envelope and fails to decipher.
    // Google tokens are colon-free so no stored value hits this, but the test
    // pins the boundary so a future format change is a deliberate decision.
    expect(() => decrypt('host:port:path')).toThrow();
  });

  it('cannot decrypt a value encrypted under a different key', async () => {
    const other = await importWithKey('ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100');
    const foreign = other.encrypt('super-secret-refresh-token');

    expect(() => decrypt(foreign)).toThrow();
  });
});

describe('encrypt/decrypt with no key configured', () => {
  it('encrypt returns the plaintext untouched', async () => {
    const { encrypt: encryptNoKey } = await importWithKey('');

    expect(encryptNoKey('ya29.some-token')).toBe('ya29.some-token');
  });

  it('decrypt passes any value through, including one shaped like ciphertext', async () => {
    const { decrypt: decryptNoKey } = await importWithKey('');

    expect(decryptNoKey('ya29.some-token')).toBe('ya29.some-token');
    // No key means no way to decipher, so even a real envelope is returned
    // verbatim rather than throwing — the caller gets an obviously wrong token
    // instead of a crash. Losing the key is not a recoverable state.
    const envelope = encrypt('written-while-a-key-was-configured');
    expect(decryptNoKey(envelope)).toBe(envelope);
  });

  it('round-trips through the fallback', async () => {
    const { encrypt: encryptNoKey, decrypt: decryptNoKey } = await importWithKey('');

    expect(decryptNoKey(encryptNoKey('ya29.some-token'))).toBe('ya29.some-token');
  });
});
