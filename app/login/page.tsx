'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect, useState} from 'react';
import {ArrowRight, Eye, EyeOff, MessageSquare, ShieldCheck} from 'lucide-react';
import {api, browserDB, configured} from '@/lib/supabase';

type Step = 'password' | 'setup';

export default function Login() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('password');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/auth/password', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        cache: 'no-store',
        body: JSON.stringify({password}),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Sign in failed. Please try again.');
      if (!result.access_token || !result.refresh_token) throw new Error('Could not start your session.');
      const {error} = await browserDB().auth.setSession({
        access_token: result.access_token,
        refresh_token: result.refresh_token,
      });
      if (error) throw error;
      setPassword('');
      try {
        await api('/api/bootstrap');
        router.replace('/');
      } catch (error) {
        if (error instanceof Error && error.message === 'Create your workspace first') setStep('setup');
        else throw error;
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sign in failed. Please try again.');
    } finally {
      setBusy(false);
    }
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

  return <main className="login">
    <div className="login-card">
      <div className="brand"><span className="brand-icon"><MessageSquare/></span>Open <b>Chet</b></div>
      {checking ? <div className="login-loading" role="status">Checking your session…</div> : <>
        <h1>{step === 'password' ? 'Welcome back' : 'Set up Open Chet'}</h1>
        <p className="login-copy">{step === 'password'
          ? 'Enter your password to open your business inbox. No OTP is required.'
          : 'Tell us what to call you and your business.'}</p>

        {step === 'password' && <form onSubmit={signIn}>
          <label htmlFor="password">Password</label>
          <div className="password-field">
            <input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password"
              placeholder="Enter your password" value={password} maxLength={512}
              onChange={(event) => setPassword(event.target.value)} required/>
            <button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword((current) => !current)}>
              {showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}
            </button>
          </div>
          <button className="primary" disabled={busy || !configured || !password}>
            {busy ? 'Signing in…' : 'Sign in'}<ArrowRight size={18}/>
          </button>
        </form>}

        {step === 'setup' && <form onSubmit={createWorkspace}>
          <label htmlFor="name">Name<input id="name" name="name" autoComplete="name" maxLength={120} required placeholder="Your name"/></label>
          <label htmlFor="business_name">Business name<input id="business_name" name="business_name" autoComplete="organization" maxLength={120} required placeholder="Your business"/></label>
          <button className="primary" disabled={busy}>{busy ? 'Creating workspace…' : 'Continue'}<ArrowRight size={18}/></button>
        </form>}

        {!configured && <div className="notice auth-notice">Supabase is not configured. Add the public Supabase URL and publishable key to enable sign-in.</div>}
        <p className="auth-status" role="status" aria-live="polite">{message}</p>
        {!configured && <Link className="secondary" href="/?demo=1">Explore demo workspace</Link>}
      </>}
      <div className="login-footer"><ShieldCheck size={16}/> Your business. Your conversations.</div>
    </div>
  </main>;
}
