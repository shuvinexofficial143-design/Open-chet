import {timingSafeEqual} from 'node:crypto';
import {db} from '@/lib/server';

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
  if(envUrl&&envSecret){
    const parsed=new URL(envUrl);
    if(parsed.protocol!=='https:')throw new Error('N8N_INBOUND_WEBHOOK_URL must use HTTPS');
    return {url:parsed.toString(),secret:envSecret};
  }

  const [row]=await db()`select n8n_inbound_webhook_url,n8n_bridge_secret
    from integration_bridges
    where organization_id=${organizationId} and enabled=true
    limit 1`;
  if(!row)return null;

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

  const response=await fetch(bridge.url,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'Authorization':`Bearer ${bridge.secret}`,
      'X-Open-Chet-Source':'whatsapp',
    },
    body:JSON.stringify(payload),
    signal:AbortSignal.timeout(8000),
  });
  if(!response.ok)throw new Error(`n8n bridge returned HTTP ${response.status}`);
  return true;
}

export async function verifyN8nBridgeRequest(req:Request,organizationId:string) {
  const provided=req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if(!provided)return false;
  const bridge=await getN8nBridgeConfig(organizationId);
  return Boolean(bridge&&secretsEqual(provided,bridge.secret));
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
