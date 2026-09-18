'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect, useState} from 'react';
import {ArrowRight, MessageSquare, ShieldCheck} from 'lucide-react';
import {
  authErrorMessage,
  countries,
  DEFAULT_COUNTRY_CODE,
  formatPhoneForDisplay,
  normalizePhoneForOtp,
  OTP_RESEND_SECONDS,
  requestPhoneOtp,
  resendPhoneOtp,
  validateOtp,
  verifyPhoneOtp,
} from '@/lib/phone-auth';
import {api, browserDB, configured} from '@/lib/supabase';

type Step = 'phone' | 'otp' | 'setup';

export default function Login() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [mobile, setMobile] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(configured);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!configured) return;
    let active = true;
    async function restoreSession() {
      try {
        const {data: {session}} = await browserDB().auth.getSession();
        if (!session || !active) return;
        try {
          await api('/api/bootstrap');
          router.replace('/');
        } catch (error) {
          if (active && error instanceof Error && error.message === 'Create your workspace first') setStep('setup');
          else throw error;
        }
      } catch {
        if (active) setMessage('We could not restore your session. Please sign in again.');
      } finally {
        if (active) setChecking(false);
      }
    }
    void restoreSession();
    return () => {active = false;};
  }, [router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function continueWithPhone(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    try {
      const normalized = normalizePhoneForOtp(mobile, countryCode);
      setBusy(true);
      await requestPhoneOtp(browserDB(), normalized);
      setPhone(normalized);
      setOtp('');
      setCooldown(OTP_RESEND_SECONDS);
      setStep('otp');
    } catch (error) {
      setMessage(error instanceof Error && (error.message.startsWith('Enter a valid') || error.message.startsWith('Choose the country')) ? error.message : authErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    try {
      const token = validateOtp(otp);
      setBusy(true);
      await verifyPhoneOtp(browserDB(), phone, token);
      try {
        await api('/api/bootstrap');
        router.replace('/');
      } catch (error) {
        if (error instanceof Error && error.message === 'Create your workspace first') setStep('setup');
        else throw error;
      }
    } catch (error) {
      setMessage(error instanceof Error && error.message.startsWith('Enter the 6-digit') ? error.message : authErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    if (busy || cooldown > 0) return;
    setBusy(true);
    setMessage('');
    try {
      await resendPhoneOtp(browserDB(), phone);
      setCooldown(OTP_RESEND_SECONDS);
      setMessage('A new verification code has been sent.');
    } catch (error) {
      setMessage(authErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function changeNumber() {
    setStep('phone');
    setOtp('');
    setPhone('');
    setCooldown(0);
    setMessage('');
  }

  async function createWorkspace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      await api('/api/bootstrap', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name: form.get('name'), business_name: form.get('business_name')}),
      });
      router.replace('/');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Workspace setup failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const title = step === 'phone' ? 'Enter your phone number' : step === 'otp' ? 'Verify your number' : 'Set up Open Chet';
  const copy = step === 'phone'
    ? 'We’ll send a verification code to this number.'
    : step === 'otp'
      ? formatPhoneForDisplay(phone)
      : 'Tell us what to call you and your business.';

  return <main className="login">
    <div className="login-card">
      <div className="brand"><span className="brand-icon"><MessageSquare/></span>Open <b>Chet</b></div>
      {checking ? <div className="login-loading" role="status">Checking your session…</div> : <>
        <h1>{title}</h1>
        <p className={step === 'otp' ? 'phone-display' : 'login-copy'}>{copy}</p>

        {step === 'phone' && <form onSubmit={continueWithPhone}>
          <label htmlFor="mobile">Mobile number</label>
          <div className="phone-fields">
            <select aria-label="Country code" value={countryCode} onChange={(event) => setCountryCode(event.target.value)}>
              {countries.map((country) => <option key={country.code} value={country.code}>{country.label}</option>)}
            </select>
            <input id="mobile" name="mobile" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="93293 54729" value={mobile} onChange={(event) => setMobile(event.target.value)} required/>
          </div>
          <button className="primary" disabled={busy || !configured}>{busy ? 'Sending code…' : 'Continue'}<ArrowRight size={18}/></button>
        </form>}

        {step === 'otp' && <form onSubmit={verifyCode}>
          <label htmlFor="otp">6-digit OTP</label>
          <input className="otp-input" id="otp" name="otp" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" placeholder="••••••" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} required/>
          <button className="primary" disabled={busy || otp.length !== 6}>{busy ? 'Verifying…' : 'Verify'}<ArrowRight size={18}/></button>
          <div className="otp-actions">
            <button type="button" className="link" disabled={busy || cooldown > 0} onClick={resendCode}>{cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}</button>
            <button type="button" className="link" disabled={busy} onClick={changeNumber}>Change number</button>
          </div>
        </form>}

        {step === 'setup' && <form onSubmit={createWorkspace}>
          <label htmlFor="name">Name<input id="name" name="name" autoComplete="name" maxLength={120} required placeholder="Your name"/></label>
          <label htmlFor="business_name">Business name<input id="business_name" name="business_name" autoComplete="organization" maxLength={120} required placeholder="Your business"/></label>
          <button className="primary" disabled={busy}>{busy ? 'Creating workspace…' : 'Continue'}<ArrowRight size={18}/></button>
        </form>}

        {!configured && <div className="notice auth-notice">Live phone sign-in needs the browser-safe Supabase URL and publishable key. You can still explore the demo workspace.</div>}
        <p className="auth-status" role="status" aria-live="polite">{message}</p>
        {step === 'phone' && <Link className="secondary" href="/?demo=1">Explore demo workspace</Link>}
      </>}
      <div className="login-footer"><ShieldCheck size={16}/> Your business. Your conversations.</div>
    </div>
  </main>;
}
