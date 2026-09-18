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
    if(!verifyN8nBridgeRequest(req))throw new HttpError(401,'Invalid n8n bridge credentials');
    const value=input.parse(await req.json());
    const sql=db();
    const [row]=await sql`
      select c.id,c.mode
      from whatsapp_accounts wa
      join contacts ct on ct.organization_id=wa.organization_id and ct.phone=${value.customer_phone}
      join conversations c on c.organization_id=wa.organization_id and c.whatsapp_account_id=wa.id and c.contact_id=ct.id
      where wa.phone_number_id=${value.phone_number_id} and wa.is_active=true
      limit 1`;
    if(!row)return Response.json({allow_ai:false,reason:'conversation_not_found'});
    return Response.json({allow_ai:row.mode==='ai',conversation_id:row.id,mode:row.mode});
  }catch(error){return failure(error)}
}
