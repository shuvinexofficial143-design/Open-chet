import {afterEach,describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {decryptAccessToken, encryptAccessToken} from '../lib/whatsapp-credentials';
import {resolveWebhookAccount} from '../services/whatsapp-routing';
import {sendWhatsApp,type WhatsAppAccount} from '../services/whatsapp.service';

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
    {id:'account-a',organization_id:'organization-a',phone_number_id:'100001',is_active:true},
    {id:'account-b',organization_id:'organization-b',phone_number_id:'100002',is_active:true},
  ];
  const lookup=async(phoneNumberId:string)=>accounts.find(account=>account.phone_number_id===phoneNumberId)||null;

  it('routes Phone Number IDs A and B to their own organizations',async()=>{
    await expect(resolveWebhookAccount('100001',lookup)).resolves.toMatchObject({id:'account-a',organization_id:'organization-a'});
    await expect(resolveWebhookAccount('100002',lookup)).resolves.toMatchObject({id:'account-b',organization_id:'organization-b'});
  });

  it('ignores unknown, malformed, and disabled Phone Number IDs',async()=>{
    await expect(resolveWebhookAccount('999999',lookup)).resolves.toBeNull();
    await expect(resolveWebhookAccount('not-a-number',lookup)).resolves.toBeNull();
    await expect(resolveWebhookAccount('100003',async()=>({...accounts[0],phone_number_id:'100003',is_active:false}))).resolves.toBeNull();
  });

  it('sends with the selected account Phone Number ID and encrypted token',async()=>{
    const key=Buffer.alloc(32,9).toString('base64');
    process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY=key;
    const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({messages:[{id:'wamid.test'}]})});
    vi.stubGlobal('fetch',fetch);
    const connection:WhatsAppAccount={id:'account-b',organization_id:'organization-b',phone_number_id:'100002',business_account_id:'200002',is_active:true,...encryptAccessToken('token-for-b',key)};
    await sendWhatsApp(connection,'+919999999999',{type:'text',text:{body:'Hello'}});
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/100002/messages'),expect.objectContaining({headers:expect.objectContaining({Authorization:'Bearer token-for-b'})}));
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
    expect(accountsApi).toContain('${Number(count.count)===0}');
  });
});
