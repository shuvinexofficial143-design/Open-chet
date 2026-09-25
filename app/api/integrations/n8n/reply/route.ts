import {z} from 'zod';
import {db,failure,HttpError} from '@/lib/server';
import {normalizePhone,statusAdvance} from '@/lib/domain';
import {verifyN8nBridgeRequest} from '@/services/n8n.service';

const input=z.object({
  phone_number_id:z.string().trim().regex(/^\d{5,30}$/),
  customer_phone:z.string().transform((value)=>normalizePhone(value.startsWith('+')?value:`+${value}`)),
  body:z.string().default(''),
  kind:z.enum(['text','audio','image','document','video','template','product','catalogue']).default('text'),
  page:z.coerce.number().int().min(1).optional(),
  products:z.array(z.any()).max(8).optional(),
  meta_message_id:z.string().trim().min(1).max(500).optional(),
  media_id:z.string().trim().max(500).optional(),
});

export async function POST(req:Request){
  try{
    const value=input.parse(await req.json());
    const sql=db();

    const [account]=await sql`select id,organization_id
      from whatsapp_accounts
      where phone_number_id=${value.phone_number_id} and is_active=true`;

    if(!account)throw new HttpError(404,'WhatsApp connection not found');
    if(!await verifyN8nBridgeRequest(req,account.organization_id))throw new HttpError(401,'Invalid n8n bridge credentials');

    const [contact]=await sql`select id
      from contacts
      where organization_id=${account.organization_id} and phone=${value.customer_phone}`;

    if(!contact)throw new HttpError(404,'Open Chet contact not found');

    const [conversation]=await sql`select id
      from conversations
      where organization_id=${account.organization_id}
        and whatsapp_account_id=${account.id}
        and contact_id=${contact.id}`;

    if(!conversation)throw new HttpError(404,'Open Chet conversation not found');

    if(value.meta_message_id){
      const existing=await sql`select id from messages where meta_message_id=${value.meta_message_id}`;
      if(existing.length)return Response.json({ok:true,duplicate:true});
    }

    let syncedStatus='sent';
    if(value.meta_message_id){
      const events=await sql`select status
        from message_status_events
        where organization_id=${account.organization_id}
          and meta_message_id=${value.meta_message_id}
        order by event_at`;
      syncedStatus=events.reduce((status,event)=>statusAdvance(status,event.status),'sent');
    }

    await sql.begin(async tx=>{
      await tx`insert into messages(
          organization_id,conversation_id,direction,kind,body,status,sender_name,meta_message_id,media_id,payload
        ) values(
          ${account.organization_id},${conversation.id},'out',${value.kind},${value.body},
          ${syncedStatus},'n8n AI',${value.meta_message_id||null},${value.media_id||null},
          ${tx.json({source:'n8n',page:value.page||null,products:value.products||[]})}
        )`;

      await tx`update conversations
        set preview=${value.body||`[${value.kind}]`},updated_at=now()
        where id=${conversation.id} and organization_id=${account.organization_id}`;
    });

    return Response.json({ok:true,status:syncedStatus});
  }catch(error){
    return failure(error);
  }
}
