import {z} from 'zod';
import {body,context,db,failure,HttpError} from '@/lib/server';
import {canAdmin} from '@/lib/domain';
import {encryptAccessToken} from '@/lib/whatsapp-credentials';
import {verifyWhatsAppConnection} from '@/services/whatsapp.service';

const id=z.string().uuid();
const identifier=z.string().trim().regex(/^\d{5,30}$/,'Use the numeric ID from Meta');
const label=z.string().trim().min(1).max(120);

export async function POST(req:Request){try{
  const c=await context(req);
  if(!canAdmin(c.role))throw new HttpError(403,'Owner or admin access required');
  const value=z.object({action:z.enum(['add','label','default','active']),id:id.optional(),label:label.optional(),phone_number_id:identifier.optional(),business_account_id:identifier.optional(),access_token:z.string().trim().min(20).max(10000).optional(),is_active:z.boolean().optional()}).parse(await body(req));
  if(value.action==='add'){
    const input=z.object({label,phone_number_id:identifier,business_account_id:identifier,access_token:z.string().trim().min(20).max(10000)}).parse(value);
    let metadata:{display_phone_number:string;verified_name:string};
    try{metadata=await verifyWhatsAppConnection(input.access_token,input.phone_number_id,input.business_account_id)}catch{throw new HttpError(400,'Meta could not verify this Phone Number ID, WABA, and access token combination')}
    const encrypted=encryptAccessToken(input.access_token);
    await db().begin(async sql=>{
      await sql`select pg_advisory_xact_lock(hashtext(${c.org}))`;
      const [count]=await sql`select count(*)::int count from whatsapp_accounts where organization_id=${c.org} and is_active=true`;
      await sql`insert into whatsapp_accounts(organization_id,label,phone_number_id,business_account_id,display_phone_number,verified_name,access_token_ciphertext,access_token_iv,access_token_tag,is_active,is_default) values(${c.org},${input.label},${input.phone_number_id},${input.business_account_id},${metadata.display_phone_number},${metadata.verified_name},${encrypted.access_token_ciphertext},${encrypted.access_token_iv},${encrypted.access_token_tag},true,${Number(count.count)===0})`;
    });
  }
  if(value.action==='label'){
    const accountId=id.parse(value.id),name=label.parse(value.label);
    const rows=await db()`update whatsapp_accounts set label=${name},updated_at=now() where id=${accountId} and organization_id=${c.org} returning id`;
    if(!rows.length)throw new HttpError(404,'WhatsApp connection not found');
  }
  if(value.action==='default'){
    const accountId=id.parse(value.id);
    await db().begin(async sql=>{await sql`select pg_advisory_xact_lock(hashtext(${c.org}))`;const account=await sql`select id from whatsapp_accounts where id=${accountId} and organization_id=${c.org} and is_active=true`;if(!account.length)throw new HttpError(404,'Active WhatsApp connection not found');await sql`update whatsapp_accounts set is_default=false,updated_at=now() where organization_id=${c.org} and is_default=true`;await sql`update whatsapp_accounts set is_default=true,updated_at=now() where id=${accountId} and organization_id=${c.org}`;});
  }
  if(value.action==='active'){
    const accountId=id.parse(value.id),active=z.boolean().parse(value.is_active);
    await db().begin(async sql=>{await sql`select pg_advisory_xact_lock(hashtext(${c.org}))`;const [account]=await sql`update whatsapp_accounts set is_active=${active},is_default=case when ${active}=false then false else is_default end,updated_at=now() where id=${accountId} and organization_id=${c.org} returning id`;if(!account)throw new HttpError(404,'WhatsApp connection not found');const [current]=await sql`select id from whatsapp_accounts where organization_id=${c.org} and is_active=true and is_default=true`;if(!current){const [fallback]=await sql`select id from whatsapp_accounts where organization_id=${c.org} and is_active=true order by created_at limit 1`;if(fallback)await sql`update whatsapp_accounts set is_default=true,updated_at=now() where id=${fallback.id}`;}});
  }
  return Response.json({ok:true});
}catch(error){return failure(error)}}
