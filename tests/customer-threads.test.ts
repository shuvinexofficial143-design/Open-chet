import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {parseInbound} from '../services/inbound';
import {customerThreadData,orderedMessages,selectedThread,createRefreshQueue} from '../lib/inbox-state';
import {demoData} from '../lib/demo';
import {statusAdvance} from '../lib/domain';

let db:PGlite;
const org='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const a='30000000-0000-4000-8000-000000000001',b='30000000-0000-4000-8000-000000000002';
const migration=readFileSync('supabase/migrations/20260925122622_customer_threads.sql','utf8');
async function ingest(phone:string,meta:string,account=a,stamp='2026-09-25T10:00:00Z',name=phone){
  const r=await db.query<{result:any}>(`select ingest_whatsapp_message($1::uuid,$2::uuid,$3,$4,$5,'text',$5,null,$6::timestamptz,'ai','{}') result`,[org,account,phone,name,meta,stamp]);
  return r.rows[0].result;
}
async function thread(phone:string){return (await db.query<any>(`select t.* from customer_threads t join contacts c on c.id=t.contact_id and c.organization_id=t.organization_id where c.phone=$1 and c.organization_id=$2`,[phone,org])).rows;}

beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);`);
  for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&!f.endsWith('customer_threads.sql')).sort())await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  await db.exec(`insert into organizations(id,name) values('${org}','Test'),('${other}','Other');
    insert into whatsapp_accounts(id,organization_id,phone_number_id,business_account_id,is_active) values
      ('${a}','${org}','100001','200001',true),('${b}','${org}','100002','200001',true);
    insert into contacts(organization_id,name,phone) values('${org}','Legacy','+919000009999');
    insert into conversations(organization_id,contact_id,welcome_sent) select organization_id,id,true from contacts where phone='+919000009999';
    insert into conversations(organization_id,contact_id,whatsapp_account_id) select organization_id,id,'${a}' from contacts where phone='+919000009999';
    insert into messages(organization_id,conversation_id,direction,body,meta_message_id)
      select organization_id,id,'in','Historical message','history-'||id from conversations;
    insert into notes(organization_id,conversation_id,body) select organization_id,id,'Keep note' from conversations;
    insert into ai_sessions(organization_id,conversation_id,input_message_id,expected_version)
      select organization_id,conversation_id,id,0 from messages;
    insert into audit_logs(organization_id,conversation_id,body) select organization_id,id,'Keep audit' from conversations;
    insert into conversation_assignments(organization_id,conversation_id) select organization_id,id from conversations;
    insert into notifications(organization_id,conversation_id,body) select organization_id,id,'Keep notification' from conversations;`);
  await db.exec(migration);
});
afterAll(async()=>db.close());

describe('Database customer threads and historical repair',()=>{
  it('reruns without deleting history or changing references, including legacy NULL routes',async()=>{
    const snapshots=async()=>Promise.all(['conversations','messages','notes','ai_sessions','audit_logs','notifications','conversation_assignments'].map(async t=>(await db.query(`select * from ${t} order by id`)).rows));
    const before=await snapshots();await db.exec(migration);expect(await snapshots()).toEqual(before);
    const rows=await thread('+919000009999');expect(rows).toHaveLength(1);expect(rows[0].routes).toHaveLength(2);expect(rows[0].welcome_sent).toBe(true);
    const routes=await db.query<any>('select whatsapp_account_id,phone_number_id from messages order by phone_number_id nulls last');
    expect(routes.rows).toEqual([{whatsapp_account_id:a,phone_number_id:'100001'},{whatsapp_account_id:null,phone_number_id:null}]);
  });
  it('appends ten sequential messages to one logical customer with ten unread',async()=>{
    for(let i=0;i<10;i++)await ingest('+919000000010','seq-'+i);
    const [t]=await thread('+919000000010');expect(t.unread).toBe(10);expect(t.routes).toHaveLength(1);
    expect((await db.query('select id from messages where conversation_id=$1',[t.route_conversation_id])).rows).toHaveLength(10);
  });
  it('accepts ten simultaneously submitted ingests without duplicate identities',async()=>{
    // PGlite serializes connections; this checks transaction/constraint behavior.
    // Multi-session lock contention is covered by the optional PostgreSQL runner.
    const results=await Promise.all(Array.from({length:10},(_,i)=>ingest('+919000000011','parallel-'+i)));
    expect(new Set(results.map(r=>r.contact.id)).size).toBe(1);
    expect(results.filter(r=>r.should_send_welcome)).toHaveLength(1);
    expect((await thread('+919000000011'))[0].unread).toBe(10);
  });
  it('deduplicates webhook replay and Meta + n8n ingestion without unread/notification increments',async()=>{
    const first=await ingest('+919000000012','both-paths');
    const again=await ingest('+919000000012','both-paths');expect(again.duplicate).toBe(true);
    expect((await thread('+919000000012'))[0].unread).toBe(1);
    expect((await db.query('select id from notifications where conversation_id=$1',[first.conversation.id])).rows).toHaveLength(1);
  });
  it('updates a WhatsApp profile name without changing contact or thread identity',async()=>{
    const first=await ingest('+919000000013','name-before');
    const second=await ingest('+919000000013','name-after',a,undefined,'Customer Name');
    expect(second.contact.id).toBe(first.contact.id);expect(second.contact.name).toBe('Customer Name');
    expect((await thread('+919000000013'))).toHaveLength(1);
  });
  it('groups both business accounts, preserves each message route and chooses latest inbound',async()=>{
    const first=await ingest('+919000000014','account-a');
    const second=await ingest('+919000000014','account-b',b,'2026-09-25T11:00:00Z');
    expect(second.should_send_welcome).toBe(false);
    const [t]=await thread('+919000000014');expect(t.routes).toHaveLength(2);expect(t.id).toBe(first.contact.id);
    expect(t.whatsapp_account_id).toBe(b);expect(t.unread).toBe(2);
    const messages=await db.query<any>(`select whatsapp_account_id,phone_number_id from messages where meta_message_id in('account-a','account-b') order by meta_message_id`);
    expect(messages.rows).toEqual([{whatsapp_account_id:a,phone_number_id:'100001'},{whatsapp_account_id:b,phone_number_id:'100002'}]);
    await db.exec(`update whatsapp_accounts set is_active=false where id='${b}'`);
    expect((await thread('+919000000014'))[0].whatsapp_account_id).toBe(b);
    await expect(ingest('+919000000014','disabled',b)).rejects.toThrow(/disabled/);
    await db.exec(`update whatsapp_accounts set is_active=true where id='${b}'`);
  });
  it('never merges similar phones or identical profile names',async()=>{
    const first=await ingest('+919000000015','similar-a',a,undefined,'Chetan Jatwa');
    const second=await ingest('+918000000015','similar-b',a,undefined,'Chetan Jatwa');
    expect(first.contact.id).not.toBe(second.contact.id);
    expect((await thread('+919000000015'))[0].id).not.toBe((await thread('+918000000015'))[0].id);
  });
  it('retains the newer preview and service window when an old n8n message arrives late',async()=>{
    await ingest('+919000000016','latest',a,'2026-09-25T12:00:00Z');
    await ingest('+919000000016','old',a,'2026-09-25T10:00:00Z');
    const [t]=await thread('+919000000016');expect(t.preview).toBe('latest');expect(new Date(t.last_inbound_at).toISOString()).toBe('2026-09-25T12:00:00.000Z');
    expect(t.unread).toBe(2);
  });
  it('keeps welcome and idempotency when clearing referenced history',async()=>{
    const result=await ingest('+919000000017','clear-before');
    await db.query(`update conversations set cleared_at='2026-09-25T10:30:00Z',unread=0,version=version+1 where id=$1`,[result.conversation.id]);
    const [t]=await thread('+919000000017');expect(t.preview).toBe('');expect(t.welcome_sent).toBe(true);
    expect((await ingest('+919000000017','clear-before')).duplicate).toBe(true);
    const next=await ingest('+919000000017','clear-after',b,'2026-09-25T11:00:00Z');expect(next.should_send_welcome).toBe(false);
    expect((await thread('+919000000017'))[0].preview).toBe('clear-after');
  });
  it('rejects cross-tenant routes and message identity collisions',async()=>{
    await expect(db.query(`select ingest_whatsapp_message($1,$2,'+919000000018','X','tenant','text','X',null,now(),'ai','{}')`,[other,a])).rejects.toThrow(/route/);
    await expect(ingest('+919000000019','both-paths')).rejects.toThrow(/identity/);
  });
  it('enforces route snapshots and does not grant the ingestion function to browser roles',async()=>{
    const [t]=await thread('+919000000010');
    await expect(db.query(`insert into messages(organization_id,conversation_id,direction,whatsapp_account_id) values($1,$2,'out',$3)`,[org,t.route_conversation_id,b])).rejects.toThrow(/route/);
    await db.exec('set role authenticated');
    expect((await db.query('select * from customer_threads')).rows).toHaveLength(0);
    await expect(ingest('+919000000020','browser-write')).rejects.toThrow(/permission denied/);
    await db.exec('reset role');
  });
});

describe('Ingestion parser and refresh consistency',()=>{
  it('normalizes raw Meta and bridge payloads identically and preserves unsupported media',()=>{
    const m={id:'x',from:'91 98765 43210',timestamp:'1790320800',type:'sticker',sticker:{id:'media'}};
    expect(parseInbound(m)).toMatchObject({phone:'+919876543210',kind:'sticker',content:'[sticker]',mediaId:'media'});
    expect(()=>parseInbound({...m,from:'0987654321'})).toThrow();
    expect(()=>parseInbound({...m,timestamp:'invalid'})).toThrow();
  });
  it('replays and refreshes the same logical list with full combined history and stable selection',()=>{
    const d=demoData(),first=d.conversations[0];
    d.conversations.push({...first,id:'another-route',whatsapp_account_id:'new',last_inbound_at:'2099-01-01T00:00:00Z'});
    d.messages.push({...d.messages[0],id:'new-message',conversation_id:'another-route'});
    const projected=customerThreadData(d),replayed=customerThreadData({...projected,messages:[...projected.messages,...projected.messages]});
    expect(replayed).toEqual(projected);expect(projected.conversations).toHaveLength(d.contacts.length);
    expect(projected.messages.filter(m=>m.conversation_id===first.contact_id)).toHaveLength(4);
    expect(selectedThread(projected,'another-route')).toBe(first.contact_id);
    expect(selectedThread(projected,'removed')).toBe('');
  });
  it('orders messages with equal timestamps by ID and drops replayed IDs',()=>{
    const m=demoData().messages[0];expect(orderedMessages([{...m,id:'b'},{...m,id:'a'},{...m,id:'b'}]).map(m=>m.id)).toEqual(['a','b']);
  });
  it('coalesces realtime bursts and never applies a snapshot invalidated during refresh',async()=>{
    let resolve!:(value:number)=>void,calls=0;const applied:number[]=[];
    const reload=createRefreshQueue(()=>{calls++;return calls===1?new Promise<number>(r=>{resolve=r;}):Promise.resolve(2);},value=>applied.push(value));
    const first=reload();const second=reload();resolve(1);await Promise.all([first,second]);
    expect(calls).toBe(2);expect(applied).toEqual([2]);
  });
  it('advances unknown failures and lets delivery evidence override out-of-order failures',()=>{
    expect(statusAdvance('unknown','failed')).toBe('failed');expect(statusAdvance('failed','sent')).toBe('failed');
    expect(statusAdvance('failed','delivered')).toBe('delivered');expect(statusAdvance('read','failed')).toBe('read');
  });
});
