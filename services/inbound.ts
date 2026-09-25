import type postgres from 'postgres';
import {normalizePhone} from '@/lib/domain';
import {HttpError} from '@/lib/server';

export function parseInbound(message:any,contacts:any[]=[]){
  const metaId=String(message?.id||'').trim();
  if(!metaId||metaId.length>500)throw new HttpError(400,'A Meta message ID is required');
  let phone:string;
  try{const from=String(message?.from||'').trim();phone=normalizePhone(from.startsWith('+')?from:`+${from}`);}
  catch{throw new HttpError(400,'Invalid WhatsApp customer phone');}
  const stamp=Number(message?.timestamp);
  if(!Number.isFinite(stamp)||stamp<=0||!Number.isFinite(new Date(stamp*1000).getTime()))
    throw new HttpError(400,'Invalid WhatsApp message timestamp');
  const kind=String(message?.type||'unsupported');
  const content=kind==='text'?message.text?.body:kind==='button'?(message.button?.text||message.button?.payload):
    kind==='interactive'?(message.interactive?.button_reply?.title||message.interactive?.button_reply?.id||
      message.interactive?.list_reply?.title||message.interactive?.list_reply?.id):
    message[kind]?.caption||message[kind]?.filename||`[${kind}]`;
  const profile=contacts.find(item=>String(item?.wa_id||'').replace(/^\+/,'')===phone.slice(1));
  return {metaId,phone,name:String(profile?.profile?.name||phone),kind,content:String(content||''),
    mediaId:message[kind]?.id?String(message[kind].id):null,timestamp:new Date(stamp*1000)};
}

export async function ingestInbound(sql:postgres.TransactionSql,account:{id:string;organization_id:string},
  message:any,contacts:any[],mode:string){
  const m=parseInbound(message,contacts);
  const [row]=await sql`select public.ingest_whatsapp_message(
    ${account.organization_id}::uuid,${account.id}::uuid,${m.phone},${m.name},${m.metaId},${m.kind},
    ${m.content},${m.mediaId},${m.timestamp},${mode},${sql.json(message)}) result`;
  return {...row.result,parsed:m};
}
