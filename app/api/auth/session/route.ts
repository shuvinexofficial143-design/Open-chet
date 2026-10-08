import {clearCookieHeader, cookieValue, secureCookie, verifySession, assertSameOrigin} from '@/lib/password-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  let valid = false;
  try { valid = Boolean(verifySession(cookieValue(req))); } catch { /* fail closed */ }
  return Response.json({authenticated:valid},{status:valid?200:401,headers:{'Cache-Control':'no-store'}});
}

export async function DELETE(req: Request) {
  try { assertSameOrigin(req); } catch { return Response.json({error:'Unauthorized request'},{status:403}); }
  return new Response(JSON.stringify({ok:true}),{
    headers:{
      'Content-Type':'application/json',
      'Cache-Control':'no-store',
      'Set-Cookie':clearCookieHeader(secureCookie(req)),
    },
  });
}
