import {createHmac, timingSafeEqual} from 'node:crypto';

export const SESSION_COOKIE = 'open_chet_session';
const SESSION_LIFETIME = 7 * 24 * 60 * 60; // 7 days

function getSessionKey(): Buffer {
  const value = process.env.OPEN_CHET_SESSION_SECRET || '';
  const secret = Buffer.from(value, 'base64');
  if (secret.length < 32) throw new Error('Open Chet session key is not configured');
  return secret;
}

export function ownerId(): string {
  const id = process.env.OPEN_CHET_OWNER_USER_ID?.trim() || '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Open Chet owner is not configured');
  }
  return id;
}

export function configuredPassword(): string {
  const password = process.env.OPEN_CHET_ACCESS_PASSWORD || '';
  if (password.length < 16 || password.length > 512) {
    throw new Error('Open Chet access password is not configured');
  }
  return password;
}

export function matchesPassword(provided: string): boolean {
  const stored = configuredPassword();
  const a = createHmac('sha256', getSessionKey()).update(provided, 'utf8').digest();
  const b = createHmac('sha256', getSessionKey()).update(stored, 'utf8').digest();
  return timingSafeEqual(a, b);
}

function signature(payload: string): Buffer {
  return createHmac('sha256', getSessionKey()).update('open-chet-session-v1:').update(payload).digest();
}

function currentPasswordVersion(): string {
  return createHmac('sha256', getSessionKey())
    .update('open-chet-password-version-v1:')
    .update(configuredPassword())
    .digest('base64url').slice(0, 24);
}

export function issueSession(now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({
    user: ownerId(), exp: Math.floor(now / 1000) + SESSION_LIFETIME,
    version: currentPasswordVersion(),
  })).toString('base64url');
  return `${payload}.${signature(payload).toString('base64url')}`;
}

export function verifySession(token: string | undefined, now = Date.now()): string | null {
  if (!token || token.length > 2000) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, mac] = parts;
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]+$/.test(mac)) return null;
  const expected = signature(payload);
  const actual = Buffer.from(mac, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (value?.user !== ownerId() || value?.version !== currentPasswordVersion()) return null;
    if (!Number.isSafeInteger(value.exp) || value.exp <= Math.floor(now / 1000)) return null;
    return value.user;
  } catch { return null; }
}

export function cookieValue(req: Request): string | undefined {
  const header = req.headers.get('cookie') || '';
  const match = header.split(';').map(part => part.trim()).find(part => part.startsWith(`${SESSION_COOKIE}=`));
  return match?.slice(SESSION_COOKIE.length + 1);
}

export function cookieHeader(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_LIFETIME}${secure ? '; Secure' : ''}`;
}

export function clearCookieHeader(secure: boolean): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function assertSameOrigin(req: Request): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  const origin = req.headers.get('origin');
  const url = new URL(req.url);
  if (origin && origin !== url.origin) throw new Error('Cross-site request blocked');
}

export function secureCookie(req: Request): boolean {
  return new URL(req.url).protocol === 'https:';
}
