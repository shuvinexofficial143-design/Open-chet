import {createClient} from '@supabase/supabase-js';
import {body, failure, HttpError} from '@/lib/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// The phone belongs to the existing Open Chet Supabase owner account.
// Its password is verified by Supabase Auth, never stored in this repository.
export async function POST(req: Request) {
  try {
    const phone = process.env.OPEN_CHET_LOGIN_PHONE?.trim();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone) || !url || !key) {
      throw new HttpError(503, 'Password login is not configured. Contact the workspace administrator.');
    }
    const value = await body(req) as {password?: unknown};
    if (typeof value.password !== 'string' || value.password.length < 1 || value.password.length > 512) {
      throw new HttpError(400, 'Enter your password.');
    }
    const client = createClient(url, key, {auth: {persistSession: false, autoRefreshToken: false}});
    const {data, error} = await client.auth.signInWithPassword({phone, password: value.password});
    if (error || !data.session) {
      throw new HttpError(401, 'Incorrect password. Please try again.');
    }
    return Response.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    }, {headers: {'Cache-Control': 'no-store', 'Pragma': 'no-cache'}});
  } catch (error) {
    return failure(error);
  }
}
