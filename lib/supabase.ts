import {createClient} from '@supabase/supabase-js';
export const configured=!!(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
let client:ReturnType<typeof createClient>|null=null;
export function browserDB(){if(!configured)throw Error('Supabase is not configured');return client??=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)}
export async function api(path:string,init:RequestInit={}){const {data:{session}}=await browserDB().auth.getSession();if(!session)throw Error('Please sign in');const response=await fetch(path,{...init,headers:{'Authorization':`Bearer ${session.access_token}`,...init.headers}});const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return data}
