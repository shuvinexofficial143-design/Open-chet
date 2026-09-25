import postgres from 'postgres';
import {randomUUID,createHmac} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';

const state=vi.hoisted(()=>({sql:null as unknown as ReturnType<typeof postgres>,org:'10000000-0000-4000-8000-000000000001',user:'20000000-0000-4000-8000-000000000001'}));
vi.mock('../lib/server',async importOriginal=>({...await importOriginal<typeof import('../lib/server')>(),
  db:()=>state.sql,context:async()=>({org:state.org,user:state.user,name:'Test Owner',role:'owner'})}));
vi.mock('../services/worker',()=>({runOutboundMessage:vi.fn(),runWorker:vi.fn()}));
vi.mock('../services/whatsapp.service',async importOriginal=>({...await importOriginal<typeof import('../services/whatsapp.service')>(),sendWhatsApp:vi.fn()}));
vi.mock('../services/n8n.service',()=>({verifyN8nBridgeRequest:async(req:Request)=>req.headers.get('authorization')==='Bearer local-test',
  getN8nBridgeConfig:async()=>null,verifyWhatsAppWebhookToken:async()=>false,dispatchN8nDelivery:async()=>{}}));
import {POST as meta} from '../app/api/webhooks/whatsapp/route';
import {POST as inbound} from '../app/api/integrations/n8n/inbound/route';
import {POST as reply} from '../app/api/integrations/n8n/reply/route';
import {POST as action} from '../app/api/action/route';
import {GET as bootstrap} from '../app/api/bootstrap/route';
import {sendWhatsApp} from '../services/whatsapp.service';

const a='30000000-0000-4000-8000-000000000001',b='30000000-0000-4000-8000-000000000002';
const enabled=Boolean(process.env.TEST_POSTGRES_URL);
let admin:ReturnType<typeof postgres>,database:string;
const request=(value:unknown)=>new Request('http://localhost/api/test',{method:'POST',headers:{authorization:'Bearer local-test','Content-Type':'application/json'},body:JSON.stringify(value)});
const message=(id:string,phone='919000000001',stamp=String(Math.floor(Date.now()/1000)))=>({id,from:phone,type:'text',text:{body:id},timestamp:stamp});
const raw=(m:unknown,phone='100001')=>({metadata:{phone_number_id:phone},messages:[m]});
async function webhook(value:unknown){
  const data=JSON.stringify({object:'whatsapp_business_account',entry:[{id:'200001',changes:[{field:'messages',value}]}]});
  return meta(new Request('http://localhost/api/webhooks/whatsapp',{method:'POST',body:data,headers:{'x-hub-signature-256':'sha256='+createHmac('sha256','test-meta-secret').update(data).digest('hex')}}));
}
async function perform(type:string,id:string,values:Record<string,unknown>={}){return action(request({type,id,values}));}

describe.skipIf(!enabled)('Real PostgreSQL / production handlers (disposable local database)',()=>{
  beforeAll(async()=>{
    const url=new URL(process.env.TEST_POSTGRES_URL!);
    if(!['127.0.0.1','localhost'].includes(url.hostname))throw Error('Integration tests require a disposable LOCAL PostgreSQL server');
    admin=postgres(url.toString(),{ssl:false,max:2});database='open_chet_test_'+randomUUID().replaceAll('-','');
    await admin.unsafe(`create database ${database} encoding 'UTF8' template template0`);
    url.pathname='/'+database;state.sql=postgres(url.toString(),{ssl:false,max:20,prepare:false});
    await state.sql.unsafe(`do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;end $$;
      create schema auth;create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
      create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);`);
    for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await state.sql.unsafe(readFileSync('supabase/migrations/'+file,'utf8'));
    await state.sql.unsafe(`insert into auth.users(id) values('${state.user}');insert into users(id,name) values('${state.user}','Test');
      insert into organizations(id,name) values('${state.org}','Test');insert into organization_members(organization_id,user_id,role) values('${state.org}','${state.user}','owner');
      insert into whatsapp_accounts(id,organization_id,phone_number_id,business_account_id,is_active,access_token_ciphertext,access_token_iv,access_token_tag)
      values('${a}','${state.org}','100001','200001',true,'test','test','test'),('${b}','${state.org}','100002','200001',true,'test','test','test');`);
    process.env.META_APP_SECRET='test-meta-secret';
  });
  afterAll(async()=>{if(state.sql)await state.sql.end();if(admin){if(database?.startsWith('open_chet_test_'))await admin.unsafe(`drop database ${database}`);await admin.end();}delete process.env.META_APP_SECRET;});

  it('ingests ten concurrent Meta webhooks through independent database connections',async()=>{
    const responses=await Promise.all(Array.from({length:10},(_,i)=>webhook(raw(message('parallel-'+i)))));
    expect(responses.map(r=>r.status)).toEqual(Array(10).fill(200));
    const rows=await state.sql`select * from customer_threads`;expect(rows).toHaveLength(1);expect(rows[0].unread).toBe(10);
    expect(await state.sql`select id from messages`).toHaveLength(10);
  });
  it('races Meta and n8n delivery of the same event and stores exactly once',async()=>{
    const m=message('same-meta');const responses=await Promise.all([webhook(raw(m)),inbound(request(raw(m))),inbound(request(raw(m)))]);
    expect(responses.every(r=>r.status===200)).toBe(true);
    expect(await state.sql`select id from messages where meta_message_id='same-meta'`).toHaveLength(1);
    const [t]=await state.sql`select * from customer_threads`;expect(t.unread).toBe(11);
  });
  it('rejects invalid bridge authentication and never defaults an explicit wrong route',async()=>{
    expect((await inbound(new Request('http://localhost/api/test',{method:'POST',body:JSON.stringify(raw(message('unauthorized')))}))).status).toBe(401);
    expect((await inbound(request(raw(message('wrong-route'),'999999')))).status).toBe(404);
    expect(await state.sql`select id from messages where meta_message_id in('unauthorized','wrong-route')`).toHaveLength(0);
  });
  it('returns one bootstrap chat and history from both account subthreads',async()=>{
    await inbound(request(raw(message('second-account','919000000001',String(Math.floor(Date.now()/1000)+1)),'100002')));
    const response=await bootstrap(new Request('http://localhost/api/bootstrap'));expect(response.status).toBe(200);
    const d=await response.json();expect(d.conversations).toHaveLength(1);expect(d.conversations[0].routes).toHaveLength(2);
    expect(d.conversations[0].whatsapp_account_id).toBe(b);
    const history=await bootstrap(new Request('http://localhost/api/bootstrap?conversation='+d.conversations[0].id));
    const h=await history.json();expect(h.messages).toHaveLength(12);expect(new Set(h.messages.map((m:any)=>m.phone_number_id)).size).toBe(2);
    expect(new Set(h.messages.map((m:any)=>m.conversation_id))).toEqual(new Set([d.conversations[0].id]));
  });
  it('routes an explicit reply safely, marks every route read, and takes over all routes',async()=>{
    const [t]=await state.sql`select * from customer_threads`;
    const first=t.routes.find((r:any)=>r.whatsapp_account_id===a);
    const response=await perform('send',t.id,{kind:'text',body:'Reply from A',route_conversation_id:first.id,idempotency_key:randomUUID()});
    expect(response.status).toBe(200);
    const [m]=await state.sql`select * from messages where direction='out'`;expect(m.whatsapp_account_id).toBe(a);expect(m.phone_number_id).toBe('100001');
    expect((await state.sql`select mode from conversations`).every(r=>r.mode==='human')).toBe(true);
    await perform('read',t.id);expect((await state.sql`select unread from conversations`).every(r=>r.unread===0)).toBe(true);
    expect((await perform('send',t.id,{kind:'text',body:'Wrong',route_conversation_id:randomUUID(),idempotency_key:randomUUID()})).status).toBe(409);
  });
  it('syncs concurrent n8n replies once and reconciles a status received first',async()=>{
    await webhook({metadata:{phone_number_id:'100001'},statuses:[{id:'outbound-sync',status:'failed',timestamp:String(Math.floor(Date.now()/1000)),errors:[{code:131026}]}]});
    const payload={phone_number_id:'100001',customer_phone:'919000000001',body:'Already sent by n8n',meta_message_id:'outbound-sync'};
    const results=await Promise.all([reply(request(payload)),reply(request(payload))]);expect(results.every(r=>r.status===200)).toBe(true);
    const rows=await state.sql`select * from messages where meta_message_id='outbound-sync'`;expect(rows).toHaveLength(1);expect(rows[0].status).toBe('failed');
    await webhook({metadata:{phone_number_id:'100001'},statuses:[{id:'outbound-sync',status:'delivered',timestamp:String(Math.floor(Date.now()/1000)+1)}]});
    expect((await state.sql`select status from messages where meta_message_id='outbound-sync'`)[0].status).toBe('delivered');
  });
  it('commits sending before dispatch and reconciles a webhook racing the worker acknowledgement',async()=>{
    const [m]=await state.sql`select * from messages where status='queued' and direction='out' limit 1`;
    vi.mocked(sendWhatsApp).mockImplementationOnce(async(account)=>{
      expect(account.phone_number_id).toBe('100001');
      // Independent pool connection can see the committed marker during dispatch.
      expect((await state.sql`select status from messages where id=${m.id}`)[0].status).toBe('sending');
      await webhook({metadata:{phone_number_id:'100001'},statuses:[{id:'worker-ack',status:'read',timestamp:String(Math.floor(Date.now()/1000))}]});
      return {messages:[{id:'worker-ack'}]};
    });
    const worker=await vi.importActual<typeof import('../services/worker')>('../services/worker');
    expect(await worker.runOutboundMessage(m.id)).toEqual({processed:1});
    expect((await state.sql`select status from messages where id=${m.id}`)[0].status).toBe('read');
    expect(await worker.runOutboundMessage(m.id)).toEqual({processed:0});
    expect(sendWhatsApp).toHaveBeenCalledTimes(1);
  });
  it('paginates more than fifty messages sharing one exact timestamp without losses',async()=>{
    await Promise.all(Array.from({length:60},(_,i)=>inbound(request(raw(message('page-'+i,'919000000002','1790320800'))))));
    const [c]=await state.sql`select id from contacts where phone='+919000000002'`;
    const one=await (await bootstrap(new Request('http://localhost/api/bootstrap?conversation='+c.id))).json();
    expect(one.messages).toHaveLength(50);expect(one.has_more).toBe(true);const oldest=one.messages[0];
    const two=await (await bootstrap(new Request('http://localhost/api/bootstrap?conversation='+c.id+'&before='+encodeURIComponent(oldest.cursor_at)+'&before_id='+oldest.id))).json();
    expect(two.messages).toHaveLength(10);expect(two.has_more).toBe(false);
    expect(new Set([...one.messages,...two.messages].map((m:any)=>m.id)).size).toBe(60);
  });
  it('retains delivery receipts when the sending account is subsequently disabled',async()=>{
    await state.sql`update whatsapp_accounts set is_active=false where id=${a}`;
    try{
      expect((await webhook({metadata:{phone_number_id:'100001'},statuses:[{id:'outbound-sync',status:'read',timestamp:String(Math.floor(Date.now()/1000)+2)}]})).status).toBe(200);
      expect((await state.sql`select status from messages where meta_message_id='outbound-sync'`)[0].status).toBe('read');
      await webhook(raw(message('disabled-inbound')));
      expect(await state.sql`select id from messages where meta_message_id='disabled-inbound'`).toHaveLength(0);
    }finally{await state.sql`update whatsapp_accounts set is_active=true where id=${a}`;}
  });
  it('dispatches simultaneous claims with the production four-connection pool without starvation',async()=>{
    const original=state.sql;
    const url=new URL(process.env.TEST_POSTGRES_URL!);url.pathname='/'+database;
    const limited=postgres(url.toString(),{ssl:false,max:4,prepare:false});
    const [c]=await original`select id from conversations where whatsapp_account_id=${a} limit 1`;
    const rows=await original`insert into messages(organization_id,conversation_id,direction,body,payload)
      select ${state.org},${c.id},'out','Pool test','{"type":"text","text":{"body":"Pool test"}}'::jsonb from generate_series(1,4) returning id`;
    let sent=0;
    vi.mocked(sendWhatsApp).mockImplementation(async()=>({messages:[{id:'pool-ack-'+(++sent)}]}));
    state.sql=limited;
    try{
      const worker=await vi.importActual<typeof import('../services/worker')>('../services/worker');
      const results=await Promise.all(rows.flatMap(m=>[worker.runOutboundMessage(m.id),worker.runOutboundMessage(m.id)]));
      expect(results.reduce((n,r)=>n+r.processed,0)).toBe(4);expect(sent).toBe(4);
    }finally{state.sql=original;await limited.end();}
  },15000);
  it('clears all route history while retaining FK references, Meta IDs and welcome state',async()=>{
    const [t]=await state.sql`select * from customer_threads where contact_id=(select id from contacts where phone='+919000000001')`;
    await perform('note',t.id,{body:'Internal note'});
    await state.sql`insert into ai_sessions(organization_id,conversation_id,input_message_id,expected_version) select organization_id,conversation_id,id,0 from messages where meta_message_id='parallel-0'`;
    const before=await state.sql`select count(*)::integer n from messages`;
    const response=await perform('clear_chat',t.id);expect(response.status).toBe(200);
    expect(await state.sql`select count(*)::integer n from messages`).toEqual(before);
    expect((await state.sql`select welcome_sent from conversations where contact_id=${t.id}`).every(r=>r.welcome_sent)).toBe(true);
    const history=await (await bootstrap(new Request('http://localhost/api/bootstrap?conversation='+t.id))).json();
    expect(history.messages).toHaveLength(0);
  });
});
