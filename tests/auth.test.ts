import {existsSync, readFileSync} from 'node:fs';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createClient} from '@supabase/supabase-js';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {POST} from '../app/api/auth/password/route';
import {signOutSession} from '../lib/auth-session';

vi.mock('@supabase/supabase-js', () => ({createClient: vi.fn()}));

const loginSource = readFileSync(new URL('../app/login/page.tsx', import.meta.url), 'utf8');
const routeSource = readFileSync(new URL('../app/api/auth/password/route.ts', import.meta.url), 'utf8');
const workspaceSource = readFileSync(new URL('../components/workspace.tsx', import.meta.url), 'utf8');

function request(password: unknown) {
  return new Request('https://example.com/api/auth/password', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({password}),
  });
}

function mockAuthReply(reply: unknown) {
  const signInWithPassword = vi.fn().mockResolvedValue(reply);
  vi.mocked(createClient).mockReturnValue({
    auth: {signInWithPassword},
  } as unknown as ReturnType<typeof createClient>);
  return signInWithPassword;
}

beforeEach(() => {
  vi.stubEnv('OPEN_CHET_LOGIN_PHONE', '+919111111111');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'public-test-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('Password-only owner authentication', () => {
  it('shows one password field, without SMS or voice OTP controls', () => {
    expect(loginSource).toContain('name="password"');
    expect(loginSource).toContain("type={showPassword ? 'text' : 'password'}");
    expect(loginSource).not.toContain('name="mobile"');
    expect(loginSource).not.toContain('name="otp"');
    expect(loginSource).not.toContain('requestPhoneOtp');
    expect(loginSource).not.toContain('requestVoiceOtp');
    expect(loginSource).toContain("auth.setSession(");
  });

  it('keeps the owner phone only in the server-side environment', () => {
    expect(routeSource).toContain('process.env.OPEN_CHET_LOGIN_PHONE');
    expect(loginSource).not.toContain('OPEN_CHET_LOGIN_PHONE');
    expect(routeSource).toContain('signInWithPassword({phone, password: value.password})');
    expect(routeSource).not.toContain('process.env.OPEN_CHET_LOGIN_PASSWORD');
  });

  it('signs in the configured owner and returns a Supabase session', async () => {
    const signInWithPassword = mockAuthReply({
      data: {session: {access_token: 'access-token', refresh_token: 'refresh-token'}},
      error: null,
    });
    const response = await POST(request('strong unique password'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
    });
    expect(signInWithPassword).toHaveBeenCalledWith({
      phone: '+919111111111',
      password: 'strong unique password',
    });
  });

  it('rejects an incorrect password without returning tokens', async () => {
    mockAuthReply({data: {session: null}, error: new Error('Invalid credentials')});
    const response = await POST(request('wrong'));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({error: 'Incorrect password. Please try again.'});
  });

  it('rejects blank passwords', async () => {
    const response = await POST(request(''));
    expect(response.status).toBe(400);
    expect(vi.mocked(createClient)).not.toHaveBeenCalled();
  });

  it('fails closed without a configured owner identity', async () => {
    vi.stubEnv('OPEN_CHET_LOGIN_PHONE', '');
    const response = await POST(request('secret'));
    expect(response.status).toBe(503);
    expect(vi.mocked(createClient)).not.toHaveBeenCalled();
  });

  it('preserves first-login workspace setup and existing Supabase identity', () => {
    expect(loginSource).toContain("setStep('setup')");
    expect(loginSource).toContain("api('/api/bootstrap'");
    expect(workspaceSource).toContain('signOutSession(browserDB())');
    expect(workspaceSource).toContain("router.replace('/login')");
  });

  it('revokes the Supabase session on sign out', async () => {
    const signOut = vi.fn().mockResolvedValue({error: null});
    await signOutSession({auth: {signOut}} as unknown as SupabaseClient);
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('removes the old voice OTP HTTP endpoint', () => {
    expect(existsSync(new URL('../app/api/auth/voice-otp/route.ts', import.meta.url))).toBe(false);
  });
});
