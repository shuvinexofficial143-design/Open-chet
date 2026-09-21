import {z} from 'zod';
import {db,failure,HttpError} from '@/lib/server';
import {normalizePhone} from '@/lib/domain';
import {verifyN8nBridgeRequest} from '@/services/n8n.service';

const input=z.object({
  phone_number_id:z.string().trim().regex(/^\d{5,30}$/),
  customer_phone:z.string().transform(normalizePhone),
});

export async function POST(req:Request){
  try{
    const value=input.parse(await req.json());
    const sql=db();

    const [account]=await sql`select id,organization_id
      from whatsapp_accounts
      where phone_number_id=${value.phone_number_id} and is_active=true
      limit 1`;

    if(!account)return Response.json({allow_ai:false,reason:'whatsapp_account_not_found'});
    if(!await verifyN8nBridgeRequest(req,account.organization_id))throw new HttpError(401,'Invalid n8n bridge credentials');

    const [row]=await sql`
      select c.id,c.mode
      from contacts ct
      join conversations c
        on c.organization_id=${account.organization_id}
       and c.whatsapp_account_id=${account.id}
       and c.contact_id=ct.id
      where ct.organization_id=${account.organization_id}
        and ct.phone=${value.customer_phone}
      limit 1`;

    if(!row)return Response.json({allow_ai:false,reason:'conversation_not_found'});
    return Response.json({
      allow_ai:row.mode==='ai',
      conversation_id:row.id,
      mode:row.mode
    });
  }catch(error){
    return failure(error);
  }
}
