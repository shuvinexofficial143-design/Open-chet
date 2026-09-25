import {afterEach,describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {decryptAccessToken, encryptAccessToken} from '../lib/whatsapp-credentials';
import {resolveWebhookAccount} from '../services/whatsapp-routing';
import {statusAdvance} from '../lib/domain';
import {getWhatsAppHealth,sendWhatsApp,type WhatsAppAccount} from '../services/whatsapp.service';

afterEach(()=>vi.unstubAllGlobals());

describe('WhatsApp credential encryption', () => {
  const key = Buffer.alloc(32, 7).toString('base64');

  it('round-trips an access token with AES-256-GCM', () => {
    const encrypted = encryptAccessToken('EA-test-token', key);
    expect(encrypted.access_token_ciphertext).not.toContain('EA-test-token');
    expect(decryptAccessToken(encrypted, key)).toBe('EA-test-token');
  });

  it('uses a fresh IV for every encryption', () => {
    const first = encryptAccessToken('same-token', key);
    const second = encryptAccessToken('same-token', key);
    expect(first.access_token_iv).not.toBe(second.access_token_iv);
    expect(first.access_token_ciphertext).not.toBe(second.access_token_ciphertext);
  });

  it('accepts a long deployment secret by deriving a stable 32-byte AES key', () => {
    const deploymentSecret = 'this-is-a-long-vercel-secret-value-1234567890';
    const encrypted = encryptAccessToken('EA-test-token', deploymentSecret);
    expect(decryptAccessToken(encrypted, deploymentSecret)).toBe('EA-test-token');
  });

  it('rejects tampered ciphertext and weak short keys', () => {
    const encrypted = encryptAccessToken('EA-test-token', key);
    const tampered = {...encrypted, access_token_ciphertext: Buffer.from('tampered').toString('base64')};
    expect(() => decryptAccessToken(tampered, key)).toThrow();
    expect(() => encryptAccessToken('token', 'too-short')).toThrow('at least 32 characters');
  });
});

describe('Multi-number routing',()=>{
  const accounts=[
    {id:'old-account',organization_id:'workspace-a',phone_number_id:'1250269584826237',is_active:true},
    {id:'new-account',organization_id:'workspace-a',phone_number_id:'1415163475002152',is_active:true},
  ];
  const lookup=async(phoneNumberId:string)=>accounts.find(account=>account.phone_number_id===phoneNumberId)||null;

  it('routes the old and new production Phone Number IDs to distinct accounts in the same workspace',async()=>{
    await expect(resolveWebhookAccount('1250269584826237',lookup)).resolves.toMatchObject({id:'old-account',organization_id:'workspace-a'});
    await expect(resolveWebhookAccount('1415163475002152',lookup)).resolves.toMatchObject({id:'new-account',organization_id:'workspace-a'});
  });

  it('ignores unknown, malformed, and disabled Phone Number IDs',async()=>{
    await expect(resolveWebhookAccount('999999',lookup)).resolves.toBeNull();
    await expect(resolveWebhookAccount('not-a-number',lookup)).resolves.toBeNull();
    await expect(resolveWebhookAccount('100003',async()=>({...accounts[0],phone_number_id:'100003',is_active:false}))).resolves.toBeNull();
  });

  it('reads expanded WABA health without exposing the encrypted token',async()=>{
    const key=Buffer.alloc(32,7).toString('base64');
    process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY=key;
    const fetch=vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({id:'meta-test'})});
    vi.stubGlobal('fetch',fetch);
    const connection:WhatsAppAccount={id:'new-account',organization_id:'workspace-a',phone_number_id:'1415163475002152',business_account_id:'1975778520048284',is_active:true,...encryptAccessToken('health-secret',key)};
    const health=await getWhatsAppHealth(connection);
    expect(health.waba.ok).toBe(true);
    expect(health.phone.ok).toBe(true);
    expect(health.waba_phone_numbers.ok).toBe(true);
    expect(health.subscribed_apps.ok).toBe(true);
    expect(health.token_app.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(JSON.stringify(health)).not.toContain('health-secret');
  });

  it('sends with the selected account Phone Number ID and encrypted token',async()=>{
    const key=Buffer.alloc(32,9).toString('base64');
    process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY=key;
    const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({messages:[{id:'wamid.test'}]})});
    vi.stubGlobal('fetch',fetch);
    const connection:WhatsAppAccount={id:'new-account',organization_id:'workspace-a',phone_number_id:'1415163475002152',business_account_id:'1975778520048284',is_active:true,...encryptAccessToken('token-for-new',key)};
    await sendWhatsApp(connection,'+919999999999',{type:'text',text:{body:'Hello'}});
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/1415163475002152/messages'),expect.objectContaining({headers:expect.objectContaining({Authorization:'Bearer token-for-new'})}));
    const request=fetch.mock.calls[0][1];
    expect(JSON.parse(String(request.body))).toMatchObject({to:'919999999999',type:'text'});
  });
});

describe('WhatsApp connection API security',()=>{
  const bootstrap=readFileSync(new URL('../app/api/bootstrap/route.ts',import.meta.url),'utf8');
  const accountsApi=readFileSync(new URL('../app/api/whatsapp-accounts/route.ts',import.meta.url),'utf8');

  it('never selects encrypted token material for the bootstrap response',()=>{
    expect(bootstrap).toContain('select id,label,display_phone_number,verified_name,phone_number_id,business_account_id,is_active,is_default');
    expect(bootstrap).not.toContain('access_token_ciphertext');
    expect(bootstrap).not.toContain('access_token_iv');
    expect(bootstrap).not.toContain('access_token_tag');
  });

  it('requires owner or admin access to manage connections',()=>{
    expect(accountsApi).toContain("if(!canAdmin(c.role))throw new HttpError(403");
  });

  it('automatically makes the first active connection the default',()=>{
    expect(accountsApi).toContain('Number(count.count)===0');
  });
});

describe('WhatsApp delivery status and n8n reply routing',()=>{
  const replyRoute=readFileSync(new URL('../app/api/integrations/n8n/reply/route.ts',import.meta.url),'utf8');
  const webhookRoute=readFileSync(new URL('../app/api/webhooks/whatsapp/route.ts',import.meta.url),'utf8');
  const bootstrapRoute=readFileSync(new URL('../app/api/bootstrap/route.ts',import.meta.url),'utf8');

  it('keeps failed delivery terminal even if a late sent event arrives',()=>{
    expect(statusAdvance('sent','failed')).toBe('failed');
    expect(statusAdvance('failed','sent')).toBe('failed');
  });

  it('binds n8n replies to the exact account-scoped conversation',()=>{
    expect(replyRoute).toContain('phone_number_id=');
    expect(replyRoute).toContain('whatsapp_account_id=');
    expect(replyRoute).toContain('contact_id=');
    expect(replyRoute).toContain('meta_message_id=');
  });

  it('stores status events before lookup and exposes Meta failure codes',()=>{
    const insertIndex=webhookRoute.indexOf('insert into message_status_events');
    expect(insertIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeLessThan(webhookRoute.indexOf('from messages',insertIndex));
    expect(replyRoute).toContain('select status,error_code');
    expect(replyRoute).toContain('error_code:syncedErrorCode');
    expect(bootstrapRoute).toContain('meta_error_code');
  });
});

describe('WhatsApp health endpoint security',()=>{
  const route=readFileSync(new URL('../app/api/whatsapp-accounts/health/route.ts',import.meta.url),'utf8');
  it('scopes health lookup to the signed-in organization and uses only encrypted token columns',()=>{
    expect(route).toContain('organization_id=');
    expect(route).toContain('access_token_ciphertext');
    expect(route).toContain('access_token_iv');
    expect(route).toContain('access_token_tag');
    expect(route).toContain('Owner or admin access required');
  });
});
