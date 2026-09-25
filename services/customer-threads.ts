import type postgres from 'postgres';
import {HttpError} from '@/lib/server';

// Accept old account-conversation URLs as well as stable contact/thread IDs.
export async function lockCustomerThread(sql:postgres.TransactionSql,org:string,id:string,selectedRoute?:string){
  const [contact]=await sql`select ct.id from contacts ct where ct.organization_id=${org}
    and (ct.id=${id} or ct.id=(select contact_id from conversations where id=${id} and organization_id=${org})) for update`;
  if(!contact)throw new HttpError(404,'Customer thread not found');
  const routes=await sql`select id from conversations where organization_id=${org} and contact_id=${contact.id} order by id`;
  if(!routes.length)throw new HttpError(404,'Customer thread not found');
  for(const route of routes)await sql`select pg_advisory_xact_lock(hashtext(${route.id}))`;
  const [thread]=await sql`select * from customer_threads where id=${contact.id} and organization_id=${org}`;
  const routeId=selectedRoute||thread.route_conversation_id;
  const [conversation]=await sql`select * from conversations where organization_id=${org}
    and contact_id=${contact.id} and id=${routeId} for update`;
  if(!conversation)throw new HttpError(409,'The selected WhatsApp route does not belong to this customer');
  return {conversation,ids:routes.map(r=>r.id) as string[],thread};
}
