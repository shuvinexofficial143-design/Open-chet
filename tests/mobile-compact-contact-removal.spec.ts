import {expect,test} from '@playwright/test';
import {demoAction,demoData} from '../lib/demo';

test('remove contact is not the same as clearing chat', () => {
  const data=demoData();
  const contact=data.contacts[0];
  const cids=data.conversations.filter(c=>c.contact_id===contact.id).map(c=>c.id);
  const next=demoAction(data,{type:'remove_contact',id:contact.id});
  expect(next.contacts.some(c=>c.id===contact.id)).toBe(false);
  expect(next.conversations.some(c=>c.contact_id===contact.id)).toBe(false);
  expect(next.messages.some(m=>cids.includes(m.conversation_id))).toBe(false);
  expect(data.contacts.some(c=>c.id===contact.id)).toBe(true);
});

test('mobile has one compact search row, chat list fills available space and bottom tabs stay visible',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='mobile','Mobile layout only');
  await page.goto('/?demo=1');
  const topbar=page.locator('.mvp-topbar');
  await expect(topbar).toBeHidden();
  const toolbar=page.locator('.chat-search-toolbar');
  const search=toolbar.getByRole('textbox',{name:'Search chats'});
  const unread=toolbar.getByRole('button',{name:'Show unread chats'});
  await expect(search).toBeVisible();
  await expect(unread).toBeVisible();
  await expect(toolbar.getByRole('button',{name:'New conversation'})).toBeVisible();
  await expect(page.locator('.mobile-chats-heading')).toBeHidden();
  await expect(page.locator('.chat-view-tabs')).toBeHidden();
  const bar=await toolbar.boundingBox();
  const list=await page.locator('.conversation-scroll').boundingBox();
  const tabs=await page.locator('.mobile-nav').boundingBox();
  const viewport=page.viewportSize();
  expect(bar&&list&&tabs&&viewport).toBeTruthy();
  expect(bar!.height).toBeLessThanOrEqual(72);
  expect(list!.height).toBeGreaterThan(viewport!.height*0.70);
  expect(tabs!.y+tabs!.height).toBeLessThanOrEqual(viewport!.height+2);
  const total=await page.locator('.conversation').count();
  await unread.click();
  await expect(toolbar.getByRole('button',{name:'Show all chats'})).toHaveAttribute('aria-pressed','true');
  expect(await page.locator('.conversation').count()).toBeLessThan(total);
  await toolbar.getByRole('button',{name:'Show all chats'}).click();
  await expect(page.locator('.conversation')).toHaveCount(total);
});

test('three-dot Remove Contact hides customer from Chats and Contacts after confirmation',async({page})=>{
  const demo=demoData();
  await page.addInitScript(value=>localStorage.setItem('open-chet-demo-v1',JSON.stringify(value)),demo);
  await page.goto('/?demo=1');
  const first=page.locator('.conversation').first();
  await first.click();
  const customerPhone=(await page.locator('.chat-header .customer-phone').innerText()).trim();
  const customer=demo.contacts.find(x=>x.phone===customerPhone);
  expect(customer).toBeTruthy();
  await page.getByRole('button',{name:'More conversation actions'}).click();
  const menu=page.getByRole('menu');
  await expect(menu.getByRole('button',{name:'Clear Chat'})).toBeVisible();
  await menu.getByRole('button',{name:'Remove Contact'}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toContainText(customerPhone);
  await expect(dialog).toContainText('both Chats and Contacts');
  await expect(page.locator('.chat-header')).toBeVisible();
  await dialog.getByRole('button',{name:'Remove number and chat from lists'}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.conversation').filter({hasText:customer!.name||customerPhone})).toHaveCount(0);
  const nav=page.locator('.mobile-nav:visible,.mvp-sidebar nav:visible').first();
  await nav.getByRole('button',{name:'Contacts'}).click();
  const search=page.getByRole('textbox',{name:'Search contacts'});
  await search.fill(customerPhone);
  await expect(page.getByText(customerPhone,{exact:true})).toHaveCount(0);
});
