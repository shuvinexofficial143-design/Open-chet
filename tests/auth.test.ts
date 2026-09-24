import {readFileSync} from 'node:fs';
import type {SupabaseClient} from '@supabase/supabase-js';
import {describe, expect, it, vi} from 'vitest';
import {
  authErrorMessage,
  DEFAULT_COUNTRY_CODE,
  countries,
  normalizePhoneForOtp,
  OTP_RESEND_SECONDS,
  requestPhoneOtp,
  requestVoiceOtp,
  resendPhoneOtp,
  signOutPhoneSession,
  validateOtp,
  verifyPhoneOtp,
  verifyVoiceOtp,
} from '../lib/phone-auth';

const loginSource = readFileSync(new URL('../app/login/page.tsx', import.meta.url), 'utf8');
const workspaceSource = readFileSync(new URL('../components/workspace.tsx', import.meta.url), 'utf8');
const voiceRouteSource = readFileSync(new URL('../app/api/auth/voice-otp/route.ts', import.meta.url), 'utf8');

function clientWith(auth: Record<string, unknown>) {
  return {auth} as unknown as SupabaseClient;
}

describe('Phone OTP authentication', () => {
  it('shows a phone number field on the login page', () => {
    expect(loginSource).toContain('name="mobile"');
    expect(loginSource).toContain('type="tel"');
  });

  it('removes email and password authentication fields', () => {
    expect(loginSource).not.toContain('type="email"');
    expect(loginSource).not.toContain('type="password"');
    expect(loginSource).not.toContain('signInWithPassword');
  });

  it('defaults to India +91', () => {
    expect(DEFAULT_COUNTRY_CODE).toBe('+91');
    expect(countries[0]).toMatchObject({code: '+91', label: 'India (+91)'});
  });

  it('normalizes Indian numbers to E.164', () => {
    expect(normalizePhoneForOtp('9329354729')).toBe('+919329354729');
    expect(normalizePhoneForOtp('+91 93293 54729')).toBe('+919329354729');
    expect(() => normalizePhoneForOtp('12345')).toThrow('valid 10-digit');
  });

  it('requests an OTP when Continue is submitted', async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({data: {messageId: 'test'}, error: null});
    await requestPhoneOtp(clientWith({signInWithOtp}), '+919329354729');
    expect(signInWithOtp).toHaveBeenCalledWith({phone: '+919329354729', options: {shouldCreateUser: true}});
  });

  it('provides the OTP verification screen', () => {
    expect(loginSource).toContain("step === 'otp'");
    expect(loginSource).toContain('Verify your number');
    expect(loginSource).toContain('6-digit OTP');
  });

  it('verifies a 6-digit SMS code', async () => {
    const session = {access_token: 'test'};
    const verifyOtp = vi.fn().mockResolvedValue({data: {session}, error: null});
    expect(validateOtp('123456')).toBe('123456');
    expect(() => validateOtp('12345')).toThrow('6-digit');
    await verifyPhoneOtp(clientWith({verifyOtp}), '+919329354729', '123456');
    expect(verifyOtp).toHaveBeenCalledWith({phone: '+919329354729', token: '123456', type: 'sms'});
  });

  it('offers a voice-call OTP fallback', async () => {
    expect(loginSource).toContain('Call me with OTP');
    expect(voiceRouteSource).toContain("Channel: 'call'");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ok: true}),
    });
    vi.stubGlobal('fetch', fetchMock);
    await requestVoiceOtp('+919329354729');
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/voice-otp', expect.objectContaining({method: 'POST'}));
    vi.unstubAllGlobals();
  });

  it('accepts a verified voice OTP session', async () => {
    const setSession = vi.fn().mockResolvedValue({data: {session: {access_token: 'voice'}}, error: null});
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({access_token: 'access', refresh_token: 'refresh'}),
    });
    vi.stubGlobal('fetch', fetchMock);
    const session = await verifyVoiceOtp(clientWith({setSession}), '+919329354729', '123456');
    expect(session).toMatchObject({access_token: 'voice'});
    expect(setSession).toHaveBeenCalledWith({access_token: 'access', refresh_token: 'refresh'});
    vi.unstubAllGlobals();
  });

  it('resends through Supabase after a cooldown', async () => {
    const resend = vi.fn().mockResolvedValue({data: {}, error: null});
    expect(OTP_RESEND_SECONDS).toBeGreaterThanOrEqual(30);
    expect(loginSource).toContain('disabled={busy || cooldown > 0}');
    await resendPhoneOtp(clientWith({resend}), '+919329354729');
    expect(resend).toHaveBeenCalledWith({phone: '+919329354729', type: 'sms'});
  });

  it('checks for an existing authenticated session before showing login', () => {
    expect(loginSource).toContain('auth.getSession()');
    expect(loginSource).toContain("router.replace('/')");
  });

  it('signs out of Supabase and returns to phone login', async () => {
    const signOut = vi.fn().mockResolvedValue({error: null});
    await signOutPhoneSession(clientWith({signOut}));
    expect(signOut).toHaveBeenCalledOnce();
    expect(workspaceSource).toContain("router.replace('/login')");
  });

  it('returns safe messages for common phone auth failures', () => {
    expect(authErrorMessage(new Error('Token has expired'))).toContain('expired');
    expect(authErrorMessage(new Error('Invalid phone number'))).toBe('Enter a valid mobile number.');
    expect(authErrorMessage(new Error('Too many requests'))).toContain('Too many attempts');
  });
});
