import type {Conversation,Data,Message} from './types';

export function orderedMessages(messages:Message[]){
  return [...new Map(messages.map(m=>[m.id,m])).values()].sort((a,b)=>
    (a.cursor_at||a.created_at).localeCompare(b.cursor_at||b.created_at)||a.id.localeCompare(b.id));
}

// Upgrade saved demo/old-client snapshots to the database's customer-thread model.
// Production bootstrap already supplies this projection; never group by name.
export function customerThreadData(data:Data):Data{
  const groups=new Map<string,Conversation[]>(),aliases=new Map<string,string>();
  for(const c of data.conversations){
    const key=c.contact_id;
    groups.set(key,[...(groups.get(key)||[]),c]);aliases.set(c.id,key);
    for(const id of c.subthread_ids||[])aliases.set(id,key);
  }
  const conversations=[...groups].map(([id,rows])=>{
    if(rows.length===1&&rows[0].routes)return rows[0];
    const route=[...rows].sort((a,b)=>(b.last_inbound_at||'').localeCompare(a.last_inbound_at||'')||
      Number(Boolean(b.whatsapp_account_id))-Number(Boolean(a.whatsapp_account_id))||a.id.localeCompare(b.id))[0];
    const latest=[...rows].sort((a,b)=>b.updated_at.localeCompare(a.updated_at)||b.id.localeCompare(a.id))[0];
    return {...route,id,route_conversation_id:route.id,subthread_ids:rows.map(c=>c.id),routes:rows,
      unread:rows.reduce((n,c)=>n+c.unread,0),welcome_sent:rows.some(c=>c.welcome_sent),
      updated_at:latest.updated_at,preview:latest.preview};
  }).sort((a,b)=>b.updated_at.localeCompare(a.updated_at)||b.id.localeCompare(a.id));
  return {...data,conversations,messages:orderedMessages(data.messages.map(m=>({...m,
    route_conversation_id:m.route_conversation_id||m.conversation_id,
    conversation_id:aliases.get(m.conversation_id)||m.conversation_id}))),
    notes:data.notes.map(n=>({...n,conversation_id:aliases.get(n.conversation_id)||n.conversation_id}))};
}

export function selectedThread(data:Data,selected:string){
  return data.conversations.find(c=>c.id===selected||c.subthread_ids?.includes(selected))?.id||'';
}

// All callers share one request loop. An event during hydration invalidates that
// snapshot; it is refetched before applying, so slower responses cannot roll back UI.
export function createRefreshQueue<T>(load:()=>Promise<T>,apply:(value:T)=>void){
  let pending=false,running:Promise<T>|null=null;
  return ()=>{
    pending=true;
    if(!running)running=(async()=>{
      let result:T;
      do{pending=false;result=await load();}while(pending);
      apply(result);return result;
    })().finally(()=>{running=null;});
    return running;
  };
}
