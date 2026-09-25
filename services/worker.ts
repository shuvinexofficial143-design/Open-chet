import {drainN8nDeliveries} from './n8n.service';
import {db} from '@/lib/server';
import {CompatibleProvider} from './ai.service';
import {sendWhatsApp,type WhatsAppAccount} from './whatsapp.service';
import {maySendAI,messagingOpen,templateText,statusAdvance} from '@/lib/domain';
export async function runWorker(){const sql=db();let processed=0;
await drainN8nDeliveries();
// Recover abandoned AI generation safely. Outbound sends of unknown outcome are NEVER auto-retried.
await sql`update ai_sessions set status='queued' where status='generating' and updated_at<now()-interval '10 minutes'`;
const jobs=await sql`update ai_sessions set status='generating',updated_at=now() where id in (select id from ai_sessions where status='queued' order by created_at for update skip locked limit 3) returning *`;
for(const job of jobs){try{const [org]=await sql`select settings from organizations where id=${job.organization_id}`,history=await sql`select direction,body from messages where organization_id=${job.organization_id} and conversation_id=${job.conversation_id} and created_at>coalesce((select cleared_at from conversations where id=${job.conversation_id} and organization_id=${job.organization_id}),'-infinity'::timestamptz) order by created_at desc,id desc limit 20`;const result=await new CompatibleProvider().reply(`Tone: ${org.settings.tone}. Business hours (information only): ${org.settings.business_hours} ${org.settings.timezone}. Blocked topics: ${org.settings.blocked_topics}. ${org.settings.instructions}`,history.reverse().map(m=>({role:m.direction==='in'?'user':'assistant',content:m.body})));
await sql.begin(async tx=>{await tx`select pg_advisory_xact_lock(hashtext(${job.conversation_id}))`;const [c]=await tx`select * from conversations where organization_id=${job.organization_id} and id=${job.conversation_id}`;const [activeJob]=await tx`select status,updated_at from ai_sessions where id=${job.id} for update`;if(activeJob?.status!=='generating'||activeJob.updated_at.getTime()!==job.updated_at.getTime())return;const [current]=await tx`select settings from organizations where id=${job.organization_id}`;if(!c||!maySendAI(c.mode,current.settings.ai_enabled,job.expected_version,c.version,c.last_inbound_at?.toISOString())){await tx`update ai_sessions set status='cancelled' where id=${job.id}`;return;}if(result.escalate||result.confidence<Number(current.settings.escalation_threshold||0.7)){await tx`update conversations set mode='paused',version=version+1 where organization_id=${job.organization_id} and id=${c.id}`;await tx`insert into notifications(organization_id,conversation_id,body) values(${job.organization_id},${c.id},'AI requested human assistance')`;await tx`update ai_sessions set status='escalated',confidence=${result.confidence} where id=${job.id}`;return;}await tx`insert into messages(organization_id,conversation_id,direction,body,sender_name,payload) values(${job.organization_id},${c.id},'out',${result.text},'Open Chet AI',${tx.json({type:'text',text:{body:result.text},expected_version:c.version})})`;await tx`update ai_sessions set status='completed',confidence=${result.confidence} where id=${job.id}`;});}catch{await sql`update ai_sessions set status='failed',error='AI provider unavailable or invalid output' where id=${job.id}`;await sql`insert into notifications(organization_id,conversation_id,body) values(${job.organization_id},${job.conversation_id},'AI could not reply. A teammate should respond.')`;}}
// Materialize campaigns once, transactionally; recipients must have recorded opt-in.
await sql.begin(async tx=>{const campaigns=await tx`select * from campaigns where status='scheduled' and scheduled_at<=now() order by scheduled_at for update skip locked limit 3`;for(const campaign of campaigns){const [t]=await tx`select * from templates where id=${campaign.template_id} and organization_id=${campaign.organization_id} and status='APPROVED'`;if(!t||t.components.some((x:any)=>!['BODY','FOOTER'].includes(x.type))){await tx`update campaigns set status='failed' where id=${campaign.id}`;continue;}const [account]=t.whatsapp_account_id?await tx`select id from whatsapp_accounts where id=${t.whatsapp_account_id} and organization_id=${campaign.organization_id} and is_active=true`:await tx`select id from whatsapp_accounts where organization_id=${campaign.organization_id} and is_active=true order by is_default desc,created_at limit 1`;if(!account){await tx`update campaigns set status='failed' where id=${campaign.id}`;continue;}const contacts=await tx`select * from contacts c where organization_id=${campaign.organization_id} and opted_in=true and (${campaign.tag}='' or exists(select 1 from contact_tags ct join tags t on t.id=ct.tag_id where ct.contact_id=c.id and t.name=${campaign.tag}))`;for(const contact of contacts){if(campaign.contact_ids.length&&!campaign.contact_ids.includes(contact.id))continue;const [conv]=await tx`insert into conversations(organization_id,whatsapp_account_id,contact_id) values(${campaign.organization_id},${account.id},${contact.id}) on conflict(organization_id,whatsapp_account_id,contact_id) where whatsapp_account_id is not null do update set contact_id=excluded.contact_id returning id`;const variables=campaign.variables.map((s:string)=>s.replaceAll('{name}',contact.name));const [m]=await tx`insert into messages(organization_id,conversation_id,direction,kind,body,sender_name,payload) values(${campaign.organization_id},${conv.id},'out','template',${templateText(t.body,variables)},'Campaign',${tx.json({type:'template',template:{name:t.name,language:{code:t.language},components:variables.length?[{type:'body',parameters:variables.map((text:string)=>({type:'text',text}))}]:[]}})}) returning id`;await tx`insert into campaign_recipients(organization_id,campaign_id,contact_id,message_id) values(${campaign.organization_id},${campaign.id},${contact.id},${m.id}) on conflict do nothing`;}
await tx`update campaigns set status='running' where id=${campaign.id}`;}});
const pending=await sql`select id,conversation_id,organization_id from messages where status='queued' and direction='out' order by created_at limit 10`;
for(const p of pending)processed+=(await runOutboundMessage(p.id)).processed;
await sql`update messages set status='unknown' where status='sending' and updated_at<now()-interval '5 minutes'`;
await sql`update campaigns c set status='completed' where status='running' and not exists(select 1 from campaign_recipients r where r.campaign_id=c.id and r.status in('queued','sending'))`;
return {processed};}


export async function runOutboundMessage(messageId:string){
  const sql=db();
  let processed=0;
  // Claim before opening a transaction: a second pool connection inside each
  // locked transaction deadlocks when all four production connections are busy.
  const [p]=await sql`update messages set status='sending',updated_at=now()
    where id=${messageId} and status='queued' and direction='out'
    returning id,conversation_id,organization_id`;
  if(!p)return {processed};

  await sql.begin(async tx=>{
    await tx`select pg_advisory_xact_lock(hashtext(${p.conversation_id}))`;
    const [m]=await tx`select * from messages where id=${p.id}`;
    if(!m||m.status!=='sending')return;

    const [c]=await tx`select c.*,ct.phone,ct.opted_in,
        wa.id wa_id,wa.phone_number_id wa_phone_number_id,
        wa.business_account_id wa_business_account_id,
        wa.access_token_ciphertext wa_access_token_ciphertext,
        wa.access_token_iv wa_access_token_iv,
        wa.access_token_tag wa_access_token_tag,
        wa.is_active wa_is_active
      from conversations c
      join contacts ct on ct.id=c.contact_id and ct.organization_id=c.organization_id
      left join whatsapp_accounts wa on wa.id=c.whatsapp_account_id and wa.organization_id=c.organization_id
      where c.id=${m.conversation_id} and c.organization_id=${m.organization_id}`;

    const [org]=await tx`select settings from organizations where id=${m.organization_id}`;
    let cancelled=!c?.wa_id||!c.wa_is_active||!c.wa_access_token_ciphertext;
    cancelled ||=Boolean(c?.cleared_at&&m.created_at<=c.cleared_at);

    if(m.sender_name==='Open Chet AI')
      cancelled ||=!maySendAI(c.mode,org.settings.ai_enabled,m.payload.expected_version,c.version,c.last_inbound_at?.toISOString());

    if(m.kind!=='template')
      cancelled ||=!messagingOpen(c.last_inbound_at?.toISOString());
    else{
      const [t]=await tx`select status from templates
        where organization_id=${m.organization_id}
          and name=${m.payload.template.name}
          and language=${m.payload.template.language.code}
          and (whatsapp_account_id=${c.wa_id} or whatsapp_account_id is null)`;
      cancelled ||=t?.status!=='APPROVED';
    }

    if(m.sender_name==='Campaign')cancelled ||=!c.opted_in;

    if(cancelled){
      await tx`update messages set status='cancelled' where id=${m.id}`;
      await tx`update campaign_recipients set status='cancelled' where message_id=${m.id}`;
      return;
    }

    try{
      const {expected_version:_version,...payload}=m.payload;
      void _version;
      const account:WhatsAppAccount={
        id:c.wa_id,
        organization_id:m.organization_id,
        phone_number_id:c.wa_phone_number_id,
        business_account_id:c.wa_business_account_id,
        access_token_ciphertext:c.wa_access_token_ciphertext,
        access_token_iv:c.wa_access_token_iv,
        access_token_tag:c.wa_access_token_tag,
        is_active:c.wa_is_active,
      };
      const result=await sendWhatsApp(account,c.phone,payload);
      const metaId=result.messages?.[0]?.id;
      if(!metaId)throw Error('Missing Meta acknowledgement');

      await tx`select pg_advisory_xact_lock(hashtext(${metaId}))`;
      const events=await tx`select status from message_status_events
        where organization_id=${m.organization_id}
          and meta_message_id=${metaId}
        order by event_at`;
      const status=events.reduce((s,e)=>statusAdvance(s,e.status),'sent');

      await tx`update messages
        set status=${status},meta_message_id=${metaId},updated_at=now()
        where id=${m.id}`;
      await tx`update campaign_recipients set status=${status} where message_id=${m.id}`;
      await tx`update conversations set preview=${m.body},updated_at=now() where id=${c.id}`;
      processed++;
    }catch{
      await tx`update messages set status='unknown',updated_at=now() where id=${m.id}`;
      await tx`update campaign_recipients set status='unknown' where message_id=${m.id}`;
      await tx`insert into notifications(organization_id,conversation_id,body)
        values(${m.organization_id},${c.id},'Message delivery is uncertain. Check Meta before sending again.')`;
    }
  });

  return {processed};
}
