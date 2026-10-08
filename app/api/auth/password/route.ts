import {createHash} from 'node:crypto';
import {body, db, failure, HttpError} from '@/lib/server';
import {assertSameOrigin, configuredPassword, cookieHeader, issueSession, matchesPassword, ownerId, secureCookie} from '@/lib/password-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function attemptKey(req: Request): string {
  const value = req.headers.get('x-vercel-forwarded-for') ||
    req.headers.get('x-forwarded-for')?.split(',')[0] ||
    'unknown-client';
  return createHash('sha256').update(value.slice(0, 200)).digest('hex');
}

async function blocked(key: string): Promise<boolean> {
  const [row] = await db()`select blocked_until from public.open_chet_login_attempts where attempt_key=${key}`;
  return Boolean(row?.blocked_until && new Date(row.blocked_until).getTime() > Date.now());
}

async function recordFailure(key: string): Promise<void> {
  await db()`insert into public.open_chet_login_attempts (attempt_key, failures, window_start, blocked_until)
    values (${key},1,now(),null)
    on conflict (attempt_key) do update set
      failures=case when open_chet_login_attempts.window_start < now()-interval '15 minutes'
        then 1 else open_chet_login_attempts.failures+1 end,
      window_start=case when open_chet_login_attempts.window_start < now()-interval '15 minutes'
        then now() else open_chet_login_attempts.window_start end,
      blocked_until=case when open_chet_login_attempts.window_start >= now()-interval '15 minutes'
        and open_chet_login_attempts.failures >= 4 then now()+interval '15 minutes'
        else null end,
      updated_at=now()`;
}

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    // Fail closed until the server-only password, owner ID and signing key are configured.
    try {
      configuredPassword();
      ownerId();
      issueSession();
    } catch {
      throw new HttpError(503, 'Access password is not set up yet. Add it to Open Chet environment settings.');
    }
    const value = await body(req) as {password?: unknown};
    if (typeof value.password !== 'string' || value.password.length < 1 || value.password.length > 512) {
      throw new HttpError(400, 'Enter your password.');
    }
    const key = attemptKey(req);
    if (await blocked(key)) {
      throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
    }
    if (!matchesPassword(value.password)) {
      await recordFailure(key);
      throw new HttpError(401, 'Incorrect password. Please try again.');
    }
    await db()`delete from public.open_chet_login_attempts where attempt_key=${key}`;
    return new Response(JSON.stringify({ok: true}),{
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Set-Cookie': cookieHeader(issueSession(), secureCookie(req)),
      },
    });
  } catch(error) {
    if (error instanceof Error && error.message === 'Cross-site request blocked') {
      return failure(new HttpError(403, 'Unauthorized request'));
    }
    return failure(error);
  }
}
