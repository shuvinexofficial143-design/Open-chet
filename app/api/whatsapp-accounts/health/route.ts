import {z} from 'zod';
import {canAdmin} from '@/lib/domain';
import {context,db,failure,HttpError} from '@/lib/server';
import {getWhatsAppHealth,type WhatsAppAccount} from '@/services/whatsapp.service';

export const dynamic='force-dynamic';

export async function GET(req:Request){
  try{
    const c=await context(req);
    if(!canAdmin(c.role))throw new HttpError(403,'Owner or admin access required');
    const accountId=z.string().uuid().parse(new URL(req.url).searchParams.get('id'));
    const [account]=await db()`select id,organization_id,phone_number_id,business_account_id,is_active,
      access_token_ciphertext,access_token_iv,access_token_tag
      from whatsapp_accounts
      where id=${accountId} and organization_id=${c.org}`;
    if(!account)throw new HttpError(404,'WhatsApp connection not found');

    const [latest]=await db()`select e.status,e.error_code,e.event_at
      from message_status_events e
      join messages m on m.organization_id=e.organization_id and m.meta_message_id=e.meta_message_id
      join conversations conv on conv.organization_id=m.organization_id and conv.id=m.conversation_id
      where conv.organization_id=${c.org} and conv.whatsapp_account_id=${accountId}
      order by e.event_at desc
      limit 1`;

    const health=await getWhatsAppHealth(account as WhatsAppAccount);
    return Response.json({...health,latest_delivery_event:latest||null},{headers:{'Cache-Control':'no-store'}});
  }catch(error){return failure(error)}
}
