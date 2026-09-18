import {describe, expect, it} from 'vitest';
import {decryptAccessToken, encryptAccessToken} from '../lib/whatsapp-credentials';

describe('WhatsApp credential encryption', () => {
  const key = Buffer.alloc(32, 7).toString('base64');

  it('round-trips an access token with AES-256-GCM', () => {
    const encrypted = encryptAccessToken('EA-test-token', key);
    expect(encrypted.access_token_ciphertext).not.toContain('EA-test-token');
    expect(decryptAccessToken(encrypted, key)).toBe('EA-test-token');
  });

  it('uses a fresh IV for every encryption', () => {
    const first = encryptAccessToken('same-token', key);
    const second = encryptAccessToken('same-token', key);
    expect(first.access_token_iv).not.toBe(second.access_token_iv);
    expect(first.access_token_ciphertext).not.toBe(second.access_token_ciphertext);
  });

  it('rejects tampered ciphertext and invalid key sizes', () => {
    const encrypted = encryptAccessToken('EA-test-token', key);
    const tampered = {...encrypted, access_token_ciphertext: Buffer.from('tampered').toString('base64')};
    expect(() => decryptAccessToken(tampered, key)).toThrow();
    expect(() => encryptAccessToken('token', 'too-short')).toThrow('32 bytes');
  });
});
