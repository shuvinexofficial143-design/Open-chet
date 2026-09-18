import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

export type EncryptedAccessToken = {
  access_token_ciphertext: string;
  access_token_iv: string;
  access_token_tag: string;
};

function tokenKey(raw = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY) {
  if (!raw) throw new Error('WhatsApp token encryption is not configured');
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('WhatsApp token encryption key must contain exactly 32 bytes');
  return key;
}

export function encryptAccessToken(accessToken: string, rawKey?: string): EncryptedAccessToken {
  const token = accessToken.trim();
  if (!token) throw new Error('WhatsApp access token is required');
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, tokenKey(rawKey), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return {
    access_token_ciphertext: ciphertext.toString('base64'),
    access_token_iv: iv.toString('base64'),
    access_token_tag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptAccessToken(value: EncryptedAccessToken, rawKey?: string) {
  const decipher = createDecipheriv(
    ALGORITHM,
    tokenKey(rawKey),
    Buffer.from(value.access_token_iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(value.access_token_tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(value.access_token_ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
