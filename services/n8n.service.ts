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

export function n8nConfigured() {
  return Boolean(process.env.N8N_INBOUND_WEBHOOK_URL && process.env.N8N_BRIDGE_SECRET);
}

export async function forwardInboundToN8n(payload:N8nInboundPayload) {
  const url=process.env.N8N_INBOUND_WEBHOOK_URL;
  const secret=process.env.N8N_BRIDGE_SECRET;
  if(!url||!secret)return false;

  const parsed=new URL(url);
  if(parsed.protocol!=='https:')throw new Error('N8N_INBOUND_WEBHOOK_URL must use HTTPS');

  const response=await fetch(parsed,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'Authorization':`Bearer ${secret}`,
      'X-Open-Chet-Source':'whatsapp',
    },
    body:JSON.stringify(payload),
    signal:AbortSignal.timeout(8000),
  });
  if(!response.ok)throw new Error(`n8n bridge returned HTTP ${response.status}`);
  return true;
}

export function verifyN8nBridgeRequest(req:Request) {
  const secret=process.env.N8N_BRIDGE_SECRET;
  if(!secret)return false;
  const provided=req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  return Boolean(provided&&provided===secret);
}
