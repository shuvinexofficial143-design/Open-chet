import {ingestInbound} from '@/services/inbound';
import {db,failure} from '@/lib/server';
import {statusAdvance} from '@/lib/domain';
import {resolveWebhookAccount,type RoutedWhatsAppAccount} from '@/services/whatsapp-routing';
import {verifySignature} from '@/services/whatsapp.service';
import {dispatchN8nDelivery,getN8nBridgeConfig,verifyWhatsAppWebhookToken} from '@/services/n8n.service';

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
      },true);

      if(!account){
        console.warn('Ignoring WhatsApp webhook for an unknown phone number');
        continue;
      }

      const org=account.organization_id;
      const bridge=await getN8nBridgeConfig(org);
      const bridgeEnabled=Boolean(bridge);

      // Disabling outbound/inbound routing must not discard late delivery receipts.
      for(const m of account.is_active?value.messages||[]:[]){
        const bridgeEvent=await db().begin(async sql=>{
          const [settings]=await sql`select settings from organizations where id=${org}`;
          const result=await ingestInbound(sql,account,m,value.contacts||[],bridgeEnabled?'ai':settings.settings.ai_enabled?'ai':'paused');
          if(result.duplicate)return Boolean(bridge);
          const {contact,conversation:conv,message,parsed,should_send_welcome:shouldSendWelcome}=result;
          const {phone,name,kind,content}=parsed;
          const rules=await sql`select * from automation_rules
            where organization_id=${org} and enabled=true
            order by created_at`;

          let replied=false;
          for(const rule of rules){
            const matches=rule.trigger==='new_contact'
              ?result.new_contact
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
                  ${sql.json({type:'text',text:{body:rule.value},expected_version:conv.version})}
                )`;
              replied=true;
            }
          }

          const [fresh]=await sql`select * from conversations where id=${conv.id} and organization_id=${org}`;

          if(fresh.mode==='ai'&&settings.settings.ai_enabled&&!bridgeEnabled&&!replied){
            await sql`insert into ai_sessions(organization_id,conversation_id,input_message_id,expected_version)
              values(${org},${conv.id},${message.id},${fresh.version})`;
          }

          const event=fresh.mode==='ai'
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
          if(event&&bridge){await sql`insert into n8n_deliveries(organization_id,conversation_id,meta_message_id,payload)
            values(${org},${conv.id},${m.id},${sql.json(event)}) on conflict(meta_message_id) do nothing`;return true;}
          return false;
        });

        if(bridgeEvent&&bridge)await dispatchN8nDelivery(m.id,org);
      }

      for(const s of value.statuses||[])await db().begin(async sql=>{
        await sql`select pg_advisory_xact_lock(hashtext(${s.id}))`;
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

        if(status==='failed'&&message.status!=='failed'){
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
