import {expect,test} from '@playwright/test';
import {demoData} from '../lib/demo';

test('one customer stays one chat across both routes and refresh on desktop/mobile',async({page})=>{
  const data=demoData(),first=data.conversations[0];
  first.whatsapp_account_id='account-a';
  data.connection!.whatsapp_accounts=[
    {id:'account-a',label:'Old number',phone_number_id:'100001',business_account_id:'200001',display_phone_number:'+91 90000 00001',verified_name:'Test',is_active:true,is_default:true},
    {id:'account-b',label:'New number',phone_number_id:'100002',business_account_id:'200001',display_phone_number:'+91 90000 00002',verified_name:'Test',is_active:true,is_default:false},
  ];
  const now=new Date().toISOString();
  data.conversations.push({...first,id:'second-route',whatsapp_account_id:'account-b',last_inbound_at:now,updated_at:now,preview:'From the new business number',unread:3});
  data.messages.push({id:'new-route-message',conversation_id:'second-route',whatsapp_account_id:'account-b',phone_number_id:'100002',direction:'in',kind:'text',status:'received',body:'From the new business number',created_at:now,sender_name:data.contacts[0].name});
  await page.addInitScript(value=>localStorage.setItem('open-chet-demo-v1',JSON.stringify(value)),data);
  await page.goto('/?demo=1');
  const customer=page.locator('.conversation').filter({hasText:'Dr. Arjun Mehta'});
  await expect(customer).toHaveCount(1);await expect(customer.locator('.unread')).toHaveText('5');
  await customer.click();
  await expect(page.locator('.message-bubble')).toHaveCount(4);
  await expect(page.getByLabel('Reply via WhatsApp number')).toHaveValue('second-route');
  await page.getByLabel('Reply via WhatsApp number').selectOption(first.id);
  await expect(page.getByLabel('Reply via WhatsApp number')).toHaveValue(first.id);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.reload();await customer.click();
  await expect(customer).toHaveCount(1);await expect(page.locator('.message-bubble')).toHaveCount(4);
});
