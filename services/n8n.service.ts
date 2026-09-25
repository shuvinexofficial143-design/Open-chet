import {timingSafeEqual} from 'node:crypto';
import {db} from '@/lib/server';
import {decryptAccessToken} from '@/lib/whatsapp-credentials';

type N8nInboundPayload = {
  organization_id: string;
  whatsapp_account_id: string;
  phone_number_id: string;
  business_account_id?: string;
  conversation_id: string;
  contact_id: string;
  customer_phone: string;
  customer_name: string;
  message_id: string;
  message_type: string;
  text: string;
  media_id?: string | null;
  should_send_welcome?: boolean;
  raw_message: unknown;
};

export type N8nBridgeConfig = {
  url: string;
  secret: string;
};

function secretsEqual(a:string,b:string){
  const aa=Buffer.from(a);
  const bb=Buffer.from(b);
  return aa.length===bb.length&&timingSafeEqual(aa,bb);
}

export async function getN8nBridgeConfig(organizationId:string):Promise<N8nBridgeConfig|null>{
  const envUrl=process.env.N8N_INBOUND_WEBHOOK_URL;
  const envSecret=process.env.N8N_BRIDGE_SECRET;


  const [row]=await db()`select n8n_inbound_webhook_url,n8n_bridge_secret
    from integration_bridges
    where organization_id=${organizationId} and enabled=true
    limit 1`;
  if(!row){
    if(!envUrl||!envSecret)return null;
    const configuredOrg=process.env.N8N_ORGANIZATION_ID;
    const [scope]=await db()`select count(*)::integer total,bool_or(id=${organizationId}::uuid) matches from organizations`;
    if(configuredOrg?configuredOrg!==organizationId:scope.total!==1||!scope.matches)return null;
    const parsed=new URL(envUrl);
    if(parsed.protocol!=='https:')throw Error('N8N_INBOUND_WEBHOOK_URL must use HTTPS');
    return {url:parsed.toString(),secret:envSecret};
  }

  const parsed=new URL(String(row.n8n_inbound_webhook_url));
  if(parsed.protocol!=='https:')throw new Error('Stored n8n webhook URL must use HTTPS');
  return {url:parsed.toString(),secret:String(row.n8n_bridge_secret)};
}

export async function n8nConfigured(organizationId:string){
  return Boolean(await getN8nBridgeConfig(organizationId));
}

export async function forwardInboundToN8n(payload:N8nInboundPayload,config?:N8nBridgeConfig|null) {
  const bridge=config??await getN8nBridgeConfig(payload.organization_id);
  if(!bridge)return false;

  const waId=payload.customer_phone.replace(/^\+/,'');
  const compatiblePayload={
    messaging_product:'whatsapp',
    metadata:{phone_number_id:payload.phone_number_id},
    contacts:[{profile:{name:payload.customer_name},wa_id:waId}],
    messages:[payload.raw_message],
    open_chet:{
      organization_id:payload.organization_id,
      whatsapp_account_id:payload.whatsapp_account_id,
      conversation_id:payload.conversation_id,
      contact_id:payload.contact_id,
      message_id:payload.message_id,
      should_send_welcome:Boolean(payload.should_send_welcome),
    },
  };

  // One Open Chet workspace can own multiple WhatsApp numbers, while n8n Header Auth
  // accepts only one secret. Prefer the dedicated bridge secret, then gracefully
  // fall back to active account tokens (default first) for backwards compatibility.
  const authCandidates:string[]=[bridge.secret];
  try{
    const accounts=await db()`select
        id,is_default,access_token_ciphertext,access_token_iv,access_token_tag
      from whatsapp_accounts
      where organization_id=${payload.organization_id}
        and is_active=true
        and access_token_ciphertext is not null
        and access_token_iv is not null
        and access_token_tag is not null
      order by is_default desc,(id=${payload.whatsapp_account_id}) desc,created_at`;
    for(const account of accounts){
      try{
        const token=decryptAccessToken(account as any);
        if(!authCandidates.includes(token))authCandidates.push(token);
      }catch{}
    }
  }catch{}

  let lastStatus=0;
  for(const authSecret of authCandidates){
    const response=await fetch(bridge.url,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':`Bearer ${authSecret}`,
        'X-Open-Chet-Bridge-Secret':bridge.secret,
        'X-Open-Chet-Source':'whatsapp',
      },
      body:JSON.stringify(compatiblePayload),
      signal:AbortSignal.timeout(8000),
    });
    if(response.ok)return true;
    lastStatus=response.status;
    // Header-auth mismatch: try the next compatible secret without dropping the message.
    if(response.status===401||response.status===403)continue;
    throw new Error(`n8n bridge returned HTTP ${response.status}`);
  }

  throw new Error(`n8n bridge authentication failed (HTTP ${lastStatus||401})`);
}

export async function verifyN8nBridgeRequest(req:Request,organizationId:string) {
  const provided=req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if(!provided)return false;

  const bridge=await getN8nBridgeConfig(organizationId);
  if(bridge&&secretsEqual(provided,bridge.secret))return true;

  const accounts=await db()`select
      access_token_ciphertext,access_token_iv,access_token_tag
    from whatsapp_accounts
    where organization_id=${organizationId}
      and is_active=true
      and access_token_ciphertext is not null
      and access_token_iv is not null
      and access_token_tag is not null`;

  for(const account of accounts){
    try{
      const token=decryptAccessToken(account as any);
      if(secretsEqual(provided,token))return true;
    }catch{}
  }
  return false;
}

export async function verifyWhatsAppWebhookToken(provided:string|null){
  if(!provided)return false;
  const envToken=process.env.WHATSAPP_VERIFY_TOKEN;
  if(envToken&&secretsEqual(provided,envToken))return true;
  const [row]=await db()`select 1
    from integration_bridges
    where enabled=true and whatsapp_verify_token=${provided}
    limit 1`;
  return Boolean(row);
}

// Dispatch state is committed before the network call. Replayed webhooks and
// concurrent workers can only claim a pending row once.
export async function dispatchN8nDelivery(metaId:string,org:string){
  const [delivery]=await db()`update n8n_deliveries d set status='sending',updated_at=now()
    where d.meta_message_id=${metaId} and d.organization_id=${org} and d.status='pending'
    returning *`;
  if(!delivery)return;
  try{
    const [conversation]=await db()`select mode,cleared_at from conversations where id=${delivery.conversation_id} and organization_id=${org}`;
    if(conversation?.mode!=='ai'||conversation.cleared_at&&new Date(delivery.created_at)<=new Date(conversation.cleared_at)){
      await db()`update n8n_deliveries set status='cancelled',updated_at=now() where id=${delivery.id}`;return;
    }
    const delivered=await forwardInboundToN8n(delivery.payload as N8nInboundPayload);
    if(!delivered)throw Error('n8n bridge is no longer configured');
    await db()`update n8n_deliveries set status='delivered',updated_at=now() where id=${delivery.id}`;
  }catch{
    await db().begin(async sql=>{
      await sql`update n8n_deliveries set status='unknown',error='Bridge delivery not confirmed; inspect n8n execution before retrying',updated_at=now() where id=${delivery.id}`;
      await sql`insert into notifications(organization_id,conversation_id,body)
        values(${org},${delivery.conversation_id},'n8n reply delivery is unconfirmed. The incoming message is saved; inspect n8n before retrying.')`;
    });
  }
}

export async function drainN8nDeliveries(){
  const stale=await db()`update n8n_deliveries set status='unknown',error='Dispatcher interrupted; inspect n8n execution before retrying',updated_at=now()
    where status='sending' and updated_at<now()-interval '5 minutes' returning organization_id,conversation_id`;
  for(const item of stale)await db()`insert into notifications(organization_id,conversation_id,body)
    values(${item.organization_id},${item.conversation_id},'n8n delivery was interrupted. Inspect n8n before retrying.')`;
  const pending=await db()`select meta_message_id,organization_id from n8n_deliveries where status='pending' order by created_at limit 10`;
  for(const item of pending)await dispatchN8nDelivery(item.meta_message_id,item.organization_id);
}
