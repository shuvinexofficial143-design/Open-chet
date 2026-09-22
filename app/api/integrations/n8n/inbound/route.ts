import {db,failure,HttpError} from '@/lib/server';
import {resolveWebhookAccount,type RoutedWhatsAppAccount} from '@/services/whatsapp-routing';
import {verifyN8nBridgeRequest} from '@/services/n8n.service';

export const runtime='nodejs';

function messageText(message:any){
  const kind=String(message?.type||'unsupported');
  if(kind==='text')return String(message?.text?.body||'');
  if(kind==='button')return String(message?.button?.text||message?.button?.payload||'');
  if(kind==='interactive')return String(
    message?.interactive?.button_reply?.title||
    message?.interactive?.button_reply?.id||
    message?.interactive?.list_reply?.title||
    message?.interactive?.list_reply?.id||
    ''
  );
  return String(message?.[kind]?.caption||message?.[kind]?.filename||`[${kind}]`);
}

export async function POST(req:Request){
  try{
    const payload:any=await req.json();
    const phoneNumberId=String(payload?.metadata?.phone_number_id||payload?.phone_number_id||'');

    const account=await resolveWebhookAccount(phoneNumberId,async id=>{
      const [row]=await db()`select id,organization_id,phone_number_id,business_account_id,is_active
        from whatsapp_accounts
        where phone_number_id=${id}`;
      return row?row as RoutedWhatsAppAccount:null;
    });

    if(!account)throw new HttpError(404,'WhatsApp connection not found');
    if(!await verifyN8nBridgeRequest(req,account.organization_id))throw new HttpError(401,'Invalid n8n bridge credentials');

    const messages=Array.isArray(payload?.messages)
      ?payload.messages
      :payload?.raw_message
        ?[payload.raw_message]
        :[];

    if(!messages.length)return Response.json({ok:true,stored:0});

    let stored=0;
    let duplicate=0;

    for(const m of messages){
      const metaId=String(m?.id||'').trim();
      const from=String(m?.from||'').replace(/^\+/,'').trim();
      if(!metaId||!/^\d{8,15}$/.test(from))continue;

      const result=await db().begin(async sql=>{
        await sql`select pg_advisory_xact_lock(hashtext(${metaId}))`;
        if((await sql`select id from messages where meta_message_id=${metaId}`).length)return 'duplicate';

        const org=account.organization_id;
        const phone=`+${from}`;
        const contactRow=Array.isArray(payload?.contacts)
          ?payload.contacts.find((item:any)=>String(item?.wa_id||'')===from)
          :null;
        const name=String(contactRow?.profile?.name||phone);

        const [contact]=await sql`insert into contacts(organization_id,name,phone,source)
          values(${org},${name},${phone},'whatsapp')
          on conflict(organization_id,phone)
          do update set name=case when excluded.name<>excluded.phone then excluded.name else contacts.name end,updated_at=now()
          returning *`;

        const [conversation]=await sql`insert into conversations(organization_id,whatsapp_account_id,contact_id,mode)
          values(${org},${account.id},${contact.id},'ai')
          on conflict(organization_id,whatsapp_account_id,contact_id) where whatsapp_account_id is not null
          do update set updated_at=now()
          returning *`;

        const timestamp=Number(m?.timestamp)
          ?new Date(Number(m.timestamp)*1000)
          :new Date();
        const kind=String(m?.type||'unsupported');
        const text=messageText(m);
        const mediaId=m?.[kind]?.id?String(m[kind].id):null;

        await sql`insert into messages(
            organization_id,conversation_id,direction,kind,body,status,sender_name,meta_message_id,media_id,created_at
          ) values(
            ${org},${conversation.id},'in',${kind},${text},'received',${name},${metaId},${mediaId},${timestamp}
          )`;

        await sql`update conversations
          set unread=unread+1,
              last_inbound_at=${timestamp},
              preview=${text},
              updated_at=greatest(updated_at,${timestamp}),
              version=version+1
          where id=${conversation.id} and organization_id=${org}`;

        await sql`insert into notifications(organization_id,conversation_id,body)
          values(${org},${conversation.id},${`New message from ${name}`})`;

        return 'stored';
      });

      if(result==='duplicate')duplicate++;
      else if(result==='stored')stored++;
    }

    return Response.json({ok:true,stored,duplicate});
  }catch(error){
    return failure(error);
  }
}
