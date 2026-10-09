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
  // Keep the default last-inbound route for delivery without showing business
  // phone numbers or asking the user to select a route in the chat UI.
  await expect(page.getByLabel('Reply via WhatsApp number')).toHaveCount(0);
  await expect(page.locator('.reply-route')).toHaveCount(0);
  const customerHeader = page.locator('.chat-header .contact-heading');
  await expect(customerHeader.locator('.customer-phone')).toHaveText(data.contacts[0].phone);
  await expect(customerHeader).not.toContainText('+91 90000 00001');
  await expect(customerHeader).not.toContainText('+91 90000 00002');
  await expect(page.getByRole('button',{name:'Send message'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.reload();await customer.click();
  await expect(customer).toHaveCount(1);await expect(page.locator('.message-bubble')).toHaveCount(4);
});


test('a closed 24-hour WhatsApp window offers a visible paid template, not a disabled dead-end',async({page})=>{
  const data=demoData();
  data.conversations[0].last_inbound_at=new Date(Date.now()-3*24*60*60*1000).toISOString();
  await page.addInitScript(value=>localStorage.setItem('open-chet-demo-v1',JSON.stringify(value)),data);
  await page.goto('/?demo=1');
  await page.locator('.conversation').filter({hasText:'Dr. Arjun Mehta'}).click();

  await expect(page.getByText('24-hour reply window closed')).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Message'})).toBeDisabled();
  const cta=page.getByRole('button',{name:'Send paid template'});
  await expect(cta).toBeVisible();
  await cta.click();

  const templateDialog=page.getByRole('dialog');
  await expect(templateDialog.getByText('Outside the 24-hour window, WhatsApp allows only Meta-approved templates.',{exact:false})).toBeVisible();
  await templateDialog.getByRole('button',{name:/welcome_update/}).click();
  await expect(templateDialog.getByRole('button',{name:'Confirm & send approved template'})).toBeVisible();
  await expect(templateDialog.getByText('Meta messaging charges may apply')).toBeVisible();
  // Selecting the template is safe: never submit or charge without explicit confirmation.
});
