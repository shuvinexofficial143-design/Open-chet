import {createHmac,timingSafeEqual} from 'node:crypto';
import {decryptAccessToken, type EncryptedAccessToken} from '@/lib/whatsapp-credentials';

export type WhatsAppAccount = EncryptedAccessToken & {
  id: string;
  organization_id: string;
  phone_number_id: string;
  business_account_id: string;
  is_active: boolean;
};

export const graphRoot=()=>`https://graph.facebook.com/${process.env.META_GRAPH_VERSION||'v23.0'}`;

async function metaWithToken(accessToken:string,path:string,init:RequestInit={}){
  const response=await fetch(`${graphRoot()}/${path}`,{...init,headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json',...init.headers},signal:AbortSignal.timeout(15000)});
  const data=await response.json();
  if(!response.ok)throw Error(`Meta request failed (${response.status}, code ${data.error?.code??'unknown'})`);
  return data;
}

export async function meta(account:WhatsAppAccount,path:string,init:RequestInit={}){
  return metaWithToken(decryptAccessToken(account),path,init);
}

async function inspectMeta(account:WhatsAppAccount,path:string){
  const response=await fetch(`${graphRoot()}/${path}`,{headers:{Authorization:`Bearer ${decryptAccessToken(account)}`},signal:AbortSignal.timeout(15000)});
  const payload=await response.json().catch(()=>({}));
  if(response.ok)return {ok:true,status:response.status,data:payload};
  return {ok:false,status:response.status,error:{
    code:payload.error?.code??null,
    subcode:payload.error?.error_subcode??null,
    type:payload.error?.type??null,
    message:String(payload.error?.message||'Meta request failed').slice(0,500),
  }};
}

export async function getWhatsAppHealth(account:WhatsAppAccount){
  const [waba,phone,wabaPhones,subscribedApps]=await Promise.all([
    inspectMeta(account,`${account.business_account_id}?fields=id,name,account_review_status,owner_business_info,health_status`),
    inspectMeta(account,`${account.phone_number_id}?fields=id,display_phone_number,verified_name,quality_rating`),
    inspectMeta(account,`${account.business_account_id}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating&limit=100`),
    inspectMeta(account,`${account.business_account_id}/subscribed_apps`),
  ]);
  return {
    checked_at:new Date().toISOString(),
    graph_version:process.env.META_GRAPH_VERSION||'v23.0',
    phone_number_id:account.phone_number_id,
    business_account_id:account.business_account_id,
    waba,
    phone,
    waba_phone_numbers:wabaPhones,
    subscribed_apps:subscribedApps,
  };
}

export async function sendWhatsApp(account:WhatsAppAccount,to:string,payload:Record<string,unknown>){
  if(!account.is_active)throw Error('WhatsApp connection is disabled');
  return meta(account,`${account.phone_number_id}/messages`,{method:'POST',body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:to.replace(/^\+/,''),...payload})});
}

export async function syncTemplates(account:WhatsAppAccount){
  const all:any[]=[];let after:string|undefined;
  do{const data=await meta(account,`${account.business_account_id}/message_templates?limit=100${after?`&after=${encodeURIComponent(after)}`:''}`);all.push(...data.data);after=data.paging?.next?data.paging.cursors.after:undefined;}while(after&&all.length<1000);
  return all;
}

export async function verifyWhatsAppConnection(accessToken:string,phoneNumberId:string,businessAccountId:string){
  const phone=await metaWithToken(accessToken,`${phoneNumberId}?fields=id,display_phone_number,verified_name`);
  const numbers=await metaWithToken(accessToken,`${businessAccountId}/phone_numbers?fields=id&limit=100`);
  if(phone.id!==phoneNumberId||!numbers.data?.some((item:{id?:string})=>item.id===phoneNumberId))throw Error('Phone Number ID is not available in this WhatsApp Business Account');
  return {display_phone_number:String(phone.display_phone_number||''),verified_name:String(phone.verified_name||'')};
}

export async function uploadWhatsAppMedia(account:WhatsAppAccount,file:File){
  const data=new FormData();data.set('messaging_product','whatsapp');data.set('type',file.type);data.set('file',file);
  const response=await fetch(`${graphRoot()}/${account.phone_number_id}/media`,{method:'POST',headers:{Authorization:`Bearer ${decryptAccessToken(account)}`},body:data,signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw Error('Meta upload failed');
  return response.json();
}

export async function downloadWhatsAppMedia(account:WhatsAppAccount,mediaId:string){
  const data=await meta(account,mediaId);
  const url=new URL(data.url);
  if(url.protocol!=='https:'||!['lookaside.fbsbx.com','lookaside.facebook.com'].includes(url.hostname))throw Error('Unexpected media host');
  const response=await fetch(url,{headers:{Authorization:`Bearer ${decryptAccessToken(account)}`},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('Meta media download failed');
  return response;
}

export function verifySignature(raw:string,signature:string|null,secret:string){if(!secret||!signature?.startsWith('sha256='))return false;const expected=createHmac('sha256',secret).update(raw).digest(),provided=Buffer.from(signature.slice(7),'hex');return provided.length===expected.length&&timingSafeEqual(provided,expected)}
