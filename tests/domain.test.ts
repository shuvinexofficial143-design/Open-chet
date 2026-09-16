import {describe,it,expect} from 'vitest';
import {messagingOpen,maySendAI,normalizePhone,statusAdvance,canAdmin,canManage,templateText} from '../lib/domain';
import {demoData,demoAction} from '../lib/demo';
import {verifySignature} from '../services/whatsapp.service';
import {createHmac} from 'node:crypto';
describe('Messaging guardrails',()=>{
it('enforces exact 24-hour boundary and rejects future timestamps',()=>{const now=Date.now();expect(messagingOpen(new Date(now-86400000).toISOString(),now)).toBe(false);expect(messagingOpen(new Date(now-86399999).toISOString(),now)).toBe(true);expect(messagingOpen(new Date(now+1000).toISOString(),now)).toBe(false);expect(messagingOpen(null)).toBe(false)});
it('invalidates AI output after takeover or a new incoming message',()=>{const last=new Date().toISOString();expect(maySendAI('ai',true,3,3,last)).toBe(true);expect(maySendAI('human',true,3,4,last)).toBe(false);expect(maySendAI('ai',true,3,4,last)).toBe(false);expect(maySendAI('ai',false,3,3,last)).toBe(false);expect(maySendAI('paused',true,3,3,last)).toBe(false)});
it('never regresses delivery receipts',()=>{expect(statusAdvance('read','sent')).toBe('read');expect(statusAdvance('delivered','failed')).toBe('delivered');expect(statusAdvance('sent','failed')).toBe('failed');expect(statusAdvance('unknown','read')).toBe('read')});
it('validates international phone numbers',()=>{expect(normalizePhone('+91 98765 43210')).toBe('+919876543210');expect(()=>normalizePhone('9876543210')).toThrow();expect(()=>normalizePhone('+00012345678')).toThrow()});
it('does not grant agent or manager administrator access',()=>{expect(canManage('agent')).toBe(false);expect(canManage('manager')).toBe(true);expect(canAdmin('manager')).toBe(false);expect(canAdmin('owner')).toBe(true)});
it('requires a valid signature over the exact request bytes',()=>{const raw='{"a":1}',secret='test-secret',sig='sha256='+createHmac('sha256',secret).update(raw).digest('hex');expect(verifySignature(raw,sig,secret)).toBe(true);expect(verifySignature(raw+' ',sig,secret)).toBe(false);expect(verifySignature(raw,null,secret)).toBe(false);expect(verifySignature(raw,'sha256=xx',secret)).toBe(false);expect(verifySignature(raw,sig,'')).toBe(false)});
it('replaces repeated numbered variables safely',()=>expect(templateText('Hello {{1}}, {{1}} order {{2}}',['A','12'])).toBe('Hello A, A order 12'));
});
describe('Working demo flows',()=>{
it('keeps notes private and messages explicitly simulated',()=>{let d=demoData();const count=d.messages.length;d=demoAction(d,{type:'note',id:'v0',values:{body:'Internal only'}});expect(d.messages).toHaveLength(count);d=demoAction(d,{type:'send',id:'v0',values:{body:'Hello',kind:'text'}});expect(d.messages.at(-1)?.status).toBe('demo');expect(d.conversations[0].mode).toBe('human');expect(d.messages.some(m=>m.body==='Internal only')).toBe(false)});
it('takeover and resume increment the version',()=>{let d=demoData();d=demoAction(d,{type:'mode',id:'v0',values:{mode:'human'}});d=demoAction(d,{type:'mode',id:'v0',values:{mode:'ai'}});expect(d.conversations[0].version).toBe(2);expect(d.conversations[0].mode).toBe('ai')});
it('blocks freeform messages outside the service window',()=>expect(()=>demoAction(demoData(),{type:'send',id:'v4',values:{body:'Hello',kind:'text'}})).toThrow('window'));
it('rejects duplicate contacts and stores custom fields',()=>{let d=demoData();expect(()=>demoAction(d,{type:'contact',values:{name:'Duplicate',phone:d.contacts[0].phone}})).toThrow('already');d=demoAction(d,{type:'contact',values:{name:'New contact',phone:'+919876543210',custom_fields:{city:'Tarana'}}});expect(d.contacts.at(-1)?.custom_fields.city).toBe('Tarana')});
it('campaign simulation excludes contacts without consent',()=>{let d=demoData();d=demoAction(d,{type:'campaign',values:{name:'Test',template_id:'t1',tag:'',variables:['{name}']}});d=demoAction(d,{type:'campaign_start',id:d.campaigns[0].id});expect(d.campaign_recipients).toHaveLength(d.contacts.filter(c=>c.opted_in).length);expect(d.campaign_recipients.every(r=>r.status==='demo')).toBe(true)});
});
