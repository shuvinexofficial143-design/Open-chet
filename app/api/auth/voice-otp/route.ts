import {randomBytes} from 'node:crypto';
import {createClient, type User} from '@supabase/supabase-js';
import {adminDB,body,failure,HttpError} from '@/lib/server';
import {normalizePhoneForOtp,validateOtp} from '@/lib/phone-auth';

export const dynamic='force-dynamic';
export const runtime='nodejs';

function voiceConfig(){
  const account=process.env.TWILIO_ACCOUNT_SID;
  const token=process.env.TWILIO_AUTH_TOKEN;
  const service=process.env.TWILIO_VERIFY_SERVICE_SID;
  if(!account||!token||!service)throw new HttpError(503,'Voice OTP is not configured yet.');
  return {account,token,service};
}

async function twilioVerify(path:string,values:Record<string,string>){
  const {account,token,service}=voiceConfig();
  const response=await fetch(`https://verify.twilio.com/v2/Services/${encodeURIComponent(service)}${path}`,{
    method:'POST',
    headers:{
      Authorization:`Basic ${Buffer.from(`${account}:${token}`).toString('base64')}`,
      'Content-Type':'application/x-www-form-urlencoded',
    },
    body:new URLSearchParams(values),
    cache:'no-store',
  });
  const data=await response.json().catch(()=>({})) as {status?:string;message?:string};
  if(!response.ok)throw new HttpError(response.status>=500?502:400,data.message||'Voice verification provider rejected the request.');
  return data;
}

async function findUserByPhone(phone:string){
  const admin=adminDB();
  for(let page=1;page<=20;page++){
    const {data,error}=await admin.auth.admin.listUsers({page,perPage:200});
    if(error)throw new HttpError(500,'Could not prepare phone sign-in.');
    const found=data.users.find((user:User)=>user.phone===phone);
    if(found)return found;
    if(data.users.length<200)return null;
  }
  throw new HttpError(500,'Could not prepare phone sign-in.');
}

async function createVoiceSession(phone:string){
  const admin=adminDB();
  const password=randomBytes(48).toString('base64url');
  const existing=await findUserByPhone(phone);
  let userId=existing?.id;

  if(userId){
    const {error}=await admin.auth.admin.updateUserById(userId,{password,phone_confirm:true});
    if(error)throw new HttpError(500,'Could not prepare phone sign-in.');
  }else{
    const {data,error}=await admin.auth.admin.createUser({phone,password,phone_confirm:true});
    if(error||!data.user)throw new HttpError(500,'Could not prepare phone sign-in.');
    userId=data.user.id;
  }

  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key)throw new HttpError(503,'Supabase is not configured.');

  const auth=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await auth.auth.signInWithPassword({phone,password});
  if(error||!data.session)throw new HttpError(401,'Voice verification succeeded but sign-in could not be completed.');
  return data.session;
}

export async function POST(req:Request){
  try{
    const value=await body(req) as {action?:string;phone?:string;token?:string};
    const phone=normalizePhoneForOtp(String(value.phone||''));

    if(value.action==='start'){
      await twilioVerify('/Verifications',{To:phone,Channel:'call'});
      return Response.json({ok:true});
    }

    if(value.action==='verify'){
      const token=validateOtp(String(value.token||''));
      const check=await twilioVerify('/VerificationCheck',{To:phone,Code:token});
      if(check.status!=='approved')throw new HttpError(400,'That verification code is invalid. Check the code and try again.');
      const session=await createVoiceSession(phone);
      return Response.json({
        access_token:session.access_token,
        refresh_token:session.refresh_token,
      },{headers:{'Cache-Control':'no-store'}});
    }

    throw new HttpError(400,'Unsupported voice OTP action.');
  }catch(error){
    return failure(error);
  }
}
