import type {SupabaseClient} from '@supabase/supabase-js';

export const DEFAULT_COUNTRY_CODE = '+91';
export const OTP_RESEND_SECONDS = 60;

export const countries = [
  {code: '+91', label: 'India (+91)', digits: 10},
] as const;

export function normalizePhoneForOtp(input: string, countryCode = DEFAULT_COUNTRY_CODE) {
  const compact = input.trim().replace(/[\s().-]/g, '');
  const countryDigits = countryCode.replace(/\D/g, '');
  let local = compact.replace(/\D/g, '');

  if (compact.startsWith('+')) {
    if (!compact.startsWith(countryCode)) throw new Error('Choose the country code that matches this number.');
    local = compact.slice(countryCode.length).replace(/\D/g, '');
  } else if (local.startsWith(countryDigits) && local.length > 10) {
    local = local.slice(countryDigits.length);
  } else if (local.startsWith('0') && countryCode === '+91') {
    local = local.slice(1);
  }

  if (countryCode === '+91' && !/^[6-9]\d{9}$/.test(local)) {
    throw new Error('Enter a valid 10-digit Indian mobile number.');
  }

  const normalized = `${countryCode}${local}`;
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) throw new Error('Enter a valid mobile number.');
  return normalized;
}

export function formatPhoneForDisplay(phone: string) {
  if (/^\+91\d{10}$/.test(phone)) return `${phone.slice(0, 3)} ${phone.slice(3, 8)} ${phone.slice(8)}`;
  return phone;
}

export function validateOtp(input: string) {
  const token = input.replace(/\D/g, '').slice(0, 6);
  if (token.length !== 6) throw new Error('Enter the 6-digit verification code.');
  return token;
}

export function authErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || '');
  const message = raw.toLowerCase();
  if (message.includes('rate') || message.includes('too many') || message.includes('security purposes')) {
    return 'Too many attempts. Please wait a few minutes and try again.';
  }
  if (message.includes('expired')) return 'This verification code has expired. Request a new code.';
  if (message.includes('phone') && message.includes('invalid')) return 'Enter a valid mobile number.';
  if (message.includes('token') || message.includes('otp') || message.includes('invalid')) {
    return 'That verification code is invalid. Check the code and try again.';
  }
  if (message.includes('provider') || message.includes('sms') || message.includes('phone')) {
    return 'Phone verification is temporarily unavailable. Please try again later.';
  }
  return 'Something went wrong. Please try again.';
}

export async function requestPhoneOtp(client: SupabaseClient, phone: string) {
  const result = await client.auth.signInWithOtp({phone, options: {shouldCreateUser: true}});
  if (result.error) throw result.error;
  return result.data;
}

export async function verifyPhoneOtp(client: SupabaseClient, phone: string, token: string) {
  const result = await client.auth.verifyOtp({phone, token, type: 'sms'});
  if (result.error) throw result.error;
  if (!result.data.session) throw new Error('OTP verification did not create a session.');
  return result.data.session;
}

async function voiceOtpApi(payload: Record<string, string>) {
  const response = await fetch('/api/auth/voice-otp', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Voice verification failed. Please try again.');
  return data;
}

export async function requestVoiceOtp(phone: string) {
  return voiceOtpApi({action: 'start', phone});
}

export async function verifyVoiceOtp(client: SupabaseClient, phone: string, token: string) {
  const data = await voiceOtpApi({action: 'verify', phone, token});
  if (!data.access_token || !data.refresh_token) throw new Error('Voice verification did not create a session.');
  const result = await client.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  if (result.error) throw result.error;
  if (!result.data.session) throw new Error('Voice verification did not create a session.');
  return result.data.session;
}

export async function resendPhoneOtp(client: SupabaseClient, phone: string) {
  const result = await client.auth.resend({phone, type: 'sms'});
  if (result.error) throw result.error;
  return result.data;
}

export async function signOutPhoneSession(client: SupabaseClient) {
  const {error} = await client.auth.signOut();
  if (error) throw error;
}
