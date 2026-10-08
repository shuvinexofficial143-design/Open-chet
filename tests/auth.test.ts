import {readFileSync} from 'node:fs';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {assertSameOrigin, configuredPassword, cookieHeader, cookieValue, issueSession, matchesPassword, ownerId, verifySession} from '../lib/password-session';

const loginSource = readFileSync(new URL('../app/login/page.tsx', import.meta.url), 'utf8');
const backendSource = readFileSync(new URL('../lib/server.ts', import.meta.url), 'utf8');
const passwordRouteSource = readFileSync(new URL('../app/api/auth/password/route.ts', import.meta.url), 'utf8');
const workspaceSource = readFileSync(new URL('../components/workspace.tsx', import.meta.url), 'utf8');

const secret = Buffer.alloc(32, 123).toString('base64');
const password = 'correct horse battery staple 123';

beforeEach(() => {
  vi.stubEnv('OPEN_CHET_SESSION_SECRET', secret);
  vi.stubEnv('OPEN_CHET_ACCESS_PASSWORD', password);
  vi.stubEnv('OPEN_CHET_OWNER_USER_ID', '20052a44-6201-44e9-b094-26ff637297cb');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('Standalone owner password authentication', () => {
  it('asks for only the password, without phone, SMS, OTP or Supabase login', () => {
    expect(loginSource).toContain('name="password"');
    expect(loginSource).not.toContain('name="mobile"');
    expect(loginSource).not.toContain('name="otp"');
    expect(loginSource).not.toContain('browserDB().auth');
    expect(passwordRouteSource).not.toContain('signInWithPassword');
    expect(passwordRouteSource).not.toContain('OPEN_CHET_LOGIN_PHONE');
    expect(passwordRouteSource).toContain('recordFailure');
    expect(passwordRouteSource).toContain('cookieHeader');
  });

  it('binds valid sessions to the existing owner and rejects changes/tampering', () => {
    const now = 1791472000000;
    const token = issueSession(now);
    expect(ownerId()).toBe('20052a44-6201-44e9-b094-26ff637297cb');
    expect(verifySession(token, now)).toBe(ownerId());
    expect(verifySession(token+'bad', now)).toBeNull();
    expect(verifySession(token, now + 8*86400000)).toBeNull();
    vi.stubEnv('OPEN_CHET_ACCESS_PASSWORD', 'a different strong password here');
    expect(verifySession(token, now)).toBeNull();
  });

  it('validates password and fails closed when configuration is missing', () => {
    expect(matchesPassword(password)).toBe(true);
    expect(matchesPassword('incorrect')).toBe(false);
    vi.stubEnv('OPEN_CHET_ACCESS_PASSWORD', '');
    expect(() => configuredPassword()).toThrow('not configured');
    vi.stubEnv('OPEN_CHET_ACCESS_PASSWORD', password);
    vi.stubEnv('OPEN_CHET_SESSION_SECRET', '');
    expect(() => issueSession()).toThrow('not configured');
  });

  it('issues HttpOnly SameSite cookie that is not accessible to scripts', () => {
    const token = issueSession();
    const cookie = cookieHeader(token, true);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Secure');
    expect(cookieValue(new Request('https://example.com/', {headers:{cookie}}))).toBe(token);
  });

  it('blocks cross-site state-changing requests', () => {
    expect(() => assertSameOrigin(new Request('https://example.com/api/action', {method:'POST',headers:{origin:'https://attacker.test'}}))).toThrow('Cross-site');
    expect(() => assertSameOrigin(new Request('https://example.com/api/action', {method:'POST',headers:{origin:'https://example.com'}}))).not.toThrow();
  });

  it('authenticates APIs using the owner cookie, not Supabase phone JWT', () => {
    expect(backendSource).toContain('verifySession(cookieValue(req))');
    expect(backendSource).not.toContain('auth.auth.getUser');
    expect(workspaceSource).toContain("api('/api/auth/session',{method:'DELETE'})");
    expect(workspaceSource).toContain("credentials: 'same-origin'");
  });
});
