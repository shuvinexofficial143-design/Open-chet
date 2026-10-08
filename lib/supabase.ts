// Open Chet runs a server-verified owner session. No browser-side Supabase Auth
// session, phone identifier, or OTP provider is required for app requests.
export const configured=!!(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
export async function api(path:string,init:RequestInit={}){
  const response=await fetch(path,{...init,credentials:'same-origin',cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'Request failed');
  return data;
}
