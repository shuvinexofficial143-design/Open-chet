import {body,context,db,failure,identity,HttpError} from '@/lib/server';
export const dynamic='force-dynamic';
export async function POST(req:Request){try{const user=await identity(req),v=await body(req);if(typeof v.name!=='string'||!v.name.trim()||v.name.length>120)throw new HttpError(400,'Name is required');if(typeof v.business_name!=='string'||!v.business_name.trim()||v.business_name.length>120)throw new HttpError(400,'Business name is required');const result=await db().begin(async sql=>{await sql`select pg_advisory_xact_lock(hashtext(${user.id}))`;const exists=await sql`select id from organization_members where user_id=${user.id}`;if(exists.length)throw new HttpError(409,'You already belong to a workspace');await sql`insert into users(id,name) values(${user.id},${v.name.trim()}) on conflict(id) do update set name=excluded.name`;const [org]=await sql`insert into organizations(name) values(${v.business_name.trim()}) returning id`;await sql`insert into organization_members(organization_id,user_id,role) values(${org.id},${user.id},'owner')`;return org});return Response.json(result)}catch(e){return failure(e)}}

export async function GET(req:Request){
  try{
    const c=await context(req),url=new URL(req.url);
    const limit=Math.min(500,Math.max(1,Number(url.searchParams.get('limit'))||100));
    const conversation=url.searchParams.get('conversation');
    const focus=url.searchParams.get('focus');
    const search=(url.searchParams.get('q')||'').trim().slice(0,120),pattern='%'+search+'%';
    const before=url.searchParams.get('before');
    const beforeId=url.searchParams.get('before_id');
    const threadBefore=url.searchParams.get('thread_before');
    const threadBeforeId=url.searchParams.get('thread_before_id');
    const contactsOffset=Math.max(0,Number(url.searchParams.get('contacts_offset'))||0);
    const result=await db().begin('isolation level repeatable read read only',async sql=>{
      const pageMessages=async(thread:string|null)=>{
        const rows=await sql`select m.*,cv.contact_id logical_thread_id,
          to_char(m.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_at,
          (select e.error_code from message_status_events e where e.organization_id=m.organization_id
            and e.meta_message_id=m.meta_message_id and e.status='failed' order by e.event_at desc limit 1) meta_error_code
          from messages m join conversations cv on cv.id=m.conversation_id and cv.organization_id=m.organization_id
          where m.organization_id=${c.org}
            and (${thread}::uuid is null or cv.contact_id=${thread}::uuid or cv.contact_id=(
              select contact_id from conversations where id=${thread}::uuid and organization_id=${c.org}))
            and (cv.cleared_at is null or m.created_at>cv.cleared_at)
            and (${before}::timestamptz is null or (m.created_at,m.id)<(
              ${before}::timestamptz,coalesce(${beforeId}::uuid,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
          order by m.created_at desc,m.id desc limit ${thread?51:limit*5}`;
        const has_more=Boolean(thread)&&rows.length>50;
        const messages=(thread?rows.slice(0,50):rows).reverse().map(m=>({...m,
          route_conversation_id:m.conversation_id,conversation_id:m.logical_thread_id}));
        return {messages,has_more};
      };
      if(conversation)return pageMessages(conversation);
      const [org]=await sql`select * from organizations where id=${c.org}`;
      const whatsappAccounts=await sql`select id,label,display_phone_number,verified_name,phone_number_id,business_account_id,is_active,is_default,created_at,updated_at from whatsapp_accounts where organization_id=${c.org} order by is_default desc,created_at,id`;
      const rows=await sql`select *,to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_at
        from customer_threads where organization_id=${c.org}
          and (${search}='' or exists(select 1 from contacts ct where ct.id=customer_threads.contact_id and ct.organization_id=${c.org}
            and concat_ws(' ',ct.name,ct.phone,ct.company,customer_threads.preview) ilike ${pattern}))
          and (${threadBefore}::timestamptz is null or (updated_at,id)<(${threadBefore}::timestamptz,${threadBeforeId}::uuid))
        order by updated_at desc,id desc limit ${limit+1}`;
      const conversations=rows.slice(0,limit),lastPageRow=conversations.at(-1);
      if(focus&&!conversations.some(v=>v.id===focus)){
        const focused=await sql`select * from customer_threads where organization_id=${c.org} and (id=${focus}::uuid or ${focus}::uuid=any(subthread_ids))`;
        for(const item of focused)if(!conversations.some(v=>v.id===item.id))conversations.push(item);
      }
      const ids=conversations.map(v=>v.contact_id);
      const contacts=await sql`select c.*,coalesce((select jsonb_agg(t.name order by t.name)
        from contact_tags ct join tags t on t.id=ct.tag_id and t.organization_id=ct.organization_id
        where ct.contact_id=c.id and ct.organization_id=c.organization_id),'[]') tags
        from contacts c where c.organization_id=${c.org} and (c.id=any(${ids}::uuid[]) or c.id in(
          select id from contacts where organization_id=${c.org} and (${search}='' or concat_ws(' ',name,phone,company) ilike ${pattern}) order by name,id limit ${limit} offset ${contactsOffset})) order by c.name,c.id`;
      const members=await sql`select u.id,u.name,m.role,m.status from organization_members m join users u on u.id=m.user_id where organization_id=${c.org}`;
      const notes=await sql`select n.*,n.conversation_id route_conversation_id,cv.contact_id logical_thread_id
        from notes n join conversations cv on cv.id=n.conversation_id and cv.organization_id=n.organization_id
        where n.organization_id=${c.org} and cv.contact_id=any(${ids}::uuid[])
          and (cv.cleared_at is null or n.created_at>cv.cleared_at) order by n.created_at,n.id`;
      const [templates,quick_replies,products,campaigns,campaign_recipients,automation_rules,audit_logs,notifications]=await Promise.all(
        ['templates','quick_replies','products','campaigns','campaign_recipients','automation_rules','audit_logs','notifications']
          .map(table=>sql`select * from ${sql(table)} where organization_id=${c.org} order by created_at desc,id desc limit ${limit}`));
      const [analytics]=await sql`select (select count(*) from messages where organization_id=${c.org} and direction='out') sent,
        (select count(*) from messages where organization_id=${c.org} and direction='in') received,
        (select count(*) from customer_threads where organization_id=${c.org}) conversations,
        (select count(*) from customer_threads where organization_id=${c.org} and mode='ai') ai,
        (select count(*) from customer_threads where organization_id=${c.org} and mode='human') human,
        (select count(*) from messages where organization_id=${c.org} and status in('delivered','read')) delivered,
        (select count(*) from messages where organization_id=${c.org} and status='read') read,
        (select count(*) from audit_logs where organization_id=${c.org} and body='Conversation changed to human') handovers`;
      const [contactCount]=await sql`select count(*)::integer total from contacts where organization_id=${c.org} and (${search}='' or concat_ws(' ',name,phone,company) ilike ${pattern})`;
      return {organization_id:c.org,user_id:c.user,role:c.role,contacts,conversations,
        ...(await pageMessages(null)),members,notes:notes.map(n=>({...n,conversation_id:n.logical_thread_id})),
        templates,quick_replies,products,campaigns,campaign_recipients,automation_rules,audit_logs,notifications,analytics,
        settings:{...org.settings,name:org.name},connection:{whatsapp:whatsappAccounts.some(a=>a.is_active),ai:!!process.env.AI_API_KEY,whatsapp_accounts:whatsappAccounts},
        has_more:rows.length>limit,contacts_has_more:contactsOffset+limit<contactCount.total,
        next_thread_cursor:rows.length>limit?{at:lastPageRow!.cursor_at,id:lastPageRow!.id}:null};
    });
    return Response.json(result,{headers:{'Cache-Control':'no-store'}});
  }catch(e){return failure(e)}
}
