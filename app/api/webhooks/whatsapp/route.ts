import {db,failure} from '@/lib/server';
import {statusAdvance} from '@/lib/domain';
import {resolveWebhookAccount,type RoutedWhatsAppAccount} from '@/services/whatsapp-routing';
import {verifySignature} from '@/services/whatsapp.service';
import {forwardInboundToN8n,getN8nBridgeConfig,verifyWhatsAppWebhookToken} from '@/services/n8n.service';

export const runtime='nodejs';

export async function GET(req:Request){
  const p=new URL(req.url).searchParams;
  if(
    p.get('hub.mode')==='subscribe' &&
    await verifyWhatsAppWebhookToken(p.get('hub.verify_token'))
  ) return new Response(p.get('hub.challenge'));
  return new Response('Forbidden',{status:403});
}

export async function POST(req:Request){
  const raw=await req.text();
  if(raw.length>2_000_000)return new Response('Too large',{status:413});
  const metaSecrets=[
    process.env.META_APP_SECRET,
    process.env.META_APP_SECRET_SECONDARY,
  ].filter((secret):secret is string=>Boolean(secret));
  const signature=req.headers.get('x-hub-signature-256');
  if(!metaSecrets.some(secret=>verifySignature(raw,signature,secret)))return new Response('Invalid signature',{status:401});

  try{
    const payload=JSON.parse(raw);
    if(payload.object!=='whatsapp_business_account')return Response.json({ok:true});

    for(const entry of payload.entry||[])for(const change of entry.changes||[]){
      const value=change.value;

      if(change.field==='message_template_status_update'){
        await db()`update templates t
          set status=${value.event},updated_at=now()
          from whatsapp_accounts wa
          where t.whatsapp_account_id=wa.id
            and t.organization_id=wa.organization_id
            and wa.business_account_id=${String(entry.id)}
            and t.meta_id=${String(value.message_template_id)}`;
        continue;
      }

      const account=await resolveWebhookAccount(value.metadata?.phone_number_id,async phoneNumberId=>{
        const [row]=await db()`select id,organization_id,phone_number_id,business_account_id,is_active
          from whatsapp_accounts
          where phone_number_id=${phoneNumberId}`;
        return row?row as RoutedWhatsAppAccount:null;
      });

      if(!account){
        console.warn('Ignoring WhatsApp webhook for an unknown or disabled phone number');
        continue;
      }

      const org=account.organization_id;
      const bridge=await getN8nBridgeConfig(org);
      const bridgeEnabled=Boolean(bridge);

      for(const m of value.messages||[]){
        const bridgeEvent=await db().begin(async sql=>{
          await sql`select pg_advisory_xact_lock(hashtext(${m.id}))`;
          if((await sql`select id from messages where meta_message_id=${m.id}`).length)return;

          const phone=`+${m.from}`;
          const name=value.contacts?.find((item:any)=>item.wa_id===m.from)?.profile?.name||phone;
          const existing=await sql`select id from contacts where organization_id=${org} and phone=${phone}`;
          const [contact]=await sql`insert into contacts(organization_id,name,phone,source)
            values(${org},${name},${phone},'whatsapp')
            on conflict(organization_id,phone) do update set updated_at=now()
            returning *`;

          const [settings]=await sql`select settings from organizations where id=${org}`;
          const initialMode=bridgeEnabled?'ai':settings.settings.ai_enabled?'ai':'paused';

          const [conv]=await sql`insert into conversations(organization_id,whatsapp_account_id,contact_id,mode)
            values(${org},${account.id},${contact.id},${initialMode})
            on conflict(organization_id,whatsapp_account_id,contact_id) where whatsapp_account_id is not null
            do update set updated_at=now()
            returning *`;

          await sql`select pg_advisory_xact_lock(hashtext(${conv.id}))`;

          const shouldSendWelcome=!Boolean(conv.welcome_sent);
          if(shouldSendWelcome){
            await sql`update conversations
              set welcome_sent=true
              where id=${conv.id} and organization_id=${org}`;
          }

          const timestamp=new Date(Number(m.timestamp)*1000);
          const kind=m.type||'unsupported';
          const content=kind==='text'
            ?m.text?.body
            :kind==='button'
              ?m.button?.text
              :kind==='interactive'
                ?(m.interactive?.button_reply?.title||m.interactive?.list_reply?.title)
                :m[kind]?.caption||m[kind]?.filename||`[${kind}]`;

          const [message]=await sql`insert into messages(
              organization_id,conversation_id,direction,kind,body,status,sender_name,meta_message_id,media_id,created_at
            ) values(
              ${org},${conv.id},'in',${kind},${content||''},'received',${name},${m.id},${m[kind]?.id||null},${timestamp}
            ) returning id`;

          await sql`update conversations
            set unread=unread+1,
                last_inbound_at=greatest(last_inbound_at,${timestamp}),
                preview=case when last_inbound_at is null or last_inbound_at<=${timestamp} then ${content||''} else preview end,
                updated_at=greatest(updated_at,${timestamp}),
                version=version+1
            where id=${conv.id} and organization_id=${org}`;

          await sql`update ai_sessions
            set status='cancelled'
            where organization_id=${org} and conversation_id=${conv.id} and status in('queued','generating')`;

          await sql`update messages
            set status='cancelled'
            where organization_id=${org} and conversation_id=${conv.id}
              and sender_name='Open Chet AI' and status='queued'`;

          const rules=await sql`select * from automation_rules
            where organization_id=${org} and enabled=true
            order by created_at`;

          let replied=false;
          for(const rule of rules){
            const matches=rule.trigger==='new_contact'
              ?!existing.length
              :rule.trigger==='keyword'
                ?String(content).toLowerCase().includes(rule.match.toLowerCase())
                :(await sql`select 1
                    from contact_tags ct
                    join tags t on t.id=ct.tag_id
                    where ct.contact_id=${contact.id}
                      and t.name=${rule.match}
                      and ct.organization_id=${org}`).length>0;

            if(!matches)continue;

            if(rule.action==='pause')await sql`update conversations set mode='paused',version=version+1 where id=${conv.id} and organization_id=${org}`;

            if(rule.action==='tag'){
              const [tag]=await sql`insert into tags(organization_id,name)
                values(${org},${rule.value})
                on conflict(organization_id,name) do update set name=excluded.name
                returning id`;
              await sql`insert into contact_tags(organization_id,contact_id,tag_id)
                values(${org},${contact.id},${tag.id})
                on conflict do nothing`;
            }

            if(
              rule.action==='assign' &&
              /^[0-9a-f-]{36}$/i.test(rule.value) &&
              (await sql`select 1 from organization_members where organization_id=${org} and user_id=${rule.value}`).length
            ) await sql`update conversations set assigned_to=${rule.value} where id=${conv.id} and organization_id=${org}`;

            if(rule.action==='reply'&&conv.mode==='ai'&&settings.settings.ai_enabled&&!bridgeEnabled&&!replied){
              await sql`insert into messages(organization_id,conversation_id,direction,body,sender_name,payload)
                values(
                  ${org},${conv.id},'out',${rule.value},'Open Chet AI',
                  ${sql.json({type:'text',text:{body:rule.value},expected_version:conv.version+1})}
                )`;
              replied=true;
            }
          }

          const [fresh]=await sql`select * from conversations where id=${conv.id} and organization_id=${org}`;

          if(fresh.mode==='ai'&&settings.settings.ai_enabled&&!bridgeEnabled&&!replied){
            await sql`insert into ai_sessions(organization_id,conversation_id,input_message_id,expected_version)
              values(${org},${conv.id},${message.id},${fresh.version})`;
          }

          await sql`insert into notifications(organization_id,conversation_id,body)
            values(${org},${conv.id},${`New message from ${name}`})`;

          return fresh.mode==='ai'
            ?{
                organization_id:org,
                whatsapp_account_id:account.id,
                phone_number_id:account.phone_number_id,
                business_account_id:(account as any).business_account_id,
                conversation_id:conv.id,
                contact_id:contact.id,
                customer_phone:phone,
                customer_name:name,
                message_id:m.id,
                message_type:kind,
                text:String(content||''),
                media_id:m[kind]?.id||null,
                should_send_welcome:shouldSendWelcome,
                raw_message:m
              }
            :null;
        });

        if(bridgeEvent&&bridge){
          try{
            const delivered=await forwardInboundToN8n(bridgeEvent,bridge);
            if(delivered&&bridgeEvent.should_send_welcome){
              await db()`update conversations
                set welcome_sent=true,updated_at=now()
                where id=${bridgeEvent.conversation_id}
                  and organization_id=${bridgeEvent.organization_id}`;
            }
          }catch(error){
            console.warn('n8n bridge delivery failed',error instanceof Error?error.message:'unknown');
          }
        }
      }

      for(const s of value.statuses||[])await db().begin(async sql=>{
        const errorCode=s.errors?.[0]?.code?.toString()||null;
        // Meta can deliver a status webhook milliseconds before n8n syncs the outbound
        // message into Open Chet. Store the event first so that race is never lost.
        await sql`insert into message_status_events(organization_id,meta_message_id,status,event_at,error_code)
          values(
            ${org},${s.id},${s.status},
            ${new Date(Number(s.timestamp)*1000)},
            ${errorCode}
          )
          on conflict do nothing`;

        const [message]=await sql`select id,status,organization_id
          from messages
          where meta_message_id=${s.id} and organization_id=${org}
          for update`;
        if(!message)return;

        const status=statusAdvance(message.status,s.status);
        await sql`update messages
          set status=${status},updated_at=now()
          where id=${message.id} and organization_id=${message.organization_id}`;

        await sql`update campaign_recipients
          set status=${status}
          where message_id=${message.id} and organization_id=${message.organization_id}`;

        if(status==='failed'){
          await sql`insert into notifications(organization_id,body)
            values(${message.organization_id},${errorCode?`A WhatsApp message failed (Meta ${errorCode}). Open the inbox to review.`:'A WhatsApp message failed. Open the inbox to review.'})`;
        }
      });
    }

    return Response.json({ok:true});
  }catch(error){
    return failure(error);
  }
}
