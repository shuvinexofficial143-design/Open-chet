'use client';

import {useRouter} from 'next/navigation';
import {useEffect, useState} from 'react';
import {ArrowRight, Eye, EyeOff, MessageSquare, ShieldCheck} from 'lucide-react';
import {api, configured} from '@/lib/supabase';

export default function Login() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    api('/api/auth/session')
      .then(() => api('/api/bootstrap'))
      .then(() => {if (active) router.replace('/');})
      .catch(() => { /* Not signed in; show password form */ })
      .finally(() => {if (active) setChecking(false);});
    return () => {active = false;};
  }, [router]);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await api('/api/auth/password', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({password}),
      });
      setPassword('');
      await api('/api/bootstrap');
      router.replace('/');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sign in failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="login">
    <div className="login-card">
      <div className="brand"><span className="brand-icon"><MessageSquare/></span>Open <b>Chet</b></div>
      {checking ? <div className="login-loading" role="status">Checking your session…</div> : <>
        <h1>Welcome back</h1>
        <p className="login-copy">Enter your private password to open the inbox. No phone number or OTP needed.</p>
        <form onSubmit={signIn}>
          <label htmlFor="password">Password</label>
          <div className="password-field">
            <input id="password" name="password" type={showPassword ? 'text' : 'password'}
              autoComplete="current-password" placeholder="Enter your password"
              value={password} maxLength={512}
              onChange={event => setPassword(event.target.value)} required/>
            <button type="button" className="password-toggle"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword(current => !current)}>
              {showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}
            </button>
          </div>
          <button className="primary" disabled={busy || !password}>
            {busy ? 'Signing in…' : 'Sign in'}<ArrowRight size={18}/>
          </button>
        </form>
        {!configured && <div className="notice auth-notice">Live database settings are incomplete. Contact the administrator.</div>}
        <p className="auth-status" role="status" aria-live="polite">{message}</p>
      </>}
      <div className="login-footer"><ShieldCheck size={16}/> Your business. Your conversations.</div>
    </div>
  </main>;
}
